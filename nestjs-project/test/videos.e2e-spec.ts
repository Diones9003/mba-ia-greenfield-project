import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

const TEN_GB = 10737418240;

describe('Videos upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  });

  async function registerConfirmLogin(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailService = (authService as any).mailService;
    let token = '';
    jest
      .spyOn(mailService, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        token = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return res.body.access_token as string;
  }

  async function channelIdFor(email: string): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      'SELECT c.id FROM channels c JOIN users u ON u.id = c.user_id WHERE u.email = $1',
      [email],
    );
    return rows[0].id;
  }

  it('POST /videos returns 401 without a token', async () => {
    await request(app.getHttpServer())
      .post('/videos')
      .send({
        title: 'x',
        channelId: '11111111-1111-1111-1111-111111111111',
        fileSize: 100,
        mimeType: 'video/mp4',
      })
      .expect(401);
  });

  it('runs the full upload handshake: initiate → part url → complete', async () => {
    const email = 'uploader@example.com';
    const token = await registerConfirmLogin(email);
    const channelId = await channelIdFor(email);

    const initiate = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'My clip',
        description: 'desc',
        channelId,
        fileSize: 64,
        mimeType: 'video/mp4',
        originalFilename: 'clip.mp4',
      })
      .expect(201);

    expect(initiate.body.publicId).toBeDefined();
    expect(initiate.body.uploadId).toBeDefined();
    expect(initiate.body.storageKey).toBe(
      `${channelId}/${initiate.body.publicId}/source`,
    );
    expect(initiate.body.partSize).toBeGreaterThan(0);

    const publicId = initiate.body.publicId;

    const partRes = await request(app.getHttpServer())
      .post(`/videos/${publicId}/parts/1/url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(partRes.body.url).toContain('http');
    expect(partRes.body.expiresIn).toBeGreaterThan(0);

    // Upload the single part directly to MinIO via the presigned URL.
    const put = await fetch(partRes.body.url, {
      method: 'PUT',
      body: new Uint8Array(Buffer.from('0123456789abcdef0123456789abcdef')),
    });
    expect(put.status).toBe(200);
    const eTag = put.headers.get('etag') as string;

    const complete = await request(app.getHttpServer())
      .post(`/videos/${publicId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, eTag }] })
      .expect(200);
    expect(complete.body.status).toBe('processing');
    expect(complete.body.publicId).toBe(publicId);

    // A second complete is rejected as already completed.
    await request(app.getHttpServer())
      .post(`/videos/${publicId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, eTag }] })
      .expect(409)
      .expect((res) => {
        expect(res.body.error).toBe('UPLOAD_ALREADY_COMPLETED');
      });
  }, 40000);

  it('returns 403 NOT_VIDEO_OWNER when initiating for a channel owned by someone else', async () => {
    const ownerEmail = 'owner2@example.com';
    await registerConfirmLogin(ownerEmail);
    const foreignChannelId = await channelIdFor(ownerEmail);

    const intruderToken = await registerConfirmLogin('intruder@example.com');

    await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({
        title: 'hijack',
        channelId: foreignChannelId,
        fileSize: 100,
        mimeType: 'video/mp4',
      })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe('NOT_VIDEO_OWNER');
      });
  });

  it('returns 413 FILE_TOO_LARGE when fileSize exceeds 10GB', async () => {
    const email = 'bigfile@example.com';
    const token = await registerConfirmLogin(email);
    const channelId = await channelIdFor(email);

    await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'huge',
        channelId,
        fileSize: TEN_GB + 1,
        mimeType: 'video/mp4',
      })
      .expect(413)
      .expect((res) => {
        expect(res.body.error).toBe('FILE_TOO_LARGE');
      });
  });
});
