import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from './video-status.enum';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
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
        email: `vid_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `chan ${counter}`,
        nickname: `chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channelId: string, publicId: string): Video {
    return videoRepository.create({
      public_id: publicId,
      title: 'My Video',
      channel_id: channelId,
      storage_key: `${channelId}/${publicId}/source`,
    });
  }

  it('defaults status to draft and auto-populates timestamps', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(buildVideo(channel.id, 'pub1'));

    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);
    expect(video.description).toBeNull();
    expect(video.thumbnail_key).toBeNull();
  });

  it('enforces the unique public_id constraint', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel.id, 'dupid'));

    await expect(
      videoRepository.save(buildVideo(channel.id, 'dupid')),
    ).rejects.toThrow();
  });

  it('rejects an invalid status enum value', async () => {
    const channel = await createChannel();
    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("public_id", "title", "channel_id", "status")
         VALUES ('badstatus', 't', $1, 'bogus')`,
        [channel.id],
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('stores file_size_bytes larger than 2^31 (bigint)', async () => {
    const channel = await createChannel();
    const bigSize = '5368709120'; // 5 GB > 2^31
    const video = buildVideo(channel.id, 'bigfile');
    video.file_size_bytes = bigSize;
    const saved = await videoRepository.save(video);

    const reloaded = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(reloaded.file_size_bytes).toBe(bigSize);
  });

  it('round-trips jsonb metadata', async () => {
    const channel = await createChannel();
    const video = buildVideo(channel.id, 'withmeta');
    video.metadata = { format: { duration: '12.34' }, streams: [{ codec: 'h264' }] };
    const saved = await videoRepository.save(video);

    const reloaded = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(reloaded.metadata).toEqual({
      format: { duration: '12.34' },
      streams: [{ codec: 'h264' }],
    });
  });

  it('loads the owning channel via the ManyToOne relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel.id, 'relvid'));

    const found = await videoRepository.findOne({
      where: { public_id: 'relvid' },
      relations: ['channel'],
    });
    expect(found?.channel.id).toBe(channel.id);
  });

  it('cascade-deletes videos when the owning channel is removed', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel.id, 'cascadevid'));

    await channelRepository.delete(channel.id);

    const found = await videoRepository.findOne({
      where: { public_id: 'cascadevid' },
    });
    expect(found).toBeNull();
  });
});
