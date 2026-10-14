import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookupOrder: vi.fn(),
  credentialsFor: vi.fn(),
  getCenterWithSecretById: vi.fn(),
  recordPaypalDonation: vi.fn(),
  recordReconciledCapture: vi.fn(),
  pruneFinishedCaptures: vi.fn(),
  notifyDonation: vi.fn(),
  listReconcilableCaptures: vi.fn(),
  resolvePendingCapture: vi.fn(),
  touchPendingCapture: vi.fn(),
}));

vi.mock('../../lib/paypal', () => ({ lookupOrder: mocks.lookupOrder, credentialsFor: mocks.credentialsFor }));
vi.mock('../../lib/repo/centers', () => ({ getCenterWithSecretById: mocks.getCenterWithSecretById }));
vi.mock('../../lib/repo/donations', () => ({ recordPaypalDonation: mocks.recordPaypalDonation }));
vi.mock('../../lib/email/notify', () => ({ notifyDonation: mocks.notifyDonation }));
vi.mock('../../lib/repo/pending-captures', () => ({
  recordReconciledCapture: mocks.recordReconciledCapture,
  pruneFinishedCaptures: mocks.pruneFinishedCaptures,
  listReconcilableCaptures: mocks.listReconcilableCaptures,
  resolvePendingCapture: mocks.resolvePendingCapture,
  touchPendingCapture: mocks.touchPendingCapture,
}));

import { reconcilePendingCaptures } from '../../lib/paypal-reconcile';

const capture = { captureId: 'CAP1', amount: '10.66', currency: 'EUR', itemId: 'item-1', donationAmount: '10.00', payerEmail: 'donor@example.org' };
const center = { id: 'c1', name: 'Recoletos' };
const now = new Date('2026-10-09T12:00:00Z');
const pending = (overrides = {}) => ({
  paypal_order_id: 'O1',
  center_id: 'c1',
  item_id: 'item-1',
  created_at: '2026-10-09T11:30:00Z',
  cursor: '2026-10-09 11:30:00+00',
  ...overrides,
});
const run = () => reconcilePendingCaptures({ encryptionKey: 'k', now });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCenterWithSecretById.mockResolvedValue(center);
  mocks.credentialsFor.mockReturnValue({ clientId: 'a', clientSecret: 'b', env: 'sandbox' });
  mocks.listReconcilableCaptures.mockResolvedValueOnce([pending()]).mockResolvedValue([]);
  mocks.recordReconciledCapture.mockResolvedValue('created');
  mocks.pruneFinishedCaptures.mockResolvedValue(0);
  mocks.notifyDonation.mockResolvedValue(undefined);
  mocks.touchPendingCapture.mockResolvedValue(undefined);
  mocks.resolvePendingCapture.mockResolvedValue(undefined);
});

