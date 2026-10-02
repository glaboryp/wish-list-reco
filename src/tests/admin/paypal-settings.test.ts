import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updatePaypal } = vi.hoisted(() => ({ updatePaypal: vi.fn() }));
vi.mock('../../lib/repo/centers', () => ({ updatePaypal }));

import { decryptSecret } from '../../lib/crypto';
import { savePaypalSettings } from '../../lib/admin/paypal-settings';

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
});
