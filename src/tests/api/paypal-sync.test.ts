import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcilePendingCaptures, syncPaypalRefunds } = vi.hoisted(() => ({
  reconcilePendingCaptures: vi.fn(),
  syncPaypalRefunds: vi.fn(),
}));

vi.mock('../../lib/paypal-reconcile', () => ({ reconcilePendingCaptures }));
vi.mock('../../lib/paypal-refund-sync', () => ({ syncPaypalRefunds }));

import { GET } from '../../pages/api/cron/paypal-sync';

const call = (authorization?: string) =>
  GET({
    request: new Request('http://localhost/api/cron/paypal-sync', { headers: authorization ? { authorization } : {} }),
  } as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  reconcilePendingCaptures.mockResolvedValue({ checked: 1 });
  syncPaypalRefunds.mockResolvedValue({ voided: 2 });
});

describe('GET /api/cron/paypal-sync', () => {
  it.each([[undefined], ['Bearer wrong'], ['s3cret'], ['Bearer s3cret2']])('rejects %s', async (header) => {
    expect((await call(header)).status).toBe(401);
    expect(reconcilePendingCaptures).not.toHaveBeenCalled();
    expect(syncPaypalRefunds).not.toHaveBeenCalled();
  });

  it('rejects everything when the secret is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
  });

  it('runs both jobs and returns the summary', async () => {
    const res = await call('Bearer s3cret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reconcile: { checked: 1 }, refunds: { voided: 2 } });
  });

  it('still runs the refund sync when reconciliation fails, and reports 500', async () => {
    reconcilePendingCaptures.mockRejectedValue(new Error('db down'));
    const res = await call('Bearer s3cret');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ reconcile: { error: 'db down' }, refunds: { voided: 2 } });
  });
});
