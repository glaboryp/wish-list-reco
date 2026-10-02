import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

vi.mock('../../lib/db', async () => {
  const { neon, neonConfig } = await import('@neondatabase/serverless');
  if (process.env.TEST_NEON_FETCH_ENDPOINT) {
    neonConfig.fetchEndpoint = process.env.TEST_NEON_FETCH_ENDPOINT;
    neonConfig.useSecureWebSocket = false;
    neonConfig.poolQueryViaFetch = true;
  }
  return { default: neon(process.env.TEST_DATABASE_URL ?? 'postgresql://u:p@localhost/unused') };
});

import sql from '../../lib/db';
import { createCenter } from '../../lib/repo/centers';
import { addManualDonation, recordPaypalDonation, voidManualDonation } from '../../lib/repo/donations';
import { createItem, getAdminItem, listPublicItems, removeOrArchiveItem, updateItem } from '../../lib/repo/items';
import { addCenterUser, findMembership, removeCenterUser } from '../../lib/repo/users';

const itemInput = {
  name: 'Cáliz',
  description: 'desc',
  goal: 100,
  status: 'active' as const,
  sortOrder: 0,
  imageUrl: null,
  imageAlt: null,
};

describe.skipIf(!databaseUrl)('repositories against a real database', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let centerA: string;
  let centerB: string;
  let itemA: string;

  beforeAll(async () => {
    const a = await createCenter({ slug: `it-a-${suffix}`, name: 'A' });
    const b = await createCenter({ slug: `it-b-${suffix}`, name: 'B' });
    centerA = a!.id;
    centerB = b!.id;
    itemA = await createItem(centerA, itemInput);
  });

  afterAll(async () => {
    await sql`DELETE FROM donations WHERE center_id IN (${centerA}, ${centerB})`;
    await sql`DELETE FROM items WHERE center_id IN (${centerA}, ${centerB})`;
    await sql`DELETE FROM centers WHERE id IN (${centerA}, ${centerB})`;
  });

  it('refuses a duplicate slug', async () => {
    expect(await createCenter({ slug: `it-a-${suffix}`, name: 'again' })).toBeNull();
  });

  it('derives raised and funded from the ledger, and un-funds when a manual donation is voided', async () => {
    expect(await recordPaypalDonation({ centerId: centerA, itemId: itemA, amount: '60.00', currency: 'EUR', captureId: `CAP-${suffix}-1` })).toBe('created');
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 60, status: 'active' });

    expect(await addManualDonation({ centerId: centerA, itemId: itemA, amount: 40, note: 'efectivo' })).toBe(true);
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 100, status: 'funded' });

    const manual = await sql`SELECT id FROM donations WHERE item_id = ${itemA} AND source = 'manual'`;
    expect(await voidManualDonation(centerA, manual[0].id)).toBe(true);
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 60, status: 'active' });
  });

  it('does not count the same PayPal capture twice', async () => {
    const input = { centerId: centerA, itemId: itemA, amount: '5.00', currency: 'EUR', captureId: `CAP-${suffix}-2` };
    expect(await recordPaypalDonation(input)).toBe('created');
    expect(await recordPaypalDonation(input)).toBe('duplicate');
    expect((await getAdminItem(centerA, itemA))?.raised).toBe(65);
  });

  it('keeps tenants isolated', async () => {
    expect(await getAdminItem(centerB, itemA)).toBeNull();
    expect(await updateItem(centerB, itemA, itemInput)).toBe(false);
    expect(await recordPaypalDonation({ centerId: centerB, itemId: itemA, amount: '1.00', currency: 'EUR', captureId: `CAP-${suffix}-3` })).toBe('item_not_found');
    expect(await addManualDonation({ centerId: centerB, itemId: itemA, amount: 1, note: '' })).toBe(false);
    expect(await removeOrArchiveItem(centerB, itemA)).toBe('missing');
    expect(await listPublicItems(centerB)).toEqual([]);
  });

  it('archives an item with donations and deletes one without', async () => {
    expect(await removeOrArchiveItem(centerA, itemA)).toBe('archived');
    expect(await listPublicItems(centerA)).toEqual([]);
    const fresh = await createItem(centerA, itemInput);
    expect(await removeOrArchiveItem(centerA, fresh)).toBe('deleted');
  });

  it('protects the last manager', async () => {
    expect(await addCenterUser(centerA, 'one@example.org')).toBe(true);
    expect(await addCenterUser(centerA, 'one@example.org')).toBe(false);
    expect(await removeCenterUser(centerA, 'one@example.org')).toBe('last');
    expect(await addCenterUser(centerA, 'two@example.org')).toBe(true);
    expect(await removeCenterUser(centerA, 'one@example.org')).toBe('removed');
    expect(await findMembership(centerA, 'one@example.org')).toBe(false);
    expect(await removeCenterUser(centerA, 'two@example.org', { force: true })).toBe('removed');
    expect(await removeCenterUser(centerA, 'ghost@example.org')).toBe('missing');
  });
});
