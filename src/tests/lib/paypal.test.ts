import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../../lib/crypto';
import { apiBase, captureOrder, createOrder, credentialsFor, PayPalError } from '../../lib/paypal';
import type { CenterWithSecret } from '../../types/database';

const key = Buffer.alloc(32, 1).toString('base64');
const creds = { clientId: 'cid', clientSecret: 'secret', env: 'sandbox' as const };

const center = (overrides: Partial<CenterWithSecret> = {}) =>
  ({
    paypal_client_id: 'cid',
    paypal_secret_encrypted: encryptSecret('secret', key),
    paypal_env: 'live',
    ...overrides,
  }) as CenterWithSecret;

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body, text: async () => '' });

const completed = {
  status: 'COMPLETED',
  purchase_units: [
    { payments: { captures: [{ id: 'CAP1', custom_id: 'item-1', amount: { value: '12.00', currency_code: 'EUR' }, status: 'COMPLETED' }] } },
  ],
};

beforeEach(() => fetchMock.mockReset());

describe('credentialsFor', () => {
  it('decrypts the stored secret', () => {
    expect(credentialsFor(center(), key)).toEqual({ clientId: 'cid', clientSecret: 'secret', env: 'live' });
  });

  it('returns null when anything is missing', () => {
    expect(credentialsFor(center({ paypal_client_id: null }), key)).toBeNull();
    expect(credentialsFor(center({ paypal_secret_encrypted: null }), key)).toBeNull();
  });
});

describe('apiBase', () => {
  it('maps the environment to the API host', () => {
    expect(apiBase('live')).toBe('https://api-m.paypal.com');
    expect(apiBase('sandbox')).toBe('https://api-m.sandbox.paypal.com');
  });
});

describe('createOrder', () => {
  it('creates an order with the center brand name and returns its id', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok({ id: 'ORDER-1' }));
    const id = await createOrder(creds, { amount: 10, description: 'Donación para: Cáliz', itemId: 'item-1', brandName: 'Recoletos' });
    expect(id).toBe('ORDER-1');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.application_context.brand_name).toBe('Recoletos');
    expect(body.purchase_units[0]).toMatchObject({ custom_id: 'item-1', amount: { currency_code: 'EUR', value: '10.00' } });
  });

  it('throws when the token request fails', async () => {
    fetchMock.mockResolvedValueOnce(fail(401, {}));
    await expect(createOrder(creds, { amount: 1, description: 'd', itemId: 'i', brandName: 'b' })).rejects.toBeInstanceOf(PayPalError);
  });

  it('asserts the Authorization header Basic on token call and Bearer on order call', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok({ id: 'ORDER-1' }));
    await createOrder(creds, { amount: 1, description: 'd', itemId: 'i', brandName: 'b' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  it('throws when token response 200 without access_token', async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await expect(createOrder(creds, { amount: 1, description: 'd', itemId: 'i', brandName: 'b' })).rejects.toBeInstanceOf(PayPalError);
  });
});

describe('captureOrder', () => {
  it('returns the capture details', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok(completed));
    expect(await captureOrder(creds, 'ORDER-1')).toEqual({ captureId: 'CAP1', amount: '12.00', currency: 'EUR', itemId: 'item-1' });
  });

  it('recovers an already captured order by reading it back', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'tok' }))
      .mockResolvedValueOnce(fail(422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }))
      .mockResolvedValueOnce(ok(completed));
    const result = await captureOrder(creds, 'ORDER-1');
    expect(result.captureId).toBe('CAP1');
    expect(fetchMock.mock.calls[2][0]).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1');
  });

  it('throws on other capture failures', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(fail(400, {}));
    await expect(captureOrder(creds, 'ORDER-1')).rejects.toBeInstanceOf(PayPalError);
  });

  it('throws when the order is not completed', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok({ status: 'PENDING' }));
    await expect(captureOrder(creds, 'ORDER-1')).rejects.toThrow('order not completed');
  });

  it('throws when the capture lacks the item reference', async () => {
    const broken = { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP1', amount: { value: '1', currency_code: 'EUR' } }] } }] };
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok(broken));
    await expect(captureOrder(creds, 'ORDER-1')).rejects.toThrow('incomplete capture data');
  });

  it('rejects non-JSON failure body on capture call with PayPalError carrying status', async () => {
    const jsonError = () => {
      throw new SyntaxError('Invalid JSON');
    };
    const failResponse = { ok: false, status: 500, json: jsonError, text: async () => '' };
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(failResponse);
    const error = await captureOrder(creds, 'ORDER-1').catch((e) => e);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error.status).toBe(500);
  });

  it('returns the COMPLETED capture when multiple captures exist', async () => {
    const multiCapture = {
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            captures: [
              { id: 'CAP1', custom_id: 'item-1', amount: { value: '5.00', currency_code: 'EUR' }, status: 'PENDING' },
              { id: 'CAP2', custom_id: 'item-1', amount: { value: '12.00', currency_code: 'EUR' }, status: 'COMPLETED' },
            ],
          },
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'tok' })).mockResolvedValueOnce(ok(multiCapture));
    const result = await captureOrder(creds, 'ORDER-1');
    expect(result.captureId).toBe('CAP2');
    expect(result.amount).toBe('12.00');
  });
});
