import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  VIDEO_PROCESSING_QUEUE,
  VIDEO_PROCESSING_JOB,
  ProcessVideoJobData,
} from './video-processing.constants';

/**
 * Producer service for the video-processing queue (BullMQ).
 * Emits jobs after video upload completion (TD-01, SI-03.4).
 */
@Injectable()
export class VideoProcessingProducer {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue<ProcessVideoJobData>,
  ) {}

  /**
   * Adds a process-video job to the queue.
   * Retry policy: 3 attempts with exponential backoff (5s base).
   */
  async addProcessVideoJob(data: ProcessVideoJobData): Promise<void> {
    await this.videoQueue.add(VIDEO_PROCESSING_JOB, data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false, // Keep failed jobs for inspection
    });
  }
}
