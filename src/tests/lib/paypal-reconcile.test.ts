import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookupOrder: vi.fn(),
  credentialsFor: vi.fn(),
  getCenterWithSecretById: vi.fn(),
  recordPaypalDonation: vi.fn(),
  listReconcilableCaptures: vi.fn(),
  resolvePendingCapture: vi.fn(),
  touchPendingCapture: vi.fn(),
}));

vi.mock('../../lib/paypal', () => ({ lookupOrder: mocks.lookupOrder, credentialsFor: mocks.credentialsFor }));
vi.mock('../../lib/repo/centers', () => ({ getCenterWithSecretById: mocks.getCenterWithSecretById }));
vi.mock('../../lib/repo/donations', () => ({ recordPaypalDonation: mocks.recordPaypalDonation }));
vi.mock('../../lib/repo/pending-captures', () => ({
  listReconcilableCaptures: mocks.listReconcilableCaptures,
  resolvePendingCapture: mocks.resolvePendingCapture,
  touchPendingCapture: mocks.touchPendingCapture,
}));

import { reconcilePendingCaptures } from '../../lib/paypal-reconcile';

const capture = { captureId: 'CAP1', amount: '10.66', currency: 'EUR', itemId: 'item-1', donationAmount: '10.00' };
const now = new Date('2026-10-09T12:00:00Z');
const pending = (overrides = {}) => ({
  paypal_order_id: 'O1',
  center_id: 'c1',
  item_id: 'item-1',
  created_at: '2026-10-09T11:30:00Z',
  ...overrides,
});
const run = () => reconcilePendingCaptures({ encryptionKey: 'k', now });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCenterWithSecretById.mockResolvedValue({ id: 'c1' });
  mocks.credentialsFor.mockReturnValue({ clientId: 'a', clientSecret: 'b', env: 'sandbox' });
  mocks.listReconcilableCaptures.mockResolvedValue([pending()]);
  mocks.recordPaypalDonation.mockResolvedValue('created');
  mocks.touchPendingCapture.mockResolvedValue(undefined);
  mocks.resolvePendingCapture.mockResolvedValue(undefined);
});

describe('reconcilePendingCaptures', () => {
  it('records a completed order from PayPal data, net of the covered fee', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    expect(await run()).toMatchObject({ checked: 1, recorded: 1 });
    expect(mocks.recordPaypalDonation).toHaveBeenCalledWith({
      centerId: 'c1',
      itemId: 'item-1',
      amount: '10.00',
      feeAmount: '0.66',
      currency: 'EUR',
      captureId: 'CAP1',
    });
    expect(mocks.resolvePendingCapture).toHaveBeenCalledWith('O1', 'recorded');
  });

  it('treats an already recorded capture as resolved', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    mocks.recordPaypalDonation.mockResolvedValue('duplicate');
    expect(await run()).toMatchObject({ recorded: 1 });
  });

  it('flags a completed order that cannot be recorded', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    mocks.recordPaypalDonation.mockResolvedValue('item_not_found');
    expect(await run()).toMatchObject({ needsReview: 1 });
    expect(mocks.resolvePendingCapture).toHaveBeenCalledWith('O1', 'needs_review', expect.stringContaining('CAP1'));
  });

  it('flags a completed order in a currency other than EUR without recording it', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture: { ...capture, currency: 'JPY' } });
    expect(await run()).toMatchObject({ needsReview: 1 });
    expect(mocks.recordPaypalDonation).not.toHaveBeenCalled();
  });

  it('leaves a recent unfinished order pending', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'not_completed', status: 'CREATED' });
    expect(await run()).toMatchObject({ stillPending: 1 });
    expect(mocks.resolvePendingCapture).not.toHaveBeenCalled();
    expect(mocks.touchPendingCapture).toHaveBeenCalled();
  });

  it('marks an old abandoned order as not paid', async () => {
    mocks.listReconcilableCaptures.mockResolvedValue([pending({ created_at: '2026-10-09T05:00:00Z' })]);
    mocks.lookupOrder.mockResolvedValue({ state: 'not_completed', status: 'CREATED' });
    expect(await run()).toMatchObject({ notPaid: 1 });
    expect(mocks.resolvePendingCapture).toHaveBeenCalledWith('O1', 'not_paid', 'order CREATED');
  });

  it('flags an old order approved by the payer but never captured', async () => {
    mocks.listReconcilableCaptures.mockResolvedValue([pending({ created_at: '2026-10-09T05:00:00Z' })]);
    mocks.lookupOrder.mockResolvedValue({ state: 'not_completed', status: 'APPROVED' });
    expect(await run()).toMatchObject({ needsReview: 1 });
  });

  it('marks an order unknown to PayPal as not paid', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'not_found' });
    expect(await run()).toMatchObject({ notPaid: 1 });
  });

  it('keeps going and counts the error when PayPal fails for one order', async () => {
    mocks.listReconcilableCaptures.mockResolvedValue([pending(), pending({ paypal_order_id: 'O2' })]);
    mocks.lookupOrder.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ state: 'completed', capture });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toMatchObject({ checked: 2, errors: 1, recorded: 1 });
    expect(mocks.touchPendingCapture).toHaveBeenCalledWith('O1', 'network');
  });

  it('flags orders of a center without PayPal credentials', async () => {
    mocks.credentialsFor.mockReturnValue(null);
    expect(await run()).toMatchObject({ needsReview: 1 });
    expect(mocks.lookupOrder).not.toHaveBeenCalled();
  });

  it('loads the credentials of each center once', async () => {
    mocks.listReconcilableCaptures.mockResolvedValue([pending(), pending({ paypal_order_id: 'O2' })]);
    mocks.lookupOrder.mockResolvedValue({ state: 'not_found' });
    await run();
    expect(mocks.getCenterWithSecretById).toHaveBeenCalledTimes(1);
  });
});
