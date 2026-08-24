import { Test } from '@nestjs/testing';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status.enum';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  let repository: jest.Mocked<VideosRepository>;

  beforeEach(async () => {
    const repoMock: Partial<jest.Mocked<VideosRepository>> = {
      create: jest.fn((data) => data as Video),
      save: jest.fn((video) => Promise.resolve(video)),
      findByPublicId: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: VideosRepository, useValue: repoMock },
      ],
    }).compile();

    service = module.get(VideosService);
    repository = module.get(VideosRepository);
  });

  describe('create', () => {
    it('generates a public_id when none is supplied and persists the row', async () => {
      const result = await service.create({
        title: 'Hello',
        channel_id: 'chan-1',
      });

      expect(repository.create).toHaveBeenCalledTimes(1);
      const created = repository.create.mock.calls[0][0];
      expect(created.public_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
      expect(repository.save).toHaveBeenCalledWith(result);
    });

    it('keeps a caller-supplied public_id', async () => {
      await service.create({
        public_id: 'fixed-id',
        title: 'Hello',
        channel_id: 'chan-1',
        status: VideoStatus.DRAFT,
      });

      const created = repository.create.mock.calls[0][0];
      expect(created.public_id).toBe('fixed-id');
    });
  });

  describe('findByPublicId', () => {
    it('delegates to the repository', async () => {
      const video = { public_id: 'abc' } as Video;
      repository.findByPublicId.mockResolvedValue(video);

      await expect(service.findByPublicId('abc')).resolves.toBe(video);
      expect(repository.findByPublicId).toHaveBeenCalledWith('abc');
    });

    it('returns null for an unknown public id', async () => {
      repository.findByPublicId.mockResolvedValue(null);
      await expect(service.findByPublicId('nope')).resolves.toBeNull();
    });
  });
});
