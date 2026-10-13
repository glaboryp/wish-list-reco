import type { APIRoute } from 'astro';
import { getActor } from '../../../lib/auth/access';
import { SESSION_COOKIE } from '../../../lib/auth/session';
import { recordAudit } from '../../../lib/repo/audit';
import { bumpSessionVersion } from '../../../lib/repo/sessions';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const actor = await getActor(cookies);
  if (actor) {
    await bumpSessionVersion(actor.email);
    await recordAudit({
      centerId: null,
      actorEmail: actor.email,
      action: 'session.revoke_all',
      entityType: 'session',
      summary: 'Sesión cerrada en todos los dispositivos',
    });
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/login', 303);
};
