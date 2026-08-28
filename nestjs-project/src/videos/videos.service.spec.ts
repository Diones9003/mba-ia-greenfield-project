/* eslint-disable @typescript-eslint/unbound-method */
import { Test } from '@nestjs/testing';
import { Video } from './entities/video.entity';
import { VideoStatus } from './entities/video-status.enum';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import { VideoProcessingProducer } from './queue/video-processing.producer';
import uploadConfig from '../config/upload.config';
import {
  FileTooLargeException,
  InvalidStatusTransitionException,
  NotVideoOwnerException,
  UploadAlreadyCompletedException,
  UploadNotInitiatedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';

const OWNER_ID = 'user-1';
const CHANNEL_ID = '11111111-1111-1111-1111-111111111111';

function ownedChannel() {
  return { id: CHANNEL_ID, user_id: OWNER_ID };
}

describe('VideosService', () => {
  let service: VideosService;
  let repository: jest.Mocked<VideosRepository>;
  let channels: jest.Mocked<Pick<ChannelsService, 'findById'>>;
  let storage: jest.Mocked<
    Pick<
      StorageService,
      | 'createMultipartUpload'
      | 'completeMultipartUpload'
      | 'abortMultipartUpload'
      | 'getPresignedUploadPartUrl'
      | 'getPresignedGetUrl'
      | 'deleteObject'
    >
  >;

  const uploadCfg = {
    maxSizeBytes: 10737418240,
    partSizeBytes: 67108864,
    presignTtlSeconds: 3600,
    streamPresignTtlSeconds: 21600,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
  };

  beforeEach(async () => {
    const repoMock: Partial<jest.Mocked<VideosRepository>> = {
      create: jest.fn((data) => data as Video),
      save: jest.fn((video) => Promise.resolve(video)),
      findByPublicId: jest.fn().mockResolvedValue(null),
      findByChannel: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const channelsMock = { findById: jest.fn() };
    const storageMock = {
      createMultipartUpload: jest
        .fn()
        .mockResolvedValue({ uploadId: 'upload-123' }),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      getPresignedUploadPartUrl: jest
        .fn()
        .mockResolvedValue('https://storage/presigned-part'),
      getPresignedGetUrl: jest
        .fn()
        .mockResolvedValue('https://storage/presigned-get'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const queueProducerMock = {
      addProcessVideoJob: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: VideosRepository, useValue: repoMock },
        { provide: ChannelsService, useValue: channelsMock },
        { provide: StorageService, useValue: storageMock },
        { provide: VideoProcessingProducer, useValue: queueProducerMock },
        { provide: uploadConfig.KEY, useValue: uploadCfg },
      ],
    }).compile();

    service = module.get(VideosService);
    repository = module.get(VideosRepository);
    channels = module.get(ChannelsService);
    storage = module.get(StorageService);
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

  describe('initiateUpload', () => {
    const dto = {
      title: 'Clip',
      channelId: CHANNEL_ID,
      fileSize: 5368709120,
      mimeType: 'video/mp4',
    };

    it('rejects a channel not owned by the caller (403)', async () => {
      channels.findById.mockResolvedValue({
        id: CHANNEL_ID,
        user_id: 'someone-else',
      } as never);

      await expect(
        service.initiateUpload(OWNER_ID, dto),
      ).rejects.toBeInstanceOf(NotVideoOwnerException);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('rejects an oversized file (413)', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);

      await expect(
        service.initiateUpload(OWNER_ID, {
          ...dto,
          fileSize: uploadCfg.maxSizeBytes + 1,
        }),
      ).rejects.toBeInstanceOf(FileTooLargeException);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('generates a public_id, opens the multipart upload and persists a draft', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);

      const res = await service.initiateUpload(OWNER_ID, dto);

      expect(res.uploadId).toBe('upload-123');
      expect(res.partSize).toBe(uploadCfg.partSizeBytes);
      expect(res.publicId).toMatch(/^[A-Za-z0-9_-]{12}$/);
      expect(res.storageKey).toBe(`${CHANNEL_ID}/${res.publicId}/source`);
      expect(storage.createMultipartUpload).toHaveBeenCalledWith(
        res.storageKey,
        'video/mp4',
      );
      const created = repository.create.mock.calls[0][0];
      expect(created.status).toBe(VideoStatus.DRAFT);
      expect(created.upload_id).toBe('upload-123');
      expect(created.file_size_bytes).toBe('5368709120');
    });
  });

  describe('getPartUploadUrl', () => {
    it('rejects when the video is not a draft with an active upload', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        channel_id: CHANNEL_ID,
        status: VideoStatus.PROCESSING,
        upload_id: null,
        storage_key: 'k',
      } as Video);

      await expect(
        service.getPartUploadUrl(OWNER_ID, 'abc', 1),
      ).rejects.toBeInstanceOf(UploadNotInitiatedException);
    });

    it('returns a presigned URL for a valid draft', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        channel_id: CHANNEL_ID,
        status: VideoStatus.DRAFT,
        upload_id: 'upload-123',
        storage_key: 'chan/abc/source',
      } as Video);

      const res = await service.getPartUploadUrl(OWNER_ID, 'abc', 2);

      expect(res.url).toBe('https://storage/presigned-part');
      expect(res.expiresIn).toBe(uploadCfg.presignTtlSeconds);
      expect(storage.getPresignedUploadPartUrl).toHaveBeenCalledWith(
        'chan/abc/source',
        'upload-123',
        2,
        uploadCfg.presignTtlSeconds,
      );
    });

    it('throws VideoNotFound for an unknown public id', async () => {
      repository.findByPublicId.mockResolvedValue(null);
      await expect(
        service.getPartUploadUrl(OWNER_ID, 'nope', 1),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('completeUpload', () => {
    const parts = { parts: [{ partNumber: 1, eTag: 'etag-1' }] };

    it('transitions draft → processing and clears the upload id', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      const video = {
        public_id: 'abc',
        title: 'Clip',
        description: null,
        channel_id: CHANNEL_ID,
        status: VideoStatus.DRAFT,
        upload_id: 'upload-123',
        storage_key: 'chan/abc/source',
        duration_seconds: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as Video;
      repository.findByPublicId.mockResolvedValue(video);

      const res = await service.completeUpload(OWNER_ID, 'abc', parts);

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        'chan/abc/source',
        'upload-123',
        [{ ETag: 'etag-1', PartNumber: 1 }],
      );
      expect(video.status).toBe(VideoStatus.PROCESSING);
      expect(video.upload_id).toBeNull();
      expect(res.status).toBe(VideoStatus.PROCESSING);
    });

    it('rejects a double-complete with UPLOAD_ALREADY_COMPLETED', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        channel_id: CHANNEL_ID,
        status: VideoStatus.PROCESSING,
        upload_id: null,
      } as Video);

      await expect(
        service.completeUpload(OWNER_ID, 'abc', parts),
      ).rejects.toBeInstanceOf(UploadAlreadyCompletedException);
    });

    it('rejects completing from the error status with INVALID_STATUS_TRANSITION', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        channel_id: CHANNEL_ID,
        status: VideoStatus.ERROR,
        upload_id: null,
      } as Video);

      await expect(
        service.completeUpload(OWNER_ID, 'abc', parts),
      ).rejects.toBeInstanceOf(InvalidStatusTransitionException);
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

  describe('getStreamUrl / getDownloadUrl', () => {
    it('returns a presigned GET URL for a ready video', async () => {
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        status: VideoStatus.READY,
        storage_key: 'chan/abc/source',
      } as Video);

      await expect(service.getStreamUrl('abc')).resolves.toBe(
        'https://storage/presigned-get',
      );
      expect(storage.getPresignedGetUrl).toHaveBeenCalledWith(
        'chan/abc/source',
        uploadCfg.streamPresignTtlSeconds,
      );
    });

    it('throws VideoNotReadyException for a draft', async () => {
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        status: VideoStatus.DRAFT,
        storage_key: 'chan/abc/source',
      } as Video);

      await expect(service.getStreamUrl('abc')).rejects.toBeInstanceOf(
        VideoNotReadyException,
      );
    });

    it('passes attachment disposition on download', async () => {
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        status: VideoStatus.READY,
        storage_key: 'chan/abc/source',
        original_filename: 'clip.mp4',
      } as Video);

      await service.getDownloadUrl('abc');
      expect(storage.getPresignedGetUrl).toHaveBeenCalledWith(
        'chan/abc/source',
        uploadCfg.streamPresignTtlSeconds,
        { disposition: 'attachment; filename="clip.mp4"' },
      );
    });
  });

  describe('getVideoDetails', () => {
    it('returns the public projection for a ready video', async () => {
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        title: 'Clip',
        description: null,
        status: VideoStatus.READY,
        channel_id: CHANNEL_ID,
        duration_seconds: 12,
        thumbnail_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as Video);

      const dto = await service.getVideoDetails('abc');
      expect(dto.publicId).toBe('abc');
      expect(dto.status).toBe(VideoStatus.READY);
    });

    it('throws VideoNotReadyException when the video is not ready', async () => {
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        status: VideoStatus.PROCESSING,
      } as Video);

      await expect(service.getVideoDetails('abc')).rejects.toBeInstanceOf(
        VideoNotReadyException,
      );
    });
  });

  describe('listChannelVideos', () => {
    it('returns only ready videos for anonymous callers', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      repository.findByChannel.mockResolvedValue([
        {
          public_id: 'ready-1',
          title: 'Ready',
          description: null,
          status: VideoStatus.READY,
          channel_id: CHANNEL_ID,
          duration_seconds: null,
          thumbnail_key: null,
          created_at: new Date(),
          updated_at: new Date(),
        } as Video,
      ]);

      const list = await service.listChannelVideos(CHANNEL_ID, null);
      expect(repository.findByChannel).toHaveBeenCalledWith(
        CHANNEL_ID,
        VideoStatus.READY,
      );
      expect(list).toHaveLength(1);
    });

    it('returns every status for the owner', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      repository.findByChannel.mockResolvedValue([]);

      await service.listChannelVideos(CHANNEL_ID, OWNER_ID);
      expect(repository.findByChannel).toHaveBeenCalledWith(CHANNEL_ID);
    });
  });

  describe('deleteVideo', () => {
    it('aborts an in-flight multipart upload for a draft', async () => {
      channels.findById.mockResolvedValue(ownedChannel() as never);
      repository.findByPublicId.mockResolvedValue({
        public_id: 'abc',
        channel_id: CHANNEL_ID,
        status: VideoStatus.DRAFT,
        storage_key: 'chan/abc/source',
        upload_id: 'upload-123',
        thumbnail_key: null,
      } as Video);

      await service.deleteVideo(OWNER_ID, 'abc');
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        'chan/abc/source',
        'upload-123',
      );
      expect(storage.deleteObject).toHaveBeenCalledWith('chan/abc/source');
      expect(repository.remove).toHaveBeenCalled();
    });
  });
});
