import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookupCaptureRefund: vi.fn(),
  credentialsFor: vi.fn(),
  listCentersWithPaypal: vi.fn(),
  listLivePaypalDonations: vi.fn(),
  voidPaypalDonation: vi.fn(),
  applyPartialRefund: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('../../lib/paypal', () => ({ lookupCaptureRefund: mocks.lookupCaptureRefund, credentialsFor: mocks.credentialsFor }));
vi.mock('../../lib/repo/centers', () => ({ listCentersWithPaypal: mocks.listCentersWithPaypal }));
vi.mock('../../lib/repo/donations', () => ({
  listLivePaypalDonations: mocks.listLivePaypalDonations,
  voidPaypalDonation: mocks.voidPaypalDonation,
  applyPartialRefund: mocks.applyPartialRefund,
}));
vi.mock('../../lib/repo/audit', () => ({ recordAudit: mocks.recordAudit }));

import { syncPaypalRefunds } from '../../lib/paypal-refund-sync';

const donation = (n: number) => ({ id: `d${n}`, paypal_capture_id: `CAP${n}`, amount: '10.00', fee_amount: '0.66', refunded_amount: '0.00', currency: 'EUR' });
const partial = (refundedAmount: string) => ({ state: 'partially_refunded', refundedAmount, currency: 'EUR' });
const run = () => syncPaypalRefunds({ encryptionKey: 'k' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCentersWithPaypal.mockResolvedValue([{ id: 'c1', slug: 'recoletos' }]);
  mocks.credentialsFor.mockReturnValue({ clientId: 'a', clientSecret: 'b', env: 'sandbox' });
  mocks.listLivePaypalDonations.mockResolvedValue([donation(1), donation(2), donation(3)]);
  mocks.voidPaypalDonation.mockResolvedValue('voided');
  mocks.applyPartialRefund.mockResolvedValue({ outcome: 'updated', previous: '0.00' });
});

describe('syncPaypalRefunds', () => {
  it('voids fully refunded donations without a user and discounts partial refunds', async () => {
    mocks.lookupCaptureRefund
      .mockResolvedValueOnce({ state: 'refunded' })
      .mockResolvedValueOnce(partial('5.33'))
      .mockResolvedValueOnce({ state: 'not_refunded' });
    expect(await run()).toEqual({
      centers: 1,
      checked: 3,
      voided: 1,
      partialRefunds: { detected: 1, updated: 1 },
      partiallyRefunded: [{ centerSlug: 'recoletos', donationId: 'd2', captureId: 'CAP2', refundedGross: '5.33', refundedNet: '5.00', updated: true }],
      errors: 0,
    });
    expect(mocks.voidPaypalDonation).toHaveBeenCalledTimes(1);
    expect(mocks.voidPaypalDonation).toHaveBeenCalledWith('c1', 'd1', { reason: 'Reembolso en PayPal', actorEmail: null });
    expect(mocks.applyPartialRefund).toHaveBeenCalledWith('c1', 'd2', '5.00');
  });

  it('warns in the audit log only when the refunded amount changes', async () => {
    mocks.listLivePaypalDonations.mockResolvedValue([donation(2)]);
    mocks.lookupCaptureRefund.mockResolvedValue(partial('5.33'));
    await run();
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      centerId: 'c1',
      actorEmail: 'PayPal (automático)',
      action: 'donation.partial_refund',
      entityType: 'donation',
      entityId: 'd2',
      summary: expect.stringContaining('CAP2'),
    });

    mocks.recordAudit.mockClear();
    mocks.applyPartialRefund.mockResolvedValue({ outcome: 'unchanged' });
    expect(await run()).toMatchObject({ partialRefunds: { detected: 1, updated: 0 }, errors: 0 });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('updates a partial refund that grows, and voids the donation once the refund becomes total', async () => {
    mocks.listLivePaypalDonations.mockResolvedValue([{ ...donation(2), refunded_amount: '5.00' }]);
    mocks.lookupCaptureRefund.mockResolvedValueOnce(partial('8.00'));
    mocks.applyPartialRefund.mockResolvedValue({ outcome: 'updated', previous: '5.00' });
    expect(await run()).toMatchObject({ partiallyRefunded: [{ refundedNet: '7.50', updated: true }] });
    expect(mocks.applyPartialRefund).toHaveBeenCalledWith('c1', 'd2', '7.50');

    mocks.lookupCaptureRefund.mockResolvedValueOnce({ state: 'refunded' });
    expect(await run()).toMatchObject({ voided: 1, partialRefunds: { detected: 0, updated: 0 } });
    expect(mocks.voidPaypalDonation).toHaveBeenCalledWith('c1', 'd2', { reason: 'Reembolso en PayPal', actorEmail: null });
  });

  it('does not apply a refund in another currency', async () => {
    mocks.listLivePaypalDonations.mockResolvedValue([donation(2)]);
    mocks.lookupCaptureRefund.mockResolvedValue({ state: 'partially_refunded', refundedAmount: '5.33', currency: 'USD' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toMatchObject({ errors: 1, partialRefunds: { detected: 0, updated: 0 } });
    expect(mocks.applyPartialRefund).not.toHaveBeenCalled();
  });

  it('is idempotent when a donation was already voided meanwhile', async () => {
    mocks.listLivePaypalDonations.mockResolvedValue([donation(1)]);
    mocks.lookupCaptureRefund.mockResolvedValue({ state: 'refunded' });
    mocks.voidPaypalDonation.mockResolvedValue('already_voided');
    expect(await run()).toMatchObject({ checked: 1, voided: 0, errors: 0 });
  });

  it('bounds the work with the lookback window and per-center limit', async () => {
    mocks.listLivePaypalDonations.mockResolvedValue([]);
    await syncPaypalRefunds({ encryptionKey: 'k', lookbackDays: 30, limitPerCenter: 10 });
    expect(mocks.listLivePaypalDonations).toHaveBeenCalledWith('c1', 30, 10);
    await run();
    expect(mocks.listLivePaypalDonations).toHaveBeenLastCalledWith('c1', 90, 100);
  });

  it('skips centers without usable credentials', async () => {
    mocks.credentialsFor.mockReturnValueOnce(null);
    expect(await run()).toMatchObject({ centers: 0, checked: 0 });
    expect(mocks.listLivePaypalDonations).not.toHaveBeenCalled();
  });

  it('counts a failing lookup and keeps going', async () => {
    mocks.lookupCaptureRefund
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ state: 'refunded' })
      .mockResolvedValueOnce({ state: 'not_found' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toMatchObject({ checked: 3, voided: 1, errors: 1 });
  });
});
