import { getCenterBySlug } from '../repo/centers';
import { getSessionVersion } from '../repo/sessions';
import { findMembership } from '../repo/users';
import type { Center } from '../../types/database';
import { SESSION_COOKIE, verifySession } from './session';

export interface Actor {
  email: string;
  uid: string;
  isSuperadmin: boolean;
}

export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export type AccessResult =
  | { ok: true; actor: Actor; center: Center }
  | { ok: false; status: 401 | 403 | 404 };

export type SuperadminResult = { ok: true; actor: Actor } | { ok: false; status: 401 | 403 };

export function isSuperadminEmail(email: string): boolean {
  const superadmin = (import.meta.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase();
  return superadmin !== '' && email === superadmin;
}

export async function getActor(cookies: CookieReader): Promise<Actor | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token, import.meta.env.SESSION_SECRET);
  if (!session) return null;
  if (session.sv < (await getSessionVersion(session.email))) return null;
  return { email: session.email, uid: session.uid, isSuperadmin: isSuperadminEmail(session.email) };
}

export async function authorizeCenter(actor: Actor | null, slug: string): Promise<AccessResult> {
  if (!actor) return { ok: false, status: 401 };
  const center = await getCenterBySlug(slug);
  if (!center) return { ok: false, status: 404 };
  if (actor.isSuperadmin) return { ok: true, actor, center };
  if (!(await findMembership(center.id, actor.email))) return { ok: false, status: 403 };
  return { ok: true, actor, center };
}

export function authorizeSuperadmin(actor: Actor | null): SuperadminResult {
  if (!actor) return { ok: false, status: 401 };
  if (!actor.isSuperadmin) return { ok: false, status: 403 };
  return { ok: true, actor };
}
