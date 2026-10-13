import { afterAll, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

vi.mock('../../lib/db', async () => {
  const { neon, neonConfig } = await import('@neondatabase/serverless');
  if (process.env.TEST_NEON_FETCH_ENDPOINT) {
    neonConfig.fetchEndpoint = process.env.TEST_NEON_FETCH_ENDPOINT;
    neonConfig.useSecureWebSocket = false;
    neonConfig.poolQueryViaFetch = true;
  }
  return { default: neon(process.env.TEST_DATABASE_URL ?? 'postgresql://u:p@localhost/unused') };
});

import sql from '../../lib/db';
import { rateLimit } from '../../lib/rate-limit';

describe.skipIf(!databaseUrl)('rate limiter against a real database', () => {
  const prefix = `it-${Math.random().toString(36).slice(2, 8)}`;

  afterAll(async () => {
    await sql`DELETE FROM rate_limits WHERE key LIKE ${`${prefix}%`}`;
  });

  it('allows up to the limit, then blocks with a positive retry-after', async () => {
    const options = { key: `${prefix}-a`, limit: 3, windowSeconds: 600 };
    for (let i = 0; i < 3; i++) expect((await rateLimit(options)).allowed).toBe(true);
    const blocked = await rateLimit(options);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(600);
  });

  it('counts keys independently', async () => {
    await rateLimit({ key: `${prefix}-b`, limit: 1, windowSeconds: 600 });
    expect((await rateLimit({ key: `${prefix}-b`, limit: 1, windowSeconds: 600 })).allowed).toBe(false);
    expect((await rateLimit({ key: `${prefix}-c`, limit: 1, windowSeconds: 600 })).allowed).toBe(true);
  });
});
