import { generatePublicId, PUBLIC_ID_LENGTH } from './public-id.util';

describe('generatePublicId', () => {
  it('returns an id of the configured length', () => {
    expect(generatePublicId()).toHaveLength(PUBLIC_ID_LENGTH);
  });

  it('returns a URL-safe id (A-Za-z0-9_-)', () => {
    expect(generatePublicId()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different ids across calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generatePublicId()));
    expect(ids.size).toBe(100);
  });
});