describe('reconcilePendingCaptures', () => {
  it('records a completed order from PayPal data, net of the covered fee', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    expect(await run()).toMatchObject({ checked: 1, recorded: 1 });
    expect(mocks.recordReconciledCapture).toHaveBeenCalledWith({
      orderId: 'O1',
      centerId: 'c1',
      itemId: 'item-1',
      amount: '10.00',
      feeAmount: '0.66',
      currency: 'EUR',
      captureId: 'CAP1',
    });
    expect(mocks.recordPaypalDonation).not.toHaveBeenCalled();
  });

  it('sends the donation emails for a donation it recovers, with the payer email', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    await run();
    expect(mocks.notifyDonation).toHaveBeenCalledWith({ center, itemId: 'item-1', amount: '10.00', donorEmail: 'donor@example.org' });
  });

  it('does not fail the run when the emails fail', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    mocks.notifyDonation.mockRejectedValue(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toMatchObject({ recorded: 1, errors: 0 });
  });

  it('treats an already recorded capture as resolved, without emailing again', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    mocks.recordReconciledCapture.mockResolvedValue('duplicate');
    expect(await run()).toMatchObject({ recorded: 1 });
    expect(mocks.notifyDonation).not.toHaveBeenCalled();
  });

  it('never records an order that was resolved by hand in the meantime', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    mocks.recordReconciledCapture.mockResolvedValue('not_pending');
    expect(await run()).toMatchObject({ recorded: 0, skipped: 1 });
    expect(mocks.resolvePendingCapture).not.toHaveBeenCalled();
    expect(mocks.notifyDonation).not.toHaveBeenCalled();
  });

  it('flags a completed order that cannot be recorded', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture });
    mocks.recordReconciledCapture.mockResolvedValue('item_not_found');
    expect(await run()).toMatchObject({ needsReview: 1 });
    expect(mocks.resolvePendingCapture).toHaveBeenCalledWith('O1', 'needs_review', expect.stringContaining('CAP1'), 'CAP1');
  });

  it('flags a completed order in a currency other than EUR without recording it', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'completed', capture: { ...capture, currency: 'JPY' } });
    expect(await run()).toMatchObject({ needsReview: 1 });
    expect(mocks.recordReconciledCapture).not.toHaveBeenCalled();
  });

  it('keeps an order whose capture PayPal is still processing pending, even when old', async () => {
    mocks.listReconcilableCaptures.mockReset().mockResolvedValueOnce([pending({ created_at: '2026-10-08T05:00:00Z' })]).mockResolvedValue([]);
    mocks.lookupOrder.mockResolvedValue({ state: 'capture_pending', captureId: 'CAP1' });
    expect(await run()).toMatchObject({ stillPending: 1 });
    expect(mocks.touchPendingCapture).toHaveBeenCalledWith('O1', expect.stringContaining('PENDING'), 'CAP1');
    expect(mocks.resolvePendingCapture).not.toHaveBeenCalled();
  });

  it('flags a refunded or failed capture without crediting it', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'capture_failed', captureId: 'CAP1', status: 'REFUNDED' });
    expect(await run()).toMatchObject({ needsReview: 1 });
    expect(mocks.resolvePendingCapture).toHaveBeenCalledWith('O1', 'needs_review', expect.stringContaining('REFUNDED'), 'CAP1');
    expect(mocks.recordReconciledCapture).not.toHaveBeenCalled();
  });

  it('leaves a recent unfinished order pending', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'not_completed', status: 'CREATED' });
    expect(await run()).toMatchObject({ stillPending: 1 });
    expect(mocks.resolvePendingCapture).not.toHaveBeenCalled();
    expect(mocks.touchPendingCapture).toHaveBeenCalled();
  });

  it('marks an old abandoned order as not paid', async () => {
    mocks.listReconcilableCaptures.mockReset().mockResolvedValueOnce([pending({ created_at: '2026-10-09T05:00:00Z' })]).mockResolvedValue([]);
    mocks.lookupOrder.mockResolvedValue({ state: 'not_completed', status: 'CREATED' });
    expect(await run()).toMatchObject({ notPaid: 1 });
    expect(mocks.resolvePendingCapture).toHaveBeenCalledWith('O1', 'not_paid', 'order CREATED');
  });

  it('flags an old order approved by the payer but never captured', async () => {
    mocks.listReconcilableCaptures.mockReset().mockResolvedValueOnce([pending({ created_at: '2026-10-09T05:00:00Z' })]).mockResolvedValue([]);
    mocks.lookupOrder.mockResolvedValue({ state: 'not_completed', status: 'APPROVED' });
    expect(await run()).toMatchObject({ needsReview: 1 });
  });

  it('marks an order unknown to PayPal as not paid', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'not_found' });
    expect(await run()).toMatchObject({ notPaid: 1 });
  });

  it('keeps going and counts the error when PayPal fails for one order', async () => {
    mocks.listReconcilableCaptures.mockReset().mockResolvedValueOnce([pending(), pending({ paypal_order_id: 'O2' })]).mockResolvedValue([]);
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
    mocks.listReconcilableCaptures.mockReset().mockResolvedValueOnce([pending(), pending({ paypal_order_id: 'O2' })]).mockResolvedValue([]);
    mocks.lookupOrder.mockResolvedValue({ state: 'not_found' });
    await run();
    expect(mocks.getCenterWithSecretById).toHaveBeenCalledTimes(1);
  });

  it('prunes finished rows older than 30 days, and keeps going if pruning fails', async () => {
    mocks.lookupOrder.mockResolvedValue({ state: 'not_found' });
    mocks.pruneFinishedCaptures.mockResolvedValue(7);
    expect(await run()).toMatchObject({ pruned: 7, notPaid: 1 });

    mocks.listReconcilableCaptures.mockReset().mockResolvedValueOnce([pending()]).mockResolvedValue([]);
    mocks.pruneFinishedCaptures.mockRejectedValue(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toMatchObject({ pruned: 0, notPaid: 1 });
  });

  it('works through the backlog in batches, continuing after the last row of each batch', async () => {
    const batch = (from: number) =>
      Array.from({ length: 2 }, (_, i) => pending({ paypal_order_id: `O${from + i}`, cursor: `c${from + i}` }));
    mocks.listReconcilableCaptures.mockReset()
      .mockResolvedValueOnce(batch(1))
      .mockResolvedValueOnce(batch(3))
      .mockResolvedValueOnce([pending({ paypal_order_id: 'O5', cursor: 'c5' })]);
    mocks.lookupOrder.mockResolvedValue({ state: 'not_found' });

    expect(await reconcilePendingCaptures({ encryptionKey: 'k', now, batchSize: 2 })).toMatchObject({ checked: 5, notPaid: 5, timedOut: false });
    expect(mocks.listReconcilableCaptures).toHaveBeenCalledTimes(3);
    expect(mocks.listReconcilableCaptures).toHaveBeenNthCalledWith(1, 5, 2, null);
    expect(mocks.listReconcilableCaptures).toHaveBeenNthCalledWith(2, 5, 2, { cursor: 'c2', orderId: 'O2' });
    expect(mocks.listReconcilableCaptures).toHaveBeenNthCalledWith(3, 5, 2, { cursor: 'c4', orderId: 'O4' });
  });

  it('stops starting new lookups once the time budget is spent', async () => {
    mocks.listReconcilableCaptures.mockReset().mockResolvedValue([pending(), pending({ paypal_order_id: 'O2' })]);
    mocks.lookupOrder.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { state: 'not_found' };
    });

    const summary = await reconcilePendingCaptures({ encryptionKey: 'k', now, batchSize: 2, concurrency: 1, timeBudgetMs: 10 });
    expect(summary).toMatchObject({ checked: 1, timedOut: true });
    expect(mocks.listReconcilableCaptures).toHaveBeenCalledTimes(1);
  });
});
