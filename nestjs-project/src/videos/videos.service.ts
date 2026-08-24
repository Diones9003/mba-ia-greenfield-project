import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status.enum';
import { VideosRepository } from './videos.repository';
import { generatePublicId } from './public-id.util';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import { VideoProcessingProducer } from './queue/video-processing.producer';
import uploadConfig from '../config/upload.config';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import {
  FileTooLargeException,
  InvalidStatusTransitionException,
  NotVideoOwnerException,
  UploadAlreadyCompletedException,
  UploadNotInitiatedException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_MAX_RETRIES = 5;
const MAX_PART_NUMBER = 10000;

function isPublicIdUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as unknown as { code?: string; detail?: string };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes('public_id')
  );
}

/**
 * Video domain service.
 *
 * Owns the presigned multipart upload handshake (TD-03): pre-registering a
 * `draft`, minting per-part presigned URLs, and completing the upload. File
 * bytes are exchanged directly between client and storage — never via the API.
 */
@Injectable()
export class VideosService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly videoProcessingProducer: VideoProcessingProducer,
    @Inject(uploadConfig.KEY)
    private readonly uploadCfg: ConfigType<typeof uploadConfig>,
  ) {}

  /** Persist a new video row. */
  async create(data: Partial<Video>): Promise<Video> {
    const video = this.videosRepository.create({
      public_id: data.public_id ?? generatePublicId(),
      ...data,
    });
    return this.videosRepository.save(video);
  }

  /** Load a video by its public id, or null when absent. */
  async findByPublicId(publicId: string): Promise<Video | null> {
    return this.videosRepository.findByPublicId(publicId);
  }

  /**
   * Pre-register a `draft` video and start the S3 multipart upload.
   * Returns the identifiers the client needs to upload parts directly.
   */
  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<{
    publicId: string;
    uploadId: string;
    storageKey: string;
    partSize: number;
  }> {
    const channel = await this.channelsService.findById(dto.channelId);
    if (!channel || channel.user_id !== userId) {
      throw new NotVideoOwnerException();
    }

    if (dto.fileSize > this.uploadCfg.maxSizeBytes) {
      throw new FileTooLargeException();
    }

    for (let attempt = 0; attempt <= PUBLIC_ID_MAX_RETRIES; attempt++) {
      const publicId = generatePublicId();
      const storageKey = `${dto.channelId}/${publicId}/source`;

      // Reserve the public id before opening the multipart upload so a
      // collision does not leak an orphaned multipart upload.
      const existing = await this.videosRepository.findByPublicId(publicId);
      if (existing) continue;

      const { uploadId } = await this.storageService.createMultipartUpload(
        storageKey,
        dto.mimeType,
      );

      try {
        await this.videosRepository.save(
          this.videosRepository.create({
            public_id: publicId,
            title: dto.title,
            description: dto.description ?? null,
            status: VideoStatus.DRAFT,
            channel_id: dto.channelId,
            storage_key: storageKey,
            file_size_bytes: String(dto.fileSize),
            mime_type: dto.mimeType,
            original_filename: dto.originalFilename ?? null,
            upload_id: uploadId,
          }),
        );
      } catch (err) {
        // Concurrent insert grabbed the same public id — discard the just
        // opened multipart upload and retry with a fresh id.
        await this.storageService
          .abortMultipartUpload(storageKey, uploadId)
          .catch(() => undefined);
        if (isPublicIdUniqueViolation(err)) continue;
        throw err;
      }

      return {
        publicId,
        uploadId,
        storageKey,
        partSize: this.uploadCfg.partSizeBytes,
      };
    }

    throw new Error('Could not allocate a unique public id after max retries');
  }

  /** Mint a presigned URL for a single multipart part upload. */
  async getPartUploadUrl(
    userId: string,
    publicId: string,
    partNumber: number,
  ): Promise<{ url: string; expiresIn: number }> {
    const video = await this.loadOwnedVideo(userId, publicId);

    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new UploadNotInitiatedException();
    }
    if (
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > MAX_PART_NUMBER
    ) {
      throw new UploadNotInitiatedException();
    }

    const url = await this.storageService.getPresignedUploadPartUrl(
      video.storage_key!,
      video.upload_id,
      partNumber,
      this.uploadCfg.presignTtlSeconds,
    );
    return { url, expiresIn: this.uploadCfg.presignTtlSeconds };
  }

  /** Complete the multipart upload and transition the video to `processing`. */
  async completeUpload(
    userId: string,
    publicId: string,
    dto: CompleteUploadDto,
  ): Promise<VideoResponseDto> {
    const video = await this.loadOwnedVideo(userId, publicId);

    if (
      video.status === VideoStatus.PROCESSING ||
      video.status === VideoStatus.READY
    ) {
      throw new UploadAlreadyCompletedException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new InvalidStatusTransitionException();
    }
    if (!video.upload_id) {
      throw new UploadNotInitiatedException();
    }

    await this.storageService.completeMultipartUpload(
      video.storage_key!,
      video.upload_id,
      dto.parts.map((p) => ({ ETag: p.eTag, PartNumber: p.partNumber })),
    );

    video.status = VideoStatus.PROCESSING;
    video.upload_id = null;
    const saved = await this.videosRepository.save(video);

    // Emit job for background processing (FFmpeg metadata + thumbnail)
    await this.videoProcessingProducer.addProcessVideoJob({
      videoId: saved.id,
      publicId: saved.public_id,
      storageKey: saved.storage_key!,
    });

    return VideoResponseDto.fromEntity(saved);
  }

  /**
   * Get a presigned URL for streaming the video.
   * Only videos with status=READY are streamable.
   */
  async getStreamUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.loadOwnedVideo(userId, publicId);

    if (video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }

    if (!video.storage_key) {
      throw new VideoNotFoundException();
    }

    return this.storageService.getPresignedGetUrl(
      video.storage_key,
      this.uploadCfg.presignTtlSeconds,
    );
  }

  /**
   * Get a presigned URL for downloading the video.
   * Only videos with status=READY are downloadable.
   */
  async getDownloadUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.loadOwnedVideo(userId, publicId);

    if (video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }

    if (!video.storage_key) {
      throw new VideoNotFoundException();
    }

    const filename = video.original_filename || `${video.public_id}.mp4`;
    return this.storageService.getPresignedGetUrl(
      video.storage_key,
      this.uploadCfg.presignTtlSeconds,
      { disposition: `attachment; filename="${filename}"` },
    );
  }

  /** Load a video by public id and assert the caller owns its channel. */
  private async loadOwnedVideo(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.videosRepository.findByPublicId(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    const channel = await this.channelsService.findById(video.channel_id);
    if (!channel || channel.user_id !== userId) {
      throw new NotVideoOwnerException();
    }
    return video;
  }
}
