import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  VIDEO_PROCESSING_QUEUE,
  ProcessVideoJobData,
} from '../videos/queue/video-processing.constants';
import { VideoStatus } from '../videos/entities/video-status.enum';
import { VideosRepository } from '../videos/videos.repository';
import { StorageService } from '../storage/storage.service';
import { FfmpegService } from './ffmpeg/ffmpeg.service';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  return undefined;
}

/**
 * BullMQ worker processor for video processing (TD-04, TD-05, TD-08).
 * Runs in a separate container (nestjs-worker) with FFmpeg installed.
 *
 * Flow:
 * 1. Update status → PROCESSING
 * 2. Download video from MinIO to /tmp
 * 3. Run ffprobe for metadata
 * 4. Run ffmpeg for thumbnail
 * 5. Upload thumbnail to MinIO
 * 6. Update Video: status=READY, duration, thumbnailKey, metadata
 * 7. On error: status=ERROR, processingError
 * 8. Cleanup temp files
 */
@Processor(VIDEO_PROCESSING_QUEUE, {
  concurrency: 2, // Process up to 2 videos simultaneously
})
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const { videoId, publicId, storageKey } = job.data;
    this.logger.log(
      `Processing job ${job.id} for video ${publicId} (${videoId})`,
    );

    let videoFilePath: string | null = null;
    let thumbnailFilePath: string | null = null;

    try {
      // 1. Load video entity
      const video = await this.videosRepository.findById(videoId);
      if (!video) {
        throw new Error(`Video ${videoId} not found`);
      }

      // 2. Download video from storage to temp
      const videoFileName = `video-${publicId}-${Date.now()}.mp4`;
      videoFilePath = join(tmpdir(), videoFileName);
      this.logger.log(`Downloading video to ${videoFilePath}`);

      const videoStream = await this.storageService.getObjectStream(storageKey);
      await pipeline(videoStream, createWriteStream(videoFilePath));
      this.logger.log(`Video downloaded successfully`);

      // 3. Extract metadata using ffprobe
      this.logger.log(`Extracting metadata with ffprobe`);
      const metadata = await this.ffmpegService.extractMetadata(videoFilePath);
      this.logger.log(
        `Metadata extracted: duration=${metadata.duration}s, ${metadata.width}x${metadata.height}`,
      );

      // 4. Generate thumbnail using ffmpeg (at 10% of duration or 5s, whichever is smaller)
      const thumbnailTimeOffset = Math.min(5, metadata.duration * 0.1);
      const thumbnailFileName = `thumb-${publicId}-${Date.now()}.jpg`;
      thumbnailFilePath = join(tmpdir(), thumbnailFileName);
      this.logger.log(
        `Generating thumbnail at ${thumbnailTimeOffset}s to ${thumbnailFilePath}`,
      );

      await this.ffmpegService.generateThumbnail(
        videoFilePath,
        thumbnailFilePath,
        thumbnailTimeOffset,
      );
      this.logger.log(`Thumbnail generated successfully`);

      // 5. Upload thumbnail to storage
      const thumbnailKey = `thumbnails/${publicId}.jpg`;
      this.logger.log(`Uploading thumbnail to storage: ${thumbnailKey}`);

      const thumbnailBuffer = await fs.readFile(thumbnailFilePath);
      await this.storageService.putObject(
        thumbnailKey,
        thumbnailBuffer,
        'image/jpeg',
      );
      this.logger.log(`Thumbnail uploaded successfully`);

      // 6. Update video entity: status=READY, metadata
      video.status = VideoStatus.READY;
      video.duration_seconds = Math.round(metadata.duration);
      video.thumbnail_key = thumbnailKey;
      video.metadata = {
        width: metadata.width,
        height: metadata.height,
        bitrate: metadata.bitrate,
        codec: metadata.codec,
      };

      await this.videosRepository.save(video);
      this.logger.log(
        `Video ${publicId} processing completed successfully (status=READY)`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing video ${publicId}: ${getErrorMessage(error)}`,
        getErrorStack(error),
      );

      // Update video status to ERROR
      try {
        const video = await this.videosRepository.findById(videoId);
        if (video) {
          video.status = VideoStatus.ERROR;
          video.processing_error = getErrorMessage(error) || 'Unknown error';
          await this.videosRepository.save(video);
          this.logger.log(`Video ${publicId} marked as ERROR`);
        }
      } catch (updateError) {
        this.logger.error(
          `Failed to update video status to ERROR: ${getErrorMessage(updateError)}`,
        );
      }

      throw error; // Re-throw to trigger BullMQ retry
    } finally {
      // 7. Cleanup temp files
      if (videoFilePath) {
        try {
          await fs.unlink(videoFilePath);
          this.logger.log(`Cleaned up video temp file: ${videoFilePath}`);
        } catch (err) {
          this.logger.warn(
            `Failed to delete temp video file: ${getErrorMessage(err)}`,
          );
        }
      }

      if (thumbnailFilePath) {
        try {
          await fs.unlink(thumbnailFilePath);
          this.logger.log(
            `Cleaned up thumbnail temp file: ${thumbnailFilePath}`,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to delete temp thumbnail file: ${getErrorMessage(err)}`,
          );
        }
      }
    }
  }
}
