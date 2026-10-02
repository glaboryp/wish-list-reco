import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../../lib/crypto';

const key = Buffer.alloc(32, 1).toString('base64');
const otherKey = Buffer.alloc(32, 2).toString('base64');

describe('secret encryption', () => {
  it('round-trips a secret', () => {
    expect(decryptSecret(encryptSecret('paypal-secret', key), key)).toBe('paypal-secret');
  });

  it('uses a fresh IV for every value', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('never contains the plaintext', () => {
    expect(encryptSecret('paypal-secret', key)).not.toContain('paypal-secret');
  });

  it('rejects a tampered payload', () => {
    const parts = encryptSecret('paypal-secret', key).split(':');
    const flipped = Buffer.from(parts[3], 'base64');
    flipped[0] ^= 1;
    parts[3] = flipped.toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', key), otherKey)).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encryptSecret('x', Buffer.alloc(16).toString('base64'))).toThrow(
      'ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    );
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptSecret('nonsense', key)).toThrow();
  });
});
