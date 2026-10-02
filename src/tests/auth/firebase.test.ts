import { SignJWT, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyFirebaseIdToken } from '../../lib/auth/firebase';

const projectId = 'demo-project';
let privateKey: CryptoKey;
let publicKey: CryptoKey;
const keys = async () => publicKey;

const mint = (claims: Record<string, unknown> = {}, options: { aud?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT({
    email: 'Ana@Example.org',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('uid-1')
    .setIssuer(options.iss ?? `https://securetoken.google.com/${projectId}`)
    .setAudience(options.aud ?? projectId)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? '1h')
    .sign(privateKey);

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair('RS256'));
});

describe('verifyFirebaseIdToken', () => {
  it('returns the uid and the lowercase email', async () => {
    expect(await verifyFirebaseIdToken(await mint(), projectId, keys)).toEqual({ uid: 'uid-1', email: 'ana@example.org' });
  });

  it('rejects another project audience', async () => {
    await expect(verifyFirebaseIdToken(await mint({}, { aud: 'other' }), projectId, keys)).rejects.toThrow();
  });

  it('rejects another issuer', async () => {
    await expect(verifyFirebaseIdToken(await mint({}, { iss: 'https://evil.example.com' }), projectId, keys)).rejects.toThrow();
  });

  it('rejects an unverified email', async () => {
    await expect(verifyFirebaseIdToken(await mint({ email_verified: false }), projectId, keys)).rejects.toThrow();
  });

  it('rejects a provider other than Google', async () => {
    await expect(
      verifyFirebaseIdToken(await mint({ firebase: { sign_in_provider: 'password' } }), projectId, keys),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    await expect(verifyFirebaseIdToken(await mint({}, { exp: '-1h' }), projectId, keys)).rejects.toThrow();
  });

  it('rejects a token signed by an unknown key', async () => {
    const other = await generateKeyPair('RS256');
    const foreign = await verifyFirebaseIdToken(await mint(), projectId, async () => other.publicKey).catch(() => 'rejected');
    expect(foreign).toBe('rejected');
  });

  it('rejects a token signed with a different algorithm even if key resolves', async () => {
    const es256Pair = await generateKeyPair('ES256');
    const es256Token = await new SignJWT({
      email: 'Ana@Example.org',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject('uid-1')
      .setIssuer(`https://securetoken.google.com/${projectId}`)
      .setAudience(projectId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(es256Pair.privateKey);
    await expect(verifyFirebaseIdToken(es256Token, projectId, async () => es256Pair.publicKey)).rejects.toThrow();
  });
});
