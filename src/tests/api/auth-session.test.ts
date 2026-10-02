import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyFirebaseIdToken, listMembershipsByEmail, linkFirebaseUid } = vi.hoisted(() => ({
  verifyFirebaseIdToken: vi.fn(),
  listMembershipsByEmail: vi.fn(),
  linkFirebaseUid: vi.fn(),
}));

vi.mock('../../lib/auth/firebase', () => ({ verifyFirebaseIdToken }));
vi.mock('../../lib/repo/users', () => ({ listMembershipsByEmail, linkFirebaseUid }));

import { POST as logout } from '../../pages/api/auth/logout';
import { POST as createSession } from '../../pages/api/auth/session';

const call = (body: unknown) => {
  const cookies = { set: vi.fn() };
  const promise = createSession({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
    cookies,
  } as any);
  return { cookies, promise };
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyFirebaseIdToken.mockResolvedValue({ uid: 'u1', email: 'ana@example.org' });
  listMembershipsByEmail.mockResolvedValue([{ slug: 'recoletos', name: 'Recoletos' }]);
});

describe('POST /api/auth/session', () => {
  it('returns 400 without an idToken', async () => {
    const { promise } = call({});
    expect((await promise).status).toBe(400);
  });

  it('returns 401 when the token does not verify', async () => {
    verifyFirebaseIdToken.mockRejectedValue(new Error('bad'));
    const { promise, cookies } = call({ idToken: 'x' });
    expect((await promise).status).toBe(401);
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it('returns 403 for an email that manages no center', async () => {
    listMembershipsByEmail.mockResolvedValue([]);
    const { promise, cookies } = call({ idToken: 'x' });
    const response = await promise;
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('ningún centro');
    expect(cookies.set).not.toHaveBeenCalled();
    expect(linkFirebaseUid).not.toHaveBeenCalled();
  });

  it('creates a session for a manager and links the uid', async () => {
    const { promise, cookies } = call({ idToken: 'x' });
    const response = await promise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirect: '/recoletos/admin' });
    expect(linkFirebaseUid).toHaveBeenCalledWith('ana@example.org', 'u1');
    expect(cookies.set).toHaveBeenCalledWith(
      'session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('sends the superadmin to /admin even without memberships', async () => {
    verifyFirebaseIdToken.mockResolvedValue({ uid: 'u0', email: 'boss@example.org' });
    listMembershipsByEmail.mockResolvedValue([]);
    const { promise } = call({ idToken: 'x' });
    expect(await (await promise).json()).toEqual({ redirect: '/admin' });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie and redirects to /login', async () => {
    const cookies = { delete: vi.fn() };
    const redirect = (url: string, status: number) => new Response(null, { status, headers: { Location: url } });
    const response = await logout({ cookies, redirect } as any);
    expect(cookies.delete).toHaveBeenCalledWith('session', { path: '/' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/login');
  });
});
