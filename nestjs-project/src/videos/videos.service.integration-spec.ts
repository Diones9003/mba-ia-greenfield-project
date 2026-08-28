import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status.enum';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';
import { StorageService } from '../storage/storage.service';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('VideosService (integration, DB + MinIO)', () => {
  let service: VideosService;
  let storage: StorageService;
  let dataSource: DataSource;
  let userId: string;
  let channelId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();

    service = module.get(VideosService);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    // Remove any rows left by the final test so sibling suites that only clean
    // the shared token/channel tables are not blocked by orphaned FK rows.
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);

    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `owner-${Date.now()}@example.com`,
        password: 'hashed',
      }),
    );
    userId = user.id;
    const channel = await dataSource.getRepository(Channel).save(
      dataSource.getRepository(Channel).create({
        name: 'owner',
        nickname: `owner-${Date.now()}`,
        user_id: userId,
      }),
    );
    channelId = channel.id;
  });

  it('persists a draft row with upload_id and status=draft', async () => {
    const res = await service.initiateUpload(userId, {
      title: 'Integration clip',
      channelId,
      fileSize: 1024,
      mimeType: 'video/mp4',
    });

    const row = await dataSource
      .getRepository(Video)
      .findOne({ where: { public_id: res.publicId } });

    expect(row).not.toBeNull();
    expect(row!.status).toBe(VideoStatus.DRAFT);
    expect(row!.upload_id).toBe(res.uploadId);
    expect(row!.storage_key).toBe(res.storageKey);
    expect(row!.file_size_bytes).toBe('1024');

    // Clean up the opened multipart upload in MinIO.
    await storage.abortMultipartUpload(res.storageKey, res.uploadId);
  }, 30000);

  it('completeUpload assembles the object and sets status=processing, clearing upload_id', async () => {
    const init = await service.initiateUpload(userId, {
      title: 'Complete me',
      channelId,
      fileSize: 32,
      mimeType: 'video/mp4',
    });

    // Upload one real part directly to MinIO via the presigned URL.
    const partUrl = await service.getPartUploadUrl(userId, init.publicId, 1);
    const put = await fetch(partUrl.url, {
      method: 'PUT',
      body: new Uint8Array(Buffer.from('the-source-bytes-go-here')),
    });
    expect(put.status).toBe(200);
    const eTag = put.headers.get('etag') as string;

    const res = await service.completeUpload(userId, init.publicId, {
      parts: [{ partNumber: 1, eTag }],
    });
    expect(res.status).toBe(VideoStatus.PROCESSING);

    const row = await dataSource
      .getRepository(Video)
      .findOne({ where: { public_id: init.publicId } });
    expect(row!.status).toBe(VideoStatus.PROCESSING);
    expect(row!.upload_id).toBeNull();

    await storage.deleteObject(init.storageKey);
  }, 30000);
});
