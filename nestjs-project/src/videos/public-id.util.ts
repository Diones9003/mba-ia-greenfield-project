import { nanoid } from 'nanoid';

/** Length of the generated public id (~71 bits of entropy at 12 chars). */
export const PUBLIC_ID_LENGTH = 12;

/**
 * Generate a URL-safe public identifier for a video (TD-06).
 *
 * Uses nanoid's default URL-safe alphabet (A-Za-z0-9_-). The unique index
 * on `videos.public_id` is the collision backstop; the service retries on
 * the (astronomically unlikely) unique-violation.
 */
export function generatePublicId(): string {
  return nanoid(PUBLIC_ID_LENGTH);
}
