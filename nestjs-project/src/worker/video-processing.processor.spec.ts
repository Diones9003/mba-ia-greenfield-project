/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { Readable } from 'stream';
import * as fs from 'fs';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideosRepository } from '../videos/videos.repository';
import { StorageService } from '../storage/storage.service';
import { FfmpegService } from './ffmpeg/ffmpeg.service';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/entities/video-status.enum';
import { ProcessVideoJobData } from '../videos/queue/video-processing.constants';

// Mock the fs module and stream/promises
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
  createWriteStream: jest.fn(() => ({
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  })),
}));

jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}));

describe('VideoProcessingProcessor', () => {
  let processor: VideoProcessingProcessor;
  let videosRepository: jest.Mocked<VideosRepository>;
  let storageService: jest.Mocked<StorageService>;
  let ffmpegService: jest.Mocked<FfmpegService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        {
          provide: VideosRepository,
          useValue: {
            findById: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            getObjectStream: jest.fn(),
            putObject: jest.fn(),
          },
        },
        {
          provide: FfmpegService,
          useValue: {
            extractMetadata: jest.fn(),
            generateThumbnail: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<VideoProcessingProcessor>(VideoProcessingProcessor);
    videosRepository = module.get(VideosRepository);
    storageService = module.get(StorageService);
    ffmpegService = module.get(FfmpegService);

    // Mock fs.promises.readFile to return a buffer
    (fs.promises.readFile as jest.Mock).mockResolvedValue(
      Buffer.from('fake-thumbnail'),
    );
    // Mock fs.promises.unlink to succeed
    (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should process video successfully and update status to READY', async () => {
      const jobData: ProcessVideoJobData = {
        videoId: 'video-id-123',
        publicId: 'abc123xyz',
        storageKey: 'videos/abc123xyz.mp4',
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
      } as Job<ProcessVideoJobData>;

      const mockVideo: Partial<Video> = {
        id: jobData.videoId,
        public_id: jobData.publicId,
        storage_key: jobData.storageKey,
        status: VideoStatus.PROCESSING,
      };

      const mockMetadata = {
        duration: 120.5,
        width: 1920,
        height: 1080,
        bitrate: 5000000,
        codec: 'h264',
      };

      // Mock video stream (empty readable for test)
      const mockStream = new Readable();
      mockStream.push(null);

      videosRepository.findById.mockResolvedValue(mockVideo as Video);
      storageService.getObjectStream.mockResolvedValue(mockStream);
      ffmpegService.extractMetadata.mockResolvedValue(mockMetadata);
      ffmpegService.generateThumbnail.mockResolvedValue();
      storageService.putObject.mockResolvedValue();
      videosRepository.save.mockResolvedValue(mockVideo as Video);

      await processor.process(mockJob);

      expect(videosRepository.findById).toHaveBeenCalledWith(jobData.videoId);
      expect(storageService.getObjectStream).toHaveBeenCalledWith(
        jobData.storageKey,
      );
      expect(ffmpegService.extractMetadata).toHaveBeenCalled();
      expect(ffmpegService.generateThumbnail).toHaveBeenCalled();
      expect(storageService.putObject).toHaveBeenCalledWith(
        expect.stringContaining('thumbnails/'),
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(videosRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: VideoStatus.READY,
          duration_seconds: 121,
          thumbnail_key: expect.stringContaining('thumbnails/'),
          metadata: expect.objectContaining({
            width: 1920,
            height: 1080,
          }),
        }),
      );
    });

    it('should update status to ERROR on processing failure', async () => {
      const jobData: ProcessVideoJobData = {
        videoId: 'video-id-123',
        publicId: 'abc123xyz',
        storageKey: 'videos/abc123xyz.mp4',
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
      } as Job<ProcessVideoJobData>;

      const mockVideo: Partial<Video> = {
        id: jobData.videoId,
        public_id: jobData.publicId,
        storage_key: jobData.storageKey,
        status: VideoStatus.PROCESSING,
      };

      videosRepository.findById.mockResolvedValue(mockVideo as Video);
      storageService.getObjectStream.mockRejectedValue(
        new Error('Storage error'),
      );

      // On error, the processor should update the video and re-throw
      await expect(processor.process(mockJob)).rejects.toThrow('Storage error');

      // Should have attempted to mark as ERROR
      expect(videosRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: VideoStatus.ERROR,
          processing_error: 'Storage error',
        }),
      );
    });

    it('should throw error if video not found', async () => {
      const jobData: ProcessVideoJobData = {
        videoId: 'video-id-123',
        publicId: 'abc123xyz',
        storageKey: 'videos/abc123xyz.mp4',
      };

      const mockJob = {
        id: 'job-123',
        data: jobData,
      } as Job<ProcessVideoJobData>;

      videosRepository.findById.mockResolvedValue(null);

      await expect(processor.process(mockJob)).rejects.toThrow(
        'Video video-id-123 not found',
      );
    });
  });
});
