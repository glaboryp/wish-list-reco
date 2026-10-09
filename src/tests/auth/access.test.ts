import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCenterBySlug, findMembership, getSessionVersion } = vi.hoisted(() => ({
  getSessionVersion: vi.fn(),
  getCenterBySlug: vi.fn(),
  findMembership: vi.fn(),
}));

vi.mock('../../lib/repo/centers', () => ({ getCenterBySlug }));
vi.mock('../../lib/repo/sessions', () => ({ getSessionVersion }));
vi.mock('../../lib/repo/users', () => ({ findMembership }));

import { authorizeCenter, authorizeSuperadmin, getActor, isSuperadminEmail } from '../../lib/auth/access';
import { SESSION_COOKIE, signSession } from '../../lib/auth/session';

const secret = 'test-session-secret-test-session-secret';
const center = { id: 'c1', slug: 'recoletos', status: 'active' };
const manager = { email: 'ana@example.org', uid: 'u1', isSuperadmin: false };
const boss = { email: 'boss@example.org', uid: 'u0', isSuperadmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  getCenterBySlug.mockResolvedValue(center);
  findMembership.mockResolvedValue(true);
  getSessionVersion.mockResolvedValue(0);
});

describe('isSuperadminEmail', () => {
  it('matches only the configured email', () => {
    expect(isSuperadminEmail('boss@example.org')).toBe(true);
    expect(isSuperadminEmail('ana@example.org')).toBe(false);
    expect(isSuperadminEmail('')).toBe(false);
  });
});

describe('getActor', () => {
  const cookies = (value?: string) => ({ get: (name: string) => (name === SESSION_COOKIE && value ? { value } : undefined) });

  it('returns null without a cookie or with a bad one', async () => {
    expect(await getActor(cookies())).toBeNull();
    expect(await getActor(cookies('garbage'))).toBeNull();
  });

  it('builds the actor from a valid cookie', async () => {
    const token = await signSession({ email: 'ana@example.org', uid: 'u1' }, secret);
    expect(await getActor(cookies(token))).toEqual(manager);
  });

  it('rejects a cookie older than the current session version', async () => {
    getSessionVersion.mockResolvedValue(2);
    const stale = await signSession({ email: 'ana@example.org', uid: 'u1', sv: 1 }, secret);
    const legacy = await signSession({ email: 'ana@example.org', uid: 'u1' }, secret);
    const fresh = await signSession({ email: 'ana@example.org', uid: 'u1', sv: 2 }, secret);
    expect(await getActor(cookies(stale))).toBeNull();
    expect(await getActor(cookies(legacy))).toBeNull();
    expect(await getActor(cookies(fresh))).toEqual(manager);
  });

  it('keeps tokens without the claim valid until the version is bumped', async () => {
    const legacy = await signSession({ email: 'ana@example.org', uid: 'u1' }, secret);
    expect(await getActor(cookies(legacy))).toEqual(manager);
    expect(getSessionVersion).toHaveBeenCalledWith('ana@example.org');
  });

  it('flags the superadmin', async () => {
    const token = await signSession({ email: 'boss@example.org', uid: 'u0' }, secret);
    expect((await getActor(cookies(token)))?.isSuperadmin).toBe(true);
  });
});

describe('authorizeCenter', () => {
  it('requires a session', async () => {
    expect(await authorizeCenter(null, 'recoletos')).toEqual({ ok: false, status: 401 });
  });

  it('returns 404 for an unknown center', async () => {
    getCenterBySlug.mockResolvedValue(null);
    expect(await authorizeCenter(manager, 'nope')).toEqual({ ok: false, status: 404 });
  });

  it('lets a registered manager in', async () => {
    const result = await authorizeCenter(manager, 'recoletos');
    expect(result).toMatchObject({ ok: true, center });
    expect(findMembership).toHaveBeenCalledWith('c1', 'ana@example.org');
  });

  it('refuses a manager of another center', async () => {
    findMembership.mockResolvedValue(false);
    expect(await authorizeCenter(manager, 'recoletos')).toEqual({ ok: false, status: 403 });
  });

  it('lets the superadmin into any center without a membership', async () => {
    findMembership.mockResolvedValue(false);
    expect(await authorizeCenter(boss, 'recoletos')).toMatchObject({ ok: true });
  });

  it('lets the superadmin into a disabled center', async () => {
    getCenterBySlug.mockResolvedValue({ ...center, status: 'disabled' });
    expect(await authorizeCenter(boss, 'recoletos')).toMatchObject({ ok: true });
  });
});

describe('authorizeSuperadmin', () => {
  it('maps the three outcomes', () => {
    expect(authorizeSuperadmin(null)).toEqual({ ok: false, status: 401 });
    expect(authorizeSuperadmin(manager)).toEqual({ ok: false, status: 403 });
    expect(authorizeSuperadmin(boss)).toEqual({ ok: true, actor: boss });
  });
});
