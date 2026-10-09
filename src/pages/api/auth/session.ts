import type { APIRoute } from 'astro';
import { isSuperadminEmail } from '../../../lib/auth/access';
import { verifyFirebaseIdToken } from '../../../lib/auth/firebase';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from '../../../lib/auth/session';
import { getSessionVersion } from '../../../lib/repo/sessions';
import { linkFirebaseUid, listMembershipsByEmail } from '../../../lib/repo/users';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  let idToken: unknown;
  try {
    ({ idToken } = await request.json());
  } catch {
    idToken = undefined;
  }
  if (typeof idToken !== 'string' || !idToken) {
    return json({ error: 'Falta el token de acceso' }, 400);
  }

  let identity;
  try {
    identity = await verifyFirebaseIdToken(idToken, import.meta.env.PUBLIC_FIREBASE_PROJECT_ID);
  } catch {
    return json({ error: 'No se pudo verificar tu cuenta de Google' }, 401);
  }

  const isSuperadmin = isSuperadminEmail(identity.email);
  const memberships = await listMembershipsByEmail(identity.email);
  if (!isSuperadmin && memberships.length === 0) {
    return json({ error: 'Este correo no tiene acceso a ningún centro' }, 403);
  }

  await linkFirebaseUid(identity.email, identity.uid);

  const token = await signSession(
    { email: identity.email, uid: identity.uid, sv: await getSessionVersion(identity.email) },
    import.meta.env.SESSION_SECRET,
  );
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return json({ redirect: isSuperadmin ? '/admin' : `/${memberships[0].slug}/admin` });
};
