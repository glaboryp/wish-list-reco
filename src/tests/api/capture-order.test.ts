import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCenterWithSecret, recordPaypalDonation, credentialsFor, captureOrder } = vi.hoisted(() => ({
  getCenterWithSecret: vi.fn(),
  recordPaypalDonation: vi.fn(),
  credentialsFor: vi.fn(),
  captureOrder: vi.fn(),
}));

vi.mock('../../lib/repo/centers', () => ({ getCenterWithSecret }));
vi.mock('../../lib/repo/donations', () => ({ recordPaypalDonation }));
vi.mock('../../lib/paypal', () => ({ credentialsFor, captureOrder }));

import { POST } from '../../pages/api/[slug]/paypal/capture-order';

const capture = { captureId: 'CAP1', amount: '12.00', currency: 'EUR', itemId: 'item-1' };
const center = { id: 'c1', slug: 'recoletos', status: 'active' };

const call = (body: unknown, slug = 'recoletos') =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getCenterWithSecret.mockResolvedValue(center);
  credentialsFor.mockReturnValue({ clientId: 'cid', clientSecret: 's', env: 'sandbox' });
  captureOrder.mockResolvedValue(capture);
  recordPaypalDonation.mockResolvedValue('created');
});

describe('POST /api/[slug]/paypal/capture-order', () => {
  it('returns 404 for an unknown center', async () => {
    getCenterWithSecret.mockResolvedValue(null);
    expect((await call({ orderID: 'O1' })).status).toBe(404);
  });

  it('returns 400 if orderID is missing', async () => {
    expect((await call({})).status).toBe(400);
  });

  it('returns 503 without credentials', async () => {
    credentialsFor.mockReturnValue(null);
    expect((await call({ orderID: 'O1' })).status).toBe(503);
  });

  it('returns 500 if the capture fails', async () => {
    captureOrder.mockRejectedValue(new Error('boom'));
    expect((await call({ orderID: 'O1' })).status).toBe(500);
    expect(recordPaypalDonation).not.toHaveBeenCalled();
  });

  it('records the donation against the center of the route', async () => {
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, amount: '12.00', itemId: 'item-1', duplicate: false });
    expect(recordPaypalDonation).toHaveBeenCalledWith({
      centerId: 'c1',
      itemId: 'item-1',
      amount: '12.00',
      currency: 'EUR',
      captureId: 'CAP1',
    });
  });

  it('is idempotent when the capture was already recorded', async () => {
    recordPaypalDonation.mockResolvedValue('duplicate');
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
  });

  it('still captures an approved order when the center was disabled mid-flow', async () => {
    getCenterWithSecret.mockResolvedValue({ ...center, status: 'disabled' });
    expect((await call({ orderID: 'O1' })).status).toBe(200);
  });

  it('reports the payment id when the database write fails after capture', async () => {
    recordPaypalDonation.mockRejectedValue(new Error('db down'));
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ paymentId: 'CAP1', itemId: 'item-1', amount: '12.00' });
  });

  it('reports the payment id when the item does not belong to the center', async () => {
    recordPaypalDonation.mockResolvedValue('item_not_found');
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(500);
    expect((await response.json()).paymentId).toBe('CAP1');
  });

  it('does not record a capture in a currency other than EUR', async () => {
    captureOrder.mockResolvedValue({ ...capture, currency: 'JPY', amount: '1000' });
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ paymentId: 'CAP1', itemId: 'item-1', amount: '1000' });
    expect(recordPaypalDonation).not.toHaveBeenCalled();
  });
});
