import { registerAs } from '@nestjs/config';

/**
 * BullMQ + Redis background-processing configuration — TD-01.
 *
 * `host` defaults to the Compose service name `redis` (never `localhost`).
 * Job retry policy (attempts + exponential backoff) is applied as the
 * queue's default job options in SI-03.4.
 */
export default registerAs('queue', () => ({
  redisHost: process.env.REDIS_HOST || 'redis',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  videoQueueName: process.env.VIDEO_QUEUE_NAME || 'video-processing',
  videoJobAttempts: parseInt(process.env.VIDEO_JOB_ATTEMPTS || '3', 10),
  videoJobBackoffMs: parseInt(process.env.VIDEO_JOB_BACKOFF_MS || '5000', 10),
}));
