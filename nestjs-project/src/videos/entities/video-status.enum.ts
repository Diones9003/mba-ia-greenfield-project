/**
 * Video lifecycle status — TD-08.
 *
 * draft      → pre-registered, multipart upload in progress
 * processing → upload completed, worker extracting metadata/thumbnail
 * ready      → processed successfully, streamable/downloadable
 * error      → processing failed permanently (after final retry)
 */
export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}
