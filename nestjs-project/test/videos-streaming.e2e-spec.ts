/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DataSource } from 'typeorm';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';

describe('Videos Streaming & Download (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accessToken: string;
  let channelId: string;
  let publicId: string;

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
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

    dataSource = app.get(DataSource);

    // Register, confirm and login a test user
    const email = `stream-test-${Date.now()}@test.com`;
    const password = 'Test1234!';

    accessToken = await registerConfirmLogin(email, password);
    channelId = await channelIdFor(email);
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.destroy();
    await app.close();
  });

  it('should return 404 when streaming a non-existent video', async () => {
    await request(app.getHttpServer())
      .get('/videos/nonexistent/stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('should return 404 when downloading a non-existent video', async () => {
    await request(app.getHttpServer())
      .get('/videos/nonexistent/download')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  describe('with a READY video', () => {
    beforeAll(async () => {
      // Create a video in READY status directly in DB (simulating processed video)
      const result = await dataSource.query(
        `INSERT INTO videos (
          public_id, title, status, channel_id, 
          storage_key, thumbnail_key, duration_seconds, 
          file_size_bytes, mime_type, original_filename
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) RETURNING public_id`,
        [
          'ready123abc',
          'Ready Video',
          'ready',
          channelId,
          'videos/ready123abc.mp4',
          'thumbnails/ready123abc.jpg',
          120,
          '5000000',
          'video/mp4',
          'test-video.mp4',
        ],
      );
      publicId = result[0].public_id;
    });

    it('should return a redirect URL for streaming without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${publicId}/stream`)
        .expect(302);

      expect(res.headers.location).toBeDefined();
      expect(res.headers.location).toContain('http');
      expect(res.headers.location).toContain('videos/ready123abc.mp4');
    });

    it('should return a redirect URL for download without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${publicId}/download`)
        .expect(302);

      expect(res.headers.location).toBeDefined();
      expect(res.headers.location).toContain('http');
      expect(res.headers.location).toContain('videos/ready123abc.mp4');
      expect(res.headers.location).toContain(
        'response-content-disposition=attachment',
      );
    });
  });

  describe('with a DRAFT video', () => {
    let draftPublicId: string;

    beforeAll(async () => {
      // Create a video in DRAFT status
      const result = await dataSource.query(
        `INSERT INTO videos (
          public_id, title, status, channel_id, 
          storage_key, file_size_bytes, mime_type
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        ) RETURNING public_id`,
        [
          'draft456def',
          'Draft Video',
          'draft',
          channelId,
          'videos/draft456def.mp4',
          '3000000',
          'video/mp4',
        ],
      );
      draftPublicId = result[0].public_id;
    });

    it('should return 409 when streaming a draft video', async () => {
      await request(app.getHttpServer())
        .get(`/videos/${draftPublicId}/stream`)
        .expect(409)
        .expect((res) => {
          expect(res.body.error).toBe('VIDEO_NOT_READY');
        });
    });

    it('should return 409 when downloading a draft video', async () => {
      await request(app.getHttpServer())
        .get(`/videos/${draftPublicId}/download`)
        .expect(409)
        .expect((res) => {
          expect(res.body.error).toBe('VIDEO_NOT_READY');
        });
    });
  });
});
