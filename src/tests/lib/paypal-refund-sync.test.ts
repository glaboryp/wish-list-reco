import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookupCaptureRefund: vi.fn(),
  credentialsFor: vi.fn(),
  listCentersWithPaypal: vi.fn(),
  listLivePaypalDonations: vi.fn(),
  voidPaypalDonation: vi.fn(),
}));

vi.mock('../../lib/paypal', () => ({ lookupCaptureRefund: mocks.lookupCaptureRefund, credentialsFor: mocks.credentialsFor }));
vi.mock('../../lib/repo/centers', () => ({ listCentersWithPaypal: mocks.listCentersWithPaypal }));
vi.mock('../../lib/repo/donations', () => ({
  listLivePaypalDonations: mocks.listLivePaypalDonations,
  voidPaypalDonation: mocks.voidPaypalDonation,
}));

import { syncPaypalRefunds } from '../../lib/paypal-refund-sync';

const donation = (n: number) => ({ id: `d${n}`, paypal_capture_id: `CAP${n}` });
const run = () => syncPaypalRefunds({ encryptionKey: 'k' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCentersWithPaypal.mockResolvedValue([{ id: 'c1', slug: 'recoletos' }]);
  mocks.credentialsFor.mockReturnValue({ clientId: 'a', clientSecret: 'b', env: 'sandbox' });
  mocks.listLivePaypalDonations.mockResolvedValue([donation(1), donation(2), donation(3)]);
  mocks.voidPaypalDonation.mockResolvedValue('voided');
});

describe('syncPaypalRefunds', () => {
  it('voids fully refunded donations without a user and flags partial refunds', async () => {
    mocks.lookupCaptureRefund
      .mockResolvedValueOnce('refunded')
      .mockResolvedValueOnce('partially_refunded')
      .mockResolvedValueOnce('not_refunded');
    expect(await run()).toEqual({
      centers: 1,
      checked: 3,
      voided: 1,
      partiallyRefunded: [{ centerSlug: 'recoletos', donationId: 'd2', captureId: 'CAP2' }],
      errors: 0,
    });
    expect(mocks.voidPaypalDonation).toHaveBeenCalledTimes(1);
    expect(mocks.voidPaypalDonation).toHaveBeenCalledWith('c1', 'd1', { reason: 'Reembolso en PayPal', actorEmail: null });
  });

  it('is idempotent when a donation was already voided meanwhile', async () => {
    mocks.listLivePaypalDonations.mockResolvedValue([donation(1)]);
    mocks.lookupCaptureRefund.mockResolvedValue('refunded');
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
      .mockResolvedValueOnce('refunded')
      .mockResolvedValueOnce('not_found');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toMatchObject({ checked: 3, voided: 1, errors: 1 });
  });
});
