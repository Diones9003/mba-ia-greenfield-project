import { registerAs } from '@nestjs/config';

/**
 * S3-compatible object storage (MinIO in dev/prod parity) — TD-02.
 *
 * `endpoint` is the in-cluster address used by the API/worker containers
 * (service name `minio`, never `localhost`). `publicEndpoint` is the
 * browser-reachable host baked into presigned URLs and defaults to
 * `endpoint` when not provided.
 */
export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY!,
  secretKey: process.env.STORAGE_SECRET_KEY!,
  bucket: process.env.STORAGE_BUCKET || 'videos',
  forcePathStyle:
    (process.env.STORAGE_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true',
  publicEndpoint:
    process.env.STORAGE_PUBLIC_ENDPOINT ||
    process.env.STORAGE_ENDPOINT ||
    'http://minio:9000',
}));
