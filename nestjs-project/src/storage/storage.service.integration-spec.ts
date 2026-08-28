import { Test } from '@nestjs/testing';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

/**
 * Integration test exercising the real MinIO/S3 multipart flow.
 * Requires the `minio` service (and `videos` bucket) from compose.yaml.
 */
describe('StorageService (integration, MinIO)', () => {
  let storage: StorageService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [StorageModule],
    }).compile();
    storage = module.get(StorageService);
  });

  async function putPart(url: string, body: Buffer): Promise<string> {
    const res = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(body),
    });
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toBeTruthy();
    return etag as string;
  }

  it('creates a multipart upload, accepts a presigned part PUT and assembles the object', async () => {
    const key = `it/${Date.now()}-complete/source`;
    const { uploadId } = await storage.createMultipartUpload(
      key,
      'application/octet-stream',
    );
    expect(uploadId).toBeTruthy();

    const url = await storage.getPresignedUploadPartUrl(key, uploadId, 1, 600);
    const body = Buffer.from('hello-multipart-world');
    const eTag = await putPart(url, body);

    await storage.completeMultipartUpload(key, uploadId, [
      { ETag: eTag, PartNumber: 1 },
    ]);

    // The assembled object is now downloadable via a presigned GET.
    const getUrl = await storage.getPresignedGetUrl(key, 600);
    const got = await fetch(getUrl);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer())).toEqual(body);

    await storage.deleteObject(key);
  }, 30000);

  it('aborts a multipart upload so it can no longer be completed', async () => {
    const key = `it/${Date.now()}-abort/source`;
    const { uploadId } = await storage.createMultipartUpload(
      key,
      'application/octet-stream',
    );

    await storage.abortMultipartUpload(key, uploadId);

    await expect(
      storage.completeMultipartUpload(key, uploadId, [
        { ETag: '"deadbeef"', PartNumber: 1 },
      ]),
    ).rejects.toBeDefined();
  }, 30000);
});
