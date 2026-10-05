import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCenterWithSecret, getPublicItem, credentialsFor, createOrder } = vi.hoisted(() => ({
  getCenterWithSecret: vi.fn(),
  getPublicItem: vi.fn(),
  credentialsFor: vi.fn(),
  createOrder: vi.fn(),
}));

vi.mock('../../lib/repo/centers', () => ({ getCenterWithSecret }));
vi.mock('../../lib/repo/items', () => ({ getPublicItem }));
vi.mock('../../lib/paypal', () => ({ credentialsFor, createOrder }));

import { POST } from '../../pages/api/[slug]/paypal/create-order';

const ITEM_ID = '3f2b8c1e-5a4d-4c8e-9b7a-1d2e3f4a5b6c';
const center = { id: 'c1', slug: 'recoletos', name: 'Recoletos', status: 'active' };
const item = { id: ITEM_ID, name: 'Cáliz', goal: 100, raised: 50, status: 'active' };

const call = (body: unknown, slug = 'recoletos') =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getCenterWithSecret.mockResolvedValue(center);
  getPublicItem.mockResolvedValue(item);
  credentialsFor.mockReturnValue({ clientId: 'cid', clientSecret: 's', env: 'sandbox' });
  createOrder.mockResolvedValue('ORDER-123');
});

describe('POST /api/[slug]/paypal/create-order', () => {
  it('returns 404 for an unknown center', async () => {
    getCenterWithSecret.mockResolvedValue(null);
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(404);
  });

  it('returns 404 for a disabled center and does not charge', async () => {
    getCenterWithSecret.mockResolvedValue({ ...center, status: 'disabled' });
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(404);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('returns 400 if data is missing', async () => {
    const response = await call({});
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Faltan datos');
  });

  it('returns 404 for an item id that is not a uuid without touching the database', async () => {
    expect((await call({ itemId: '1', amount: 10 })).status).toBe(404);
    expect(getPublicItem).not.toHaveBeenCalled();
  });

  it.each([-5, 0, 0.5, 'abc', 'Infinity', Infinity, null])('returns 400 for amount %s', async (amount) => {
    const response = await call({ itemId: ITEM_ID, amount });
    expect(response.status).toBe(400);
  });

  it('returns 400 for exponent notation that exceeds the remaining goal', async () => {
    const response = await call({ itemId: ITEM_ID, amount: '1e9' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('supera lo necesario');
  });

  it('returns 404 if the item is not found in this center', async () => {
    getPublicItem.mockResolvedValue(null);
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(404);
    expect(getPublicItem).toHaveBeenCalledWith('c1', ITEM_ID);
  });

  it('returns 400 if the item is already funded', async () => {
    getPublicItem.mockResolvedValue({ ...item, raised: 100, status: 'funded' });
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(400);
  });

  it('returns 400 if the donation exceeds what is missing', async () => {
    const response = await call({ itemId: ITEM_ID, amount: 51 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('supera lo necesario');
  });

  it('returns 503 when the center has no PayPal credentials', async () => {
    credentialsFor.mockReturnValue(null);
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(503);
  });

  it('creates the order with the center brand name', async () => {
    const response = await call({ itemId: ITEM_ID, amount: 10 });
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe('ORDER-123');
    expect(createOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 10, itemId: ITEM_ID, brandName: 'Recoletos' }),
    );
  });

  it('adds the PayPal button fees when the donor covers them', async () => {
    await call({ itemId: ITEM_ID, amount: 10, coverFees: true, paymentSource: 'paypal' });
    expect(createOrder.mock.calls[0][1].amount).toBe(10.66);
  });

  it('adds the reduced card fees of a center that has them', async () => {
    getCenterWithSecret.mockResolvedValue({ ...center, fees: { paypal: { rate: 0.029, fixed: 0.35 }, card: { rate: 0.012, fixed: 0.35 } } });
    await call({ itemId: ITEM_ID, amount: 10, coverFees: true, paymentSource: 'card' });
    expect(createOrder.mock.calls[0][1].amount).toBe(10.48);
  });

  it('uses the standard fees for the card button by default', async () => {
    await call({ itemId: ITEM_ID, amount: 10, coverFees: true, paymentSource: 'card' });
    expect(createOrder.mock.calls[0][1].amount).toBe(10.66);
  });

  it('falls back to the PayPal fees for an unknown payment source', async () => {
    await call({ itemId: ITEM_ID, amount: 10, coverFees: true, paymentSource: 'other' });
    expect(createOrder.mock.calls[0][1].amount).toBe(10.66);
  });

  it('uses the fees configured for the center', async () => {
    getCenterWithSecret.mockResolvedValue({ ...center, fees: { paypal: { rate: 0.05, fixed: 0.5 }, card: { rate: 0.012, fixed: 0.35 } } });
    await call({ itemId: ITEM_ID, amount: 10, coverFees: true, paymentSource: 'paypal' });
    expect(createOrder.mock.calls[0][1].amount).toBe(11.05);
  });

  it('does not add fees unless the donor asks for it', async () => {
    await call({ itemId: ITEM_ID, amount: 10, paymentSource: 'card' });
    expect(createOrder.mock.calls[0][1].amount).toBe(10);
  });

  it('returns 500 when PayPal fails', async () => {
    createOrder.mockRejectedValue(new Error('boom'));
    expect((await call({ itemId: ITEM_ID, amount: 10 })).status).toBe(500);
  });
});
