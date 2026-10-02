import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../../lib/auth/session';

const secret = 'a'.repeat(40);
const payload = { email: 'ana@example.org', uid: 'uid-1' };

describe('session cookie', () => {
  it('round-trips the payload', async () => {
    expect(await verifySession(await signSession(payload, secret), secret)).toEqual(payload);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signSession(payload, secret);
    expect(await verifySession(token, 'b'.repeat(40))).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await signSession(payload, secret);
    const [header, body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), email: 'boss@example.org' })).toString('base64url');
    expect(await verifySession(`${header}.${forged}.${signature}`, secret)).toBeNull();
  });

  it('rejects an expired token', async () => {
    expect(await verifySession(await signSession(payload, secret, -10), secret)).toBeNull();
  });

  it('rejects an unsigned token', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none' })}.${encode({ sub: 'uid-1', email: payload.email })}.`;
    expect(await verifySession(token, secret)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifySession('not-a-token', secret)).toBeNull();
  });

  it('refuses to sign with a short secret', async () => {
    await expect(signSession(payload, 'short')).rejects.toThrow('SESSION_SECRET');
  });
});
