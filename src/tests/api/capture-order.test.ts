import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCenterWithSecret, recordPaypalDonation, credentialsFor, captureOrder, lookupOrder, resolvePendingCapture, touchPendingCapture, notifyDonation } = vi.hoisted(() => ({
  touchPendingCapture: vi.fn(),
  notifyDonation: vi.fn(),
  getCenterWithSecret: vi.fn(),
  recordPaypalDonation: vi.fn(),
  credentialsFor: vi.fn(),
  captureOrder: vi.fn(),
  lookupOrder: vi.fn(),
  resolvePendingCapture: vi.fn(),
}));

vi.mock('../../lib/repo/centers', () => ({ getCenterWithSecret }));
vi.mock('../../lib/repo/donations', () => ({ recordPaypalDonation }));
vi.mock('../../lib/email/notify', () => ({ notifyDonation }));
vi.mock('../../lib/paypal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/paypal')>()),
  credentialsFor,
  captureOrder,
  lookupOrder,
}));
vi.mock('../../lib/repo/pending-captures', () => ({ resolvePendingCapture, touchPendingCapture }));

import { POST } from '../../pages/api/[slug]/paypal/capture-order';
import { PayPalError } from '../../lib/paypal';

const capture = { captureId: 'CAP1', amount: '12.00', currency: 'EUR', itemId: 'item-1', donationAmount: null, payerEmail: 'donor@example.org' };
const center = { id: 'c1', slug: 'recoletos', status: 'active' };
const completed = (overrides = {}) => ({ state: 'completed', capture: { ...capture, ...overrides } });

const call = (body: unknown, slug = 'recoletos') =>
  POST({
    request: new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  getCenterWithSecret.mockResolvedValue(center);
  credentialsFor.mockReturnValue({ clientId: 'cid', clientSecret: 's', env: 'sandbox' });
  captureOrder.mockResolvedValue(completed());
  recordPaypalDonation.mockResolvedValue('created');
  lookupOrder.mockResolvedValue({ state: 'not_found' });
  resolvePendingCapture.mockResolvedValue(undefined);
  touchPendingCapture.mockResolvedValue(undefined);
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
      feeAmount: '0.00',
      currency: 'EUR',
      captureId: 'CAP1',
    });
  });

  it('credits only the donation when the donor covered the fees, and keeps the fee apart', async () => {
    captureOrder.mockResolvedValue(completed({ amount: '10.66', donationAmount: '10.00' }));
    const response = await call({ orderID: 'O1' });
    expect(await response.json()).toMatchObject({ ok: true, amount: '10.00', chargedAmount: '10.66' });
    expect(recordPaypalDonation).toHaveBeenCalledWith(expect.objectContaining({ amount: '10.00', feeAmount: '0.66' }));
  });

  it('notifies after a new donation with the payer email, and not on duplicates', async () => {
    await call({ orderID: 'O1' });
    expect(notifyDonation).toHaveBeenCalledWith({ center, itemId: 'item-1', amount: '12.00', donorEmail: 'donor@example.org' });
    notifyDonation.mockClear();
    recordPaypalDonation.mockResolvedValue('duplicate');
    await call({ orderID: 'O1' });
    expect(notifyDonation).not.toHaveBeenCalled();
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
    captureOrder.mockResolvedValue(completed({ currency: 'JPY', amount: '1000' }));
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ paymentId: 'CAP1', itemId: 'item-1', amount: '1000' });
    expect(recordPaypalDonation).not.toHaveBeenCalled();
  });

  it('marks the pending order as recorded after a successful registration', async () => {
    await call({ orderID: 'O1' });
    expect(resolvePendingCapture).toHaveBeenCalledWith('O1', 'recorded');
  });

  it('recovers the donation from PayPal when the capture call fails but the order is completed', async () => {
    captureOrder.mockRejectedValue(new Error('timeout'));
    lookupOrder.mockResolvedValue(completed());
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(200);
    expect(recordPaypalDonation).toHaveBeenCalledWith(expect.objectContaining({ captureId: 'CAP1', amount: '12.00' }));
    expect(resolvePendingCapture).toHaveBeenCalledWith('O1', 'recorded');
  });

  it('fails without recording when PayPal says the order was not paid', async () => {
    captureOrder.mockRejectedValue(new Error('declined'));
    lookupOrder.mockResolvedValue({ state: 'not_completed', status: 'APPROVED' });
    expect((await call({ orderID: 'O1' })).status).toBe(500);
    expect(recordPaypalDonation).not.toHaveBeenCalled();
  });

  it('fails cleanly when the order lookup itself fails', async () => {
    captureOrder.mockRejectedValue(new Error('timeout'));
    lookupOrder.mockRejectedValue(new Error('network'));
    expect((await call({ orderID: 'O1' })).status).toBe(500);
  });

  it('keeps the order pending for the reconciler when the database write fails', async () => {
    recordPaypalDonation.mockRejectedValue(new Error('db down'));
    await call({ orderID: 'O1' });
    expect(resolvePendingCapture).not.toHaveBeenCalled();
  });

  it('flags the order for review when the item does not belong to the center', async () => {
    recordPaypalDonation.mockResolvedValue('item_not_found');
    await call({ orderID: 'O1' });
    expect(resolvePendingCapture).toHaveBeenCalledWith('O1', 'needs_review', 'item_not_found', 'CAP1');
  });

  it('tells the donor a capture PayPal is still processing is not a failure, and leaves it for the reconciler', async () => {
    captureOrder.mockResolvedValue({ state: 'capture_pending', captureId: 'CAP1' });
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ pending: true, captureId: 'CAP1' });
    expect(body.message).toContain('No hace falta que vuelvas a pagar');
    expect(recordPaypalDonation).not.toHaveBeenCalled();
    expect(resolvePendingCapture).not.toHaveBeenCalled();
    expect(touchPendingCapture).toHaveBeenCalledWith('O1', expect.stringContaining('PENDING'), 'CAP1');
  });

  it('also reports a processing capture found while recovering from a capture error', async () => {
    captureOrder.mockRejectedValue(new Error('timeout'));
    lookupOrder.mockResolvedValue({ state: 'capture_pending', captureId: 'CAP1' });
    expect((await call({ orderID: 'O1' })).status).toBe(202);
  });

  it('does not credit a refunded capture, flags it and does not invite paying again', async () => {
    captureOrder.mockResolvedValue({ state: 'capture_failed', captureId: 'CAP1', status: 'REFUNDED' });
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('No lo repitas');
    expect(recordPaypalDonation).not.toHaveBeenCalled();
    expect(resolvePendingCapture).toHaveBeenCalledWith('O1', 'needs_review', expect.stringContaining('REFUNDED'), 'CAP1');
  });

  it('surfaces a declined card as a 422 the donor can act on, without looking the order up', async () => {
    captureOrder.mockRejectedValue(new PayPalError('capture failed', 422, 'INSTRUMENT_DECLINED'));
    const response = await call({ orderID: 'O1' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'INSTRUMENT_DECLINED', error: expect.stringContaining('no se ha cobrado nada') });
    expect(lookupOrder).not.toHaveBeenCalled();
    expect(recordPaypalDonation).not.toHaveBeenCalled();
  });
});
