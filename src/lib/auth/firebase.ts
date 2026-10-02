import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const GOOGLE_KEYS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

let remoteKeys: JWTVerifyGetKey | undefined;
const googleKeys: JWTVerifyGetKey = (header, token) => {
  remoteKeys ??= createRemoteJWKSet(GOOGLE_KEYS_URL);
  return remoteKeys(header, token);
};

export interface FirebaseIdentity {
  uid: string;
  email: string;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<FirebaseIdentity> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const provider = (payload as { firebase?: { sign_in_provider?: string } }).firebase?.sign_in_provider;
  if (!payload.sub || !email || payload.email_verified !== true || provider !== 'google.com') {
    throw new Error('Unacceptable identity');
  }
  return { uid: payload.sub, email };
}
