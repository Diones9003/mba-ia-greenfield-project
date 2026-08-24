/**
 * Constants and interfaces for the video processing queue (BullMQ + Redis).
 * - Queue name matches the convention in queue.config.ts (TD-01).
 * - Job name for video processing tasks.
 * - Payload schema for the process-video job.
 */

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const VIDEO_PROCESSING_JOB = 'process-video';

export interface ProcessVideoJobData {
  videoId: string;
  publicId: string;
  storageKey: string;
}
