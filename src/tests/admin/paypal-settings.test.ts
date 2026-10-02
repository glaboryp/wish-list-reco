import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updatePaypal } = vi.hoisted(() => ({ updatePaypal: vi.fn() }));
vi.mock('../../lib/repo/centers', () => ({ updatePaypal }));

import { decryptSecret } from '../../lib/crypto';
import { requiresNewSecret, savePaypalSettings } from '../../lib/admin/paypal-settings';

const key = Buffer.alloc(32, 1).toString('base64');

beforeEach(() => vi.clearAllMocks());

describe('savePaypalSettings', () => {
  it('encrypts a new secret before storing it', async () => {
    await savePaypalSettings('c1', { clientId: 'AbCdEfGhIjKlMn', env: 'live', secret: 'EXAMPLE-SECRET' }, key);
    const stored = updatePaypal.mock.calls[0][1];
    expect(stored.clientId).toBe('AbCdEfGhIjKlMn');
    expect(stored.env).toBe('live');
    expect(stored.secretEncrypted).not.toContain('EXAMPLE-SECRET');
    expect(decryptSecret(stored.secretEncrypted, key)).toBe('EXAMPLE-SECRET');
  });

  it('passes null so the stored secret is kept when the field is blank', async () => {
    await savePaypalSettings('c1', { clientId: 'AbCdEfGhIjKlMn', env: 'sandbox', secret: null }, key);
    expect(updatePaypal).toHaveBeenCalledWith('c1', { clientId: 'AbCdEfGhIjKlMn', env: 'sandbox', secretEncrypted: null });
  });

  it('rejects with the key error and does not store when the key is invalid', async () => {
    await expect(
      savePaypalSettings('c1', { clientId: 'AbCdEfGhIjKlMn', env: 'live', secret: 'EXAMPLE-SECRET' }, 'bad'),
    ).rejects.toThrow('ENCRYPTION_KEY must be 32 bytes');
    expect(updatePaypal).not.toHaveBeenCalled();
  });
});

describe('requiresNewSecret', () => {
  const configured = { paypal_configured: true, paypal_client_id: 'AbCdEfGhIjKlMn', paypal_env: 'sandbox' as const };
  const input = { clientId: 'AbCdEfGhIjKlMn', env: 'sandbox' as const, secret: null };

  it('requires a secret when the center is not configured', () => {
    expect(requiresNewSecret({ ...configured, paypal_configured: false }, input)).toBe(true);
  });

  it('keeps the stored secret when client id and env are unchanged', () => {
    expect(requiresNewSecret(configured, input)).toBe(false);
  });

  it('requires a secret when the env changes', () => {
    expect(requiresNewSecret(configured, { ...input, env: 'live' })).toBe(true);
  });

  it('requires a secret when the client id changes', () => {
    expect(requiresNewSecret(configured, { ...input, clientId: 'ZzZzZzZzZzZzZz' })).toBe(true);
  });

  it('never requires one when a secret is supplied', () => {
    expect(requiresNewSecret({ ...configured, paypal_configured: false }, { ...input, env: 'live', secret: 'S' })).toBe(false);
    expect(requiresNewSecret(configured, { ...input, clientId: 'other', secret: 'S' })).toBe(false);
  });
});
