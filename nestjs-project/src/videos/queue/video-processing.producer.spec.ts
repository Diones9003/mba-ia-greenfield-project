/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { VideoProcessingProducer } from './video-processing.producer';
import {
  VIDEO_PROCESSING_QUEUE,
  VIDEO_PROCESSING_JOB,
  ProcessVideoJobData,
} from './video-processing.constants';

describe('VideoProcessingProducer', () => {
  let producer: VideoProcessingProducer;
  let mockQueue: any;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoProcessingProducer,
        {
          provide: getQueueToken(VIDEO_PROCESSING_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();

    producer = module.get<VideoProcessingProducer>(VideoProcessingProducer);
  });

  it('should be defined', () => {
    expect(producer).toBeDefined();
  });

  describe('addProcessVideoJob', () => {
    it('should add a job to the queue with correct data and retry policy', async () => {
      const jobData: ProcessVideoJobData = {
        videoId: 'video-id-123',
        publicId: 'abc123xyz',
        storageKey: 'videos/abc123xyz.mp4',
      };

      await producer.addProcessVideoJob(jobData);

      expect(mockQueue.add).toHaveBeenCalledWith(
        VIDEO_PROCESSING_JOB,
        jobData,
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    });

    it('should propagate queue errors', async () => {
      const jobData: ProcessVideoJobData = {
        videoId: 'video-id-123',
        publicId: 'abc123xyz',
        storageKey: 'videos/abc123xyz.mp4',
      };

      mockQueue.add.mockRejectedValueOnce(new Error('Queue connection failed'));

      await expect(producer.addProcessVideoJob(jobData)).rejects.toThrow(
        'Queue connection failed',
      );
    });
  });
});
