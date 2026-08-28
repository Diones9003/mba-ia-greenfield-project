import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status.enum';
import { VideosRepository } from './videos.repository';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('VideosRepository (integration)', () => {
  let dataSource: DataSource;
  let videosRepository: VideosRepository;
  let channelRepository: Repository<Channel>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videosRepository = new VideosRepository(dataSource.getRepository(Video));
    channelRepository = dataSource.getRepository(Channel);
    userRepository = dataSource.getRepository(User);
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
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `repo_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `chan ${counter}`,
        nickname: `repo_chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  async function seedVideo(
    channelId: string,
    publicId: string,
    status: VideoStatus = VideoStatus.DRAFT,
  ): Promise<Video> {
    const video = videosRepository.create({
      public_id: publicId,
      title: `Video ${publicId}`,
      channel_id: channelId,
      storage_key: `${channelId}/${publicId}/source`,
      status,
    });
    return videosRepository.save(video);
  }

  it('creates and finds a video by public id', async () => {
    const channel = await createChannel();
    await seedVideo(channel.id, 'find-me');

    const found = await videosRepository.findByPublicId('find-me');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Video find-me');
  });

  it('returns null for an unknown public id', async () => {
    await expect(videosRepository.findByPublicId('ghost')).resolves.toBeNull();
  });

  it('loads a video with its channel relation', async () => {
    const channel = await createChannel();
    await seedVideo(channel.id, 'with-channel');

    const found =
      await videosRepository.findByPublicIdWithChannel('with-channel');
    expect(found?.channel.id).toBe(channel.id);
  });

  it('lists channel videos ordered newest-first', async () => {
    const channel = await createChannel();
    const first = await seedVideo(channel.id, 'older', VideoStatus.READY);
    // Force a later created_at on the second row
    await dataSource.query(
      `UPDATE "videos" SET "created_at" = "created_at" - INTERVAL '1 hour' WHERE id = $1`,
      [first.id],
    );
    await seedVideo(channel.id, 'newer', VideoStatus.READY);

    const list = await videosRepository.findByChannel(channel.id);
    expect(list.map((v) => v.public_id)).toEqual(['newer', 'older']);
  });

  it('filters channel videos by status when requested', async () => {
    const channel = await createChannel();
    await seedVideo(channel.id, 'ready-one', VideoStatus.READY);
    await seedVideo(channel.id, 'draft-one', VideoStatus.DRAFT);

    const readyOnly = await videosRepository.findByChannel(
      channel.id,
      VideoStatus.READY,
    );
    expect(readyOnly.map((v) => v.public_id)).toEqual(['ready-one']);
  });

  it('removes a video row', async () => {
    const channel = await createChannel();
    const video = await seedVideo(channel.id, 'remove-me');

    await videosRepository.remove(video);

    await expect(
      videosRepository.findByPublicId('remove-me'),
    ).resolves.toBeNull();
  });
});
