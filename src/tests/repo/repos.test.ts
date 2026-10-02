import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('../../lib/db', () => ({ default: mockSql }));

import { getCenterBySlug, getCenterWithSecret, listCenters } from '../../lib/repo/centers';
import { recordPaypalDonation, voidManualDonation } from '../../lib/repo/donations';
import { removeOrArchiveItem } from '../../lib/repo/items';
import { removeCenterUser } from '../../lib/repo/users';

const centerRow = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'recoletos',
  name: 'Recoletos',
  status: 'active',
  paypal_client_id: 'cid',
  paypal_secret_encrypted: 'v1:a:b:c',
  paypal_env: 'sandbox',
};

describe('centers repository', () => {
  beforeEach(() => mockSql.mockReset());

  it('never exposes the encrypted secret on public reads', async () => {
    mockSql.mockResolvedValue([centerRow]);
    const center = await getCenterBySlug('recoletos');
    expect(center).not.toHaveProperty('paypal_secret_encrypted');
    expect(center?.paypal_configured).toBe(true);
    expect((await listCenters())[0]).not.toHaveProperty('paypal_secret_encrypted');
  });

  it('reports paypal as not configured when the secret is missing', async () => {
    mockSql.mockResolvedValue([{ ...centerRow, paypal_secret_encrypted: null }]);
    expect((await getCenterBySlug('recoletos'))?.paypal_configured).toBe(false);
  });

  it('returns null for an unknown slug', async () => {
    mockSql.mockResolvedValue([]);
    expect(await getCenterBySlug('nope')).toBeNull();
  });

  it('only the explicit secret read returns the encrypted secret', async () => {
    mockSql.mockResolvedValue([centerRow]);
    expect((await getCenterWithSecret('recoletos'))?.paypal_secret_encrypted).toBe('v1:a:b:c');
  });
});

describe('donations repository', () => {
  beforeEach(() => mockSql.mockReset());
  const input = { centerId: 'c', itemId: 'i', amount: '10.00', currency: 'EUR', captureId: 'CAP1' };

  it('reports created when the row was inserted', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'd1' }]);
    expect(await recordPaypalDonation(input)).toBe('created');
  });

  it('reports duplicate when the capture id already exists', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ok: 1 }]);
    expect(await recordPaypalDonation(input)).toBe('duplicate');
  });

  it('reports item_not_found when nothing matched and the capture is new', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await recordPaypalDonation(input)).toBe('item_not_found');
  });

  it('voids only when a manual donation matched', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'd1' }]);
    expect(await voidManualDonation('c', 'd1')).toBe(true);
    mockSql.mockResolvedValueOnce([]);
    expect(await voidManualDonation('c', 'd2')).toBe(false);
  });
});

describe('items repository', () => {
  beforeEach(() => mockSql.mockReset());

  it.each([
    [{ deleted: '1', archived: '0' }, 'deleted'],
    [{ deleted: '0', archived: '1' }, 'archived'],
    [{ deleted: '0', archived: '0' }, 'missing'],
  ] as const)('maps %j to %s', async (row, expected) => {
    mockSql.mockResolvedValueOnce([row]);
    expect(await removeOrArchiveItem('c', 'i')).toBe(expected);
  });
});

describe('users repository', () => {
  beforeEach(() => mockSql.mockReset());

  it('removes a manager when more than one exists', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'u1' }]);
    expect(await removeCenterUser('c', 'a@x.org')).toBe('removed');
  });

  it('refuses to remove the last manager', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ok: 1 }]);
    expect(await removeCenterUser('c', 'a@x.org')).toBe('last');
  });

  it('reports missing when the email is not a manager', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await removeCenterUser('c', 'a@x.org')).toBe('missing');
  });

  it('lets the superadmin force-remove the last manager', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'u1' }]);
    expect(await removeCenterUser('c', 'a@x.org', { force: true })).toBe('removed');
    const sqlText = mockSql.mock.calls[0][0].join('?');
    expect(sqlText).not.toContain('count(*)');
  });
});
