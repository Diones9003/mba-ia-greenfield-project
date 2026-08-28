import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),

  // Object storage (MinIO / S3) — TD-02
  STORAGE_ENDPOINT: Joi.string().uri().default('http://minio:9000'),
  STORAGE_PUBLIC_ENDPOINT: Joi.string().uri(),
  STORAGE_REGION: Joi.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: Joi.string().required(),
  STORAGE_SECRET_KEY: Joi.string().required(),
  STORAGE_BUCKET: Joi.string().default('videos'),
  STORAGE_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),

  // Background processing queue (BullMQ + Redis) — TD-01
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  VIDEO_QUEUE_NAME: Joi.string().default('video-processing'),
  VIDEO_JOB_ATTEMPTS: Joi.number().integer().min(1).default(3),
  VIDEO_JOB_BACKOFF_MS: Joi.number().integer().min(0).default(5000),

  // Upload / streaming limits and FFmpeg binaries — TD-03/05/07
  UPLOAD_MAX_SIZE_BYTES: Joi.number().integer().positive().default(10737418240),
  UPLOAD_PART_SIZE_BYTES: Joi.number().integer().positive().default(67108864),
  UPLOAD_PRESIGN_TTL_SECONDS: Joi.number().integer().positive().default(3600),
  STREAM_PRESIGN_TTL_SECONDS: Joi.number().integer().positive().default(21600),
  FFMPEG_PATH: Joi.string().default('ffmpeg'),
  FFPROBE_PATH: Joi.string().default('ffprobe'),
});
