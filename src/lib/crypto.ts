import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function parseKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64 ?? '', 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

export function encryptSecret(plain: string, keyB64: string): string {
  const key = parseKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string, keyB64: string): string {
  const key = parseKey(keyB64);
  const [version, iv, tag, encrypted] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error('Malformed encrypted secret');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
