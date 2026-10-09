import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getActor, bumpSessionVersion, recordAudit } = vi.hoisted(() => ({
  getActor: vi.fn(),
  bumpSessionVersion: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('../../lib/auth/access', () => ({ getActor }));
vi.mock('../../lib/repo/sessions', () => ({ bumpSessionVersion }));
vi.mock('../../lib/repo/audit', () => ({ recordAudit }));

import { POST } from '../../pages/api/auth/logout-all';

const redirect = (url: string, status: number) => new Response(null, { status, headers: { Location: url } });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/auth/logout-all', () => {
  it('bumps the session version, audits it and clears the cookie', async () => {
    getActor.mockResolvedValue({ email: 'ana@example.org', uid: 'u1', isSuperadmin: false });
    const cookies = { delete: vi.fn() };
    const response = await POST({ cookies, redirect } as any);
    expect(bumpSessionVersion).toHaveBeenCalledWith('ana@example.org');
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'session.revoke_all', actorEmail: 'ana@example.org' }));
    expect(cookies.delete).toHaveBeenCalledWith('session', { path: '/' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/login');
  });

  it('does nothing for an anonymous request except clearing the cookie', async () => {
    getActor.mockResolvedValue(null);
    const cookies = { delete: vi.fn() };
    const response = await POST({ cookies, redirect } as any);
    expect(bumpSessionVersion).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
  });
});
