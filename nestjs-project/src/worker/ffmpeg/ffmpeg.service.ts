import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { spawn } from 'child_process';
import uploadConfig from '../../config/upload.config';

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  bitrate?: number;
  codec?: string;
}

/**
 * FFmpeg/FFprobe wrapper using child_process (TD-05).
 * Invokes the binaries from upload config (FFMPEG_PATH / FFPROBE_PATH).
 */
@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);

  constructor(
    @Inject(uploadConfig.KEY)
    private readonly uploadCfg: ConfigType<typeof uploadConfig>,
  ) {}

  /**
   * Extract video metadata using ffprobe.
   * @param filePath Absolute path to the video file
   * @returns Metadata object with duration, dimensions, etc.
   */
  async extractMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-show_entries',
        'format=duration,bit_rate:stream=width,height,codec_name',
        '-of',
        'json',
        filePath,
      ];

      const ffprobe = spawn(this.uploadCfg.ffprobePath, args);
      let stdout = '';
      let stderr = '';

      ffprobe.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ffprobe.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          this.logger.error(`ffprobe exited with code ${code}: ${stderr}`);
          return reject(
            new Error(`ffprobe failed with code ${code}: ${stderr}`),
          );
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const data = JSON.parse(stdout);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          const videoStream = data.streams?.find(
            (s: { width?: number; height?: number }) => s.width && s.height,
          );

          const metadata: VideoMetadata = {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
            duration: parseFloat(data.format?.duration || '0'),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            width: videoStream?.width || 0,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            height: videoStream?.height || 0,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            bitrate: data.format?.bit_rate
              ? // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
                parseInt(data.format.bit_rate, 10)
              : undefined,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            codec: videoStream?.codec_name,
          };

          this.logger.log(`Extracted metadata: ${JSON.stringify(metadata)}`);
          resolve(metadata);
        } catch (err) {
          reject(new Error(`Failed to parse ffprobe output: ${err}`));
        }
      });

      ffprobe.on('error', (err) => {
        reject(new Error(`ffprobe spawn error: ${err.message}`));
      });
    });
  }

  /**
   * Generate a thumbnail (JPEG) from the video at a specific time offset.
   * @param videoPath Absolute path to the video file
   * @param outputPath Absolute path for the output thumbnail
   * @param timeOffset Time in seconds to extract the frame (e.g., 5)
   */
  async generateThumbnail(
    videoPath: string,
    outputPath: string,
    timeOffset: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-ss',
        timeOffset.toString(),
        '-i',
        videoPath,
        '-vframes',
        '1',
        '-q:v',
        '2', // JPEG quality (2 = high)
        '-y', // Overwrite output file
        outputPath,
      ];

      const ffmpeg = spawn(this.uploadCfg.ffmpegPath, args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          this.logger.error(`ffmpeg exited with code ${code}: ${stderr}`);
          return reject(
            new Error(`ffmpeg failed with code ${code}: ${stderr}`),
          );
        }

        this.logger.log(`Thumbnail generated at ${outputPath}`);
        resolve();
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });
    });
  }
}
