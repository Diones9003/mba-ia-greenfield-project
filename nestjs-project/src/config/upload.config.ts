import { registerAs } from '@nestjs/config';

/**
 * Upload / streaming limits and FFmpeg binary locations — TD-03/05/07.
 *
 * Defaults: 10GB max file, 64MB parts, 1h upload presign TTL, 6h stream
 * presign TTL. `ffmpegPath`/`ffprobePath` allow overriding the binary
 * locations in the worker container.
 */
export default registerAs('upload', () => ({
  maxSizeBytes: parseInt(
    process.env.UPLOAD_MAX_SIZE_BYTES || '10737418240',
    10,
  ), // 10 GB
  partSizeBytes: parseInt(process.env.UPLOAD_PART_SIZE_BYTES || '67108864', 10), // 64 MB
  presignTtlSeconds: parseInt(
    process.env.UPLOAD_PRESIGN_TTL_SECONDS || '3600',
    10,
  ), // 1 h
  streamPresignTtlSeconds: parseInt(
    process.env.STREAM_PRESIGN_TTL_SECONDS || '21600',
    10,
  ), // 6 h
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
}));
