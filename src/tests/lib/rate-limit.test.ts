import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sql } = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('../../lib/db', () => ({ default: sql }));

import { clientIp, rateLimit, rateLimitKey, rateLimitRequest, RATE_LIMITS, RATE_LIMIT_MESSAGE } from '../../lib/rate-limit';

const opts = { key: 'k', limit: 3, windowSeconds: 60 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0.9);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('rateLimit', () => {
  it('allows requests up to the limit', async () => {
    sql.mockResolvedValue([{ count: 3, retry_after: 40 }]);
    expect(await rateLimit(opts)).toEqual({ allowed: true, retryAfter: 0 });
  });

  it('blocks once the limit is exceeded and reports retry-after', async () => {
    sql.mockResolvedValue([{ count: 4, retry_after: 40 }]);
    expect(await rateLimit(opts)).toEqual({ allowed: false, retryAfter: 40 });
  });

  it('fails open when the database errors', async () => {
    sql.mockRejectedValue(new Error('db down'));
    expect(await rateLimit(opts)).toEqual({ allowed: true, retryAfter: 0 });
  });

  it('cleans up old windows opportunistically', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    sql.mockResolvedValue([{ count: 1, retry_after: 40 }]);
    await rateLimit(opts);
    expect(sql).toHaveBeenCalledTimes(2);
    expect(sql.mock.calls[1][0].join('')).toContain('DELETE FROM rate_limits');
  });
});

describe('keys and ip', () => {
  it('uses the first x-forwarded-for hop, then clientAddress', () => {
    const request = new Request('http://x', { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } });
    expect(clientIp(request, '9.9.9.9')).toBe('1.1.1.1');
    expect(clientIp(new Request('http://x'), '9.9.9.9')).toBe('9.9.9.9');
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });

  it('hashes the ip and separates routes and centers', () => {
    const key = rateLimitKey('upload', '1.1.1.1', 'a');
    expect(key).not.toContain('1.1.1.1');
    expect(key).not.toBe(rateLimitKey('upload', '1.1.1.1', 'b'));
    expect(key).not.toBe(rateLimitKey('createOrder', '1.1.1.1', 'a'));
  });
});

describe('rateLimitRequest', () => {
  it('returns null when allowed and a 429 with Retry-After when blocked', async () => {
    const request = new Request('http://x');
    sql.mockResolvedValue([{ count: 1, retry_after: 5 }]);
    expect(await rateLimitRequest('upload', request, '1.1.1.1', 's')).toBeNull();

    sql.mockResolvedValue([{ count: RATE_LIMITS.upload.limit + 1, retry_after: 120 }]);
    const response = (await rateLimitRequest('upload', request, '1.1.1.1', 's'))!;
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(await response.json()).toEqual({ error: RATE_LIMIT_MESSAGE });
  });
});
