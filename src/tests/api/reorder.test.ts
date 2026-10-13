import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reorderItems, authorizeCenter, getActor } = vi.hoisted(() => ({
  reorderItems: vi.fn(),
  authorizeCenter: vi.fn(),
  getActor: vi.fn(),
}));

vi.mock('../../lib/repo/items', () => ({ reorderItems }));
vi.mock('../../lib/auth/access', () => ({ authorizeCenter, getActor }));

import { POST } from '../../pages/api/[slug]/items/reorder';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const call = (body: unknown) =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
    params: { slug: 'recoletos' },
    cookies: {},
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getActor.mockResolvedValue({ email: 'ana@example.org', uid: 'u1', isSuperadmin: false });
  authorizeCenter.mockResolvedValue({ ok: true, center: { id: 'center-1', slug: 'recoletos' } });
  reorderItems.mockResolvedValue(2);
});

describe('POST /api/[slug]/items/reorder', () => {
  it.each([401, 403, 404])('passes through the authorization status %s', async (status) => {
    authorizeCenter.mockResolvedValue({ ok: false, status });
    expect((await call({ ids: [A] })).status).toBe(status);
    expect(reorderItems).not.toHaveBeenCalled();
  });

  it('reorders inside the authorized center with the valid ids only', async () => {
    const response = await call({ ids: [B, 'bad', A, B] });
    expect(response.status).toBe(200);
    expect(reorderItems).toHaveBeenCalledWith('center-1', [B, A]);
  });

  it.each([['not json'], [{}], [{ ids: 'x' }], [{ ids: ['bad'] }], [null]])('rejects a malformed body %#', async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(reorderItems).not.toHaveBeenCalled();
  });
});
