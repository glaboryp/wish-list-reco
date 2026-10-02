import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 5 * 24 * 60 * 60;

export interface SessionPayload {
  email: string;
  uid: string;
}

function signingKey(secret: string): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(
  payload: SessionPayload,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.uid)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(signingKey(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: ['HS256'] });
    if (typeof payload.email !== 'string' || !payload.sub) return null;
    return { email: payload.email, uid: payload.sub };
  } catch {
    return null;
  }
}
