import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleUpload, authorizeCenter, getActor, rateLimitRequest } = vi.hoisted(() => ({
  rateLimitRequest: vi.fn(),
  handleUpload: vi.fn(),
  authorizeCenter: vi.fn(),
  getActor: vi.fn(),
}));

vi.mock('@vercel/blob/client', () => ({ handleUpload }));
vi.mock('../../lib/rate-limit', () => ({ rateLimitRequest }));
vi.mock('../../lib/auth/access', () => ({ authorizeCenter, getActor }));

import { POST } from '../../pages/api/[slug]/upload';

const call = (slug = 'recoletos') =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify({ type: 'blob.generate-client-token' }) }),
    params: { slug },
    cookies: {},
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getActor.mockResolvedValue({ email: 'ana@example.org', uid: 'u1', isSuperadmin: false });
  authorizeCenter.mockResolvedValue({ ok: true, center: { slug: 'recoletos' } });
  rateLimitRequest.mockResolvedValue(null);
  handleUpload.mockResolvedValue({ type: 'blob.generate-client-token', clientToken: 'tok' });
});

describe('POST /api/[slug]/upload', () => {
  it('returns 429 without issuing a token when rate limited', async () => {
    rateLimitRequest.mockResolvedValue(new Response('{"error":"x"}', { status: 429 }));
    expect((await call()).status).toBe(429);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('passes through the authorization status %s', async (status) => {
    authorizeCenter.mockResolvedValue({ ok: false, status });
    expect((await call()).status).toBe(status);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it('returns the handshake result for an authorized manager', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 'blob.generate-client-token', clientToken: 'tok' });
  });

  it('only issues tokens for paths under the center prefix, with strict type and size limits', async () => {
    await call();
    const { onBeforeGenerateToken } = handleUpload.mock.calls[0][0];
    await expect(onBeforeGenerateToken('otro/foto.webp')).rejects.toThrow();
    await expect(onBeforeGenerateToken('../recoletos/foto.webp')).rejects.toThrow();
    expect(await onBeforeGenerateToken('recoletos/foto.webp')).toEqual({
      allowedContentTypes: ['image/webp', 'image/jpeg', 'image/png'],
      maximumSizeInBytes: 5 * 1024 * 1024,
      addRandomSuffix: true,
    });
  });

  it('returns 400 when the handshake fails', async () => {
    handleUpload.mockRejectedValue(new Error('bad'));
    expect((await call()).status).toBe(400);
  });
});
