import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

const { mockDel } = vi.hoisted(() => ({ mockDel: vi.fn() }));
vi.mock('@vercel/blob', () => ({ del: mockDel }));

const { mockLookupOrder, mockLookupCaptureRefund } = vi.hoisted(() => ({ mockLookupOrder: vi.fn(), mockLookupCaptureRefund: vi.fn() }));
vi.mock('../../lib/paypal', () => ({
  lookupOrder: mockLookupOrder,
  lookupCaptureRefund: mockLookupCaptureRefund,
  credentialsFor: () => ({ clientId: 'cid', clientSecret: 'secret', env: 'sandbox' }),
}));

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
import { createCenter, getCenterBySlug, updateAppearance, updateFeeSettings, updatePaypal } from '../../lib/repo/centers';
import {
  addManualDonation,
  applyPartialRefund,
  countCenterDonors,
  getDashboard,
  getDonationSummary,
  listAllDonations,
  listDonations,
  listPartialRefunds,
  recordPaypalDonation,
  voidManualDonation,
  voidPaypalDonation,
} from '../../lib/repo/donations';
import { syncPaypalRefunds } from '../../lib/paypal-refund-sync';
import {
  addItemImage,
  createItem,
  duplicateItem,
  getAdminItem,
  listAdminItems,
  listItemImages,
  listPublicItems,
  MAX_ITEM_IMAGES,
  removeItemImage,
  removeOrArchiveItem,
  reorderItems,
  setCoverImage,
  setItemsStatus,
  updateItem,
} from '../../lib/repo/items';
import { listAudit, recordAudit } from '../../lib/repo/audit';
import { bumpSessionVersion, getSessionVersion } from '../../lib/repo/sessions';
import { reconcilePendingCaptures } from '../../lib/paypal-reconcile';
import {
  listReconcilableCaptures,
  listUnresolvedCaptures,
  pruneFinishedCaptures,
  recordPendingCapture,
  resolveCaptureManually,
  resolvePendingCapture,
} from '../../lib/repo/pending-captures';
import { addCenterUser, findMembership, removeCenterUser } from '../../lib/repo/users';

const itemInput = {
  name: 'Cáliz',
  description: 'desc',
  goal: 100,
  status: 'active' as const,
  sortOrder: 0,
  imageUrl: null,
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

    expect(await addManualDonation({ centerId: centerA, itemId: itemA, amount: 40, note: 'efectivo' })).toEqual({ status: 'created' });
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 100, status: 'funded' });

    const manual = await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${itemA} AND source = 'manual'`;
    expect(await voidManualDonation(centerA, manual[0].id)).toBe(true);
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 60, status: 'active' });
  });

  it('counts only non-voided donations per item and per center', async () => {
    const item = await createItem(centerB, { ...itemInput, name: 'donors', sortOrder: 9300 });
    expect(await countCenterDonors(centerB)).toBe(0);
    await recordPaypalDonation({ centerId: centerB, itemId: item, amount: '5.00', currency: 'EUR', captureId: `CAP-${suffix}-d1` });
    await addManualDonation({ centerId: centerB, itemId: item, amount: 7, note: 'bizum' });
    await addManualDonation({ centerId: centerB, itemId: item, amount: 3, note: 'voided' });
    expect((await listPublicItems(centerB))[0].donorCount).toBe(3);
    const voided = await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${item} AND note = 'voided'`;
    expect(await voidManualDonation(centerB, voided[0].id)).toBe(true);
    expect((await listPublicItems(centerB))[0].donorCount).toBe(2);
    expect(await countCenterDonors(centerB)).toBe(2);

    await sql`DELETE FROM donations WHERE item_id = ${item}`;
    await sql`DELETE FROM items WHERE id = ${item}`;
  });

  it('credits the net donation and keeps the fee apart', async () => {
    const item = await createItem(centerA, { ...itemInput, name: 'fees', sortOrder: 9999 });
    expect(await recordPaypalDonation({ centerId: centerA, itemId: item, amount: '10.00', feeAmount: '0.66', currency: 'EUR', captureId: `CAP-${suffix}-fee` })).toBe('created');
    expect(await getAdminItem(centerA, item)).toMatchObject({ raised: 10 });
    const row = (await listDonations(centerA)).rows.find((donation) => donation.item_id === item)!;
    expect(Number(row.amount)).toBe(10);
    expect(Number(row.fee_amount)).toBe(0.66);
    expect(await recordPaypalDonation({ centerId: centerA, itemId: item, amount: '5.00', currency: 'EUR', captureId: `CAP-${suffix}-nofee` })).toBe('created');
    expect(await getAdminItem(centerA, item)).toMatchObject({ raised: 15 });

    await sql`DELETE FROM donations WHERE item_id = ${item}`;
    await sql`DELETE FROM items WHERE id = ${item}`;
  });

  it('voids a PayPal donation once, keeps who and why, and reopens a funded item', async () => {
    const id = await createItem(centerA, { ...itemInput, name: 'refund', goal: 20, sortOrder: 9200 });
    await recordPaypalDonation({ centerId: centerA, itemId: id, amount: '20.00', currency: 'EUR', captureId: `CAP-${suffix}-refund` });
    expect(await getAdminItem(centerA, id)).toMatchObject({ raised: 20 });
    expect((await listPublicItems(centerA)).find((item) => item.id === id)).toMatchObject({ status: 'funded' });
    const donation = (await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${id}`)[0].id;

    expect(await voidPaypalDonation(centerB, donation, { reason: 'x', actorEmail: 'boss@example.org' })).toBe('missing');
    expect(await voidPaypalDonation(centerA, donation, { reason: 'reembolso', actorEmail: 'boss@example.org' })).toBe('voided');
    expect(await voidPaypalDonation(centerA, donation, { reason: 'otra vez', actorEmail: 'other@example.org' })).toBe('already_voided');

    const row = (await listDonations(centerA)).rows.find((entry) => entry.id === donation)!;
    expect(row).toMatchObject({ voided_by: 'boss@example.org', void_reason: 'reembolso' });
    expect(row.voided_at).not.toBeNull();
    expect(await getAdminItem(centerA, id)).toMatchObject({ raised: 0 });
    expect((await listPublicItems(centerA)).find((item) => item.id === id)).toMatchObject({ status: 'active' });
    expect(await removeOrArchiveItem(centerA, id)).toBe('archived');

    await sql`DELETE FROM donations WHERE item_id = ${id}`;
    await sql`DELETE FROM items WHERE id = ${id}`;
  });

  it('does not let manual donations be voided as PayPal ones or carry void metadata', async () => {
    const id = await createItem(centerA, { ...itemInput, name: 'manual-only', sortOrder: 9201 });
    await addManualDonation({ centerId: centerA, itemId: id, amount: 5, note: '' });
    const donation = (await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${id}`)[0].id;
    expect(await voidPaypalDonation(centerA, donation, { reason: 'x', actorEmail: 'boss@example.org' })).toBe('missing');
    await expect(sql`UPDATE donations SET void_reason = 'x' WHERE id = ${donation}`).rejects.toThrow();

    await sql`DELETE FROM donations WHERE item_id = ${id}`;
    await sql`DELETE FROM items WHERE id = ${id}`;
  });

  it('pages and filters donations without leaking other centers', async () => {
    const itemOne = await createItem(centerA, { ...itemInput, name: 'paged-1', goal: 1000, sortOrder: 9001 });
    const itemTwo = await createItem(centerA, { ...itemInput, name: 'paged-2', goal: 1000, sortOrder: 9002 });
    const foreign = await createItem(centerB, { ...itemInput, name: 'foreign', goal: 1000 });
    for (let n = 0; n < 5; n++) {
      await recordPaypalDonation({ centerId: centerA, itemId: itemOne, amount: '2.00', currency: 'EUR', captureId: `CAP-${suffix}-p1-${n}` });
    }
    await recordPaypalDonation({ centerId: centerA, itemId: itemTwo, amount: '7.00', currency: 'EUR', captureId: `CAP-${suffix}-p2` });
    await recordPaypalDonation({ centerId: centerB, itemId: foreign, amount: '9.00', currency: 'EUR', captureId: `CAP-${suffix}-foreign` });
    await addManualDonation({ centerId: centerA, itemId: itemOne, amount: 3, note: 'to void' });
    const manual = await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${itemOne} AND source = 'manual'`;
    await voidManualDonation(centerA, manual[0].id);

    const first = await listDonations(centerA, { itemId: itemOne, page: 1, pageSize: 4 });
    const second = await listDonations(centerA, { itemId: itemOne, page: 2, pageSize: 4 });
    expect(first.total).toBe(6);
    expect(first.activeSum).toBe(10);
    expect(first.rows).toHaveLength(4);
    expect(second.rows).toHaveLength(2);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(6);
    expect([...first.rows, ...second.rows].every((row) => row.item_id === itemOne)).toBe(true);

    const all = await listDonations(centerA, { pageSize: 1000 });
    expect(all.rows.some((row) => row.item_id === foreign)).toBe(false);
    expect(await listDonations(centerA, { itemId: foreign })).toMatchObject({ total: 0, rows: [] });
    expect((await listDonations(centerB, { itemId: foreign })).total).toBe(1);

    await sql`DELETE FROM donations WHERE item_id IN (${itemOne}, ${itemTwo}, ${foreign})`;
    await sql`DELETE FROM items WHERE id IN (${itemOne}, ${itemTwo}, ${foreign})`;
  });

  it('exports all donations of one center and matches the dashboard to the list totals', async () => {
    const item = await createItem(centerA, { ...itemInput, name: 'export-1', goal: 1000, sortOrder: 9100 });
    const foreign = await createItem(centerB, { ...itemInput, name: 'export-foreign', goal: 1000 });
    for (let n = 0; n < 7; n++) {
      await recordPaypalDonation({ centerId: centerA, itemId: item, amount: '4.00', currency: 'EUR', captureId: `CAP-${suffix}-ex-${n}` });
    }
    await recordPaypalDonation({ centerId: centerB, itemId: foreign, amount: '9.00', currency: 'EUR', captureId: `CAP-${suffix}-ex-foreign` });
    await voidPaypalDonation(centerA, (await listDonations(centerA, { itemId: item })).rows[0].id, { reason: 'test', actorEmail: 'a@b.c' });

    const exported = await listAllDonations(centerA, item);
    expect(exported).toHaveLength(7);
    expect(await listAllDonations(centerA, foreign)).toEqual([]);
    expect((await listAllDonations(centerA)).some((row) => row.item_id === foreign)).toBe(false);

    const list = await listDonations(centerA, { pageSize: 1000 });
    const dashboard = await getDashboard(centerA);
    expect(dashboard.donationCount).toBe(list.total);
    expect(dashboard.netRaised).toBe(list.activeSum);
    expect(dashboard.recent.length).toBeLessThanOrEqual(5);
    expect(dashboard.items.some((entry) => entry.id === item)).toBe(true);

    await sql`DELETE FROM donations WHERE item_id IN (${item}, ${foreign})`;
    await sql`DELETE FROM items WHERE id IN (${item}, ${foreign})`;
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
    expect(await addManualDonation({ centerId: centerB, itemId: itemA, amount: 1, note: '' })).toEqual({ status: 'missing' });
    expect(await removeOrArchiveItem(centerB, itemA)).toBe('missing');
    expect(await listPublicItems(centerB)).toEqual([]);
  });

  it('archives an item with donations and deletes one without', async () => {
    expect(await removeOrArchiveItem(centerA, itemA)).toBe('archived');
    expect(await listPublicItems(centerA)).toEqual([]);
    const fresh = await createItem(centerA, itemInput);
    expect(await removeOrArchiveItem(centerA, fresh)).toBe('deleted');
  });

  it('deletes an item whose only donations are voided manual ones, with those donations', async () => {
    const id = await createItem(centerA, { ...itemInput, name: 'only-voided', sortOrder: 9100 });
    await addManualDonation({ centerId: centerA, itemId: id, amount: 10, note: 'a' });
    await addManualDonation({ centerId: centerA, itemId: id, amount: 5, note: 'b' });
    expect(await getAdminItem(centerA, id)).toMatchObject({ donationCount: 2, blockingDonationCount: 2 });

    for (const row of await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${id}`) {
      await voidManualDonation(centerA, row.id);
    }
    expect(await getAdminItem(centerA, id)).toMatchObject({ donationCount: 2, blockingDonationCount: 0 });

    expect(await removeOrArchiveItem(centerA, id)).toBe('deleted');
    expect(await getAdminItem(centerA, id)).toBeNull();
    expect(await sql`SELECT 1 FROM donations WHERE item_id = ${id}`).toHaveLength(0);
  });

  it('archives instead of deleting when a manual donation is still valid or one came from PayPal', async () => {
    const live = await createItem(centerA, { ...itemInput, name: 'one-live', sortOrder: 9101 });
    await addManualDonation({ centerId: centerA, itemId: live, amount: 10, note: 'voided' });
    await addManualDonation({ centerId: centerA, itemId: live, amount: 5, note: 'live' });
    const first = await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${live} AND note = 'voided'`;
    await voidManualDonation(centerA, first[0].id);
    expect(await removeOrArchiveItem(centerA, live)).toBe('archived');
    expect(await getAdminItem(centerA, live)).toMatchObject({ status: 'archived', donationCount: 2, blockingDonationCount: 1 });

    const paypal = await createItem(centerA, { ...itemInput, name: 'paypal', sortOrder: 9102 });
    await recordPaypalDonation({ centerId: centerA, itemId: paypal, amount: '4.00', currency: 'EUR', captureId: `CAP-${suffix}-del` });
    expect(await removeOrArchiveItem(centerA, paypal)).toBe('archived');
    expect(await sql`SELECT 1 FROM donations WHERE item_id = ${paypal}`).toHaveLength(1);

    await sql`DELETE FROM donations WHERE item_id IN (${live}, ${paypal})`;
    await sql`DELETE FROM items WHERE id IN (${live}, ${paypal})`;
  });

  it('keeps the current image when an item is saved without a new one', async () => {
    const id = await createItem(centerA, { ...itemInput, imageUrl: 'https://x.public.blob.vercel-storage.com/a.png' });
    expect(await updateItem(centerA, id, { ...itemInput, name: 'Nuevo nombre' })).toBe(true);
    expect((await getAdminItem(centerA, id))?.imageUrl).toBe('https://x.public.blob.vercel-storage.com/a.png');
  });

  it('keeps archived items archived unless explicitly reactivated', async () => {
    const id = await createItem(centerA, itemInput);
    await sql`UPDATE items SET status = 'archived' WHERE id = ${id}`;
    expect(await updateItem(centerA, id, { ...itemInput, name: 'typo', status: 'archived' })).toBe(true);
    expect(await getAdminItem(centerA, id)).toMatchObject({ status: 'archived', name: 'typo' });
    expect(await updateItem(centerA, id, { ...itemInput, status: 'active' })).toBe(true);
    expect((await getAdminItem(centerA, id))?.status).toBe('active');
  });

  it('does not archive an active item through the form', async () => {
    const id = await createItem(centerA, itemInput);
    expect(await updateItem(centerA, id, { ...itemInput, status: 'archived' })).toBe(true);
    expect((await getAdminItem(centerA, id))?.status).toBe('active');
  });

  it('creates an item requested as archived as a draft', async () => {
    const id = await createItem(centerA, { ...itemInput, status: 'archived' });
    expect((await getAdminItem(centerA, id))?.status).toBe('draft');
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

describe.skipIf(!databaseUrl)('item ordering, gallery and donation limits', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let center: string;
  const blob = (name: string) => `https://x.public.blob.vercel-storage.com/${name}.png`;
  const END = 9999;

  const names = async () => (await listAdminItems(center)).filter((item) => item.status !== 'archived').map((item) => item.name);
  const idOf = async (name: string) => (await listAdminItems(center)).find((item) => item.name === name)!.id;
  const make = (name: string, sortOrder = END, goal = 100) => createItem(center, { ...itemInput, name, goal, sortOrder });
  const move = async (name: string, position: number) => {
    const id = await idOf(name);
    await updateItem(center, id, { ...itemInput, name, sortOrder: position });
  };

  beforeAll(async () => {
    center = (await createCenter({ slug: `it-c-${suffix}`, name: 'C' }))!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM donations WHERE center_id = ${center}`;
    await sql`DELETE FROM items WHERE center_id = ${center}`;
    await sql`DELETE FROM centers WHERE id = ${center}`;
  });

  it('appends new items at the end and inserts at a position by shifting the others', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) await make(name);
    expect(await names()).toEqual(['a', 'b', 'c', 'd', 'e']);

    await make('f', 2);
    expect(await names()).toEqual(['a', 'f', 'b', 'c', 'd', 'e']);
  });

  it('moves an item up, down, to the same place, and clamps out-of-range positions', async () => {
    await move('e', 1);
    expect(await names()).toEqual(['e', 'a', 'f', 'b', 'c', 'd']);

    await move('e', 4);
    expect(await names()).toEqual(['a', 'f', 'b', 'e', 'c', 'd']);

    await move('e', 4);
    expect(await names()).toEqual(['a', 'f', 'b', 'e', 'c', 'd']);

    await move('a', END);
    expect(await names()).toEqual(['f', 'b', 'e', 'c', 'd', 'a']);

    await move('d', -3);
    expect(await names()).toEqual(['d', 'f', 'b', 'e', 'c', 'a']);

    const positions = (await listAdminItems(center)).map((item) => item.sortOrder).sort((x, y) => x - y);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('leaves archived items out of the numbering', async () => {
    const id = await idOf('b');
    await sql`UPDATE items SET status = 'archived' WHERE id = ${id}`;
    await move('c', 1);
    expect(await names()).toEqual(['c', 'd', 'f', 'e', 'a']);
    expect((await listAdminItems(center)).filter((item) => item.status !== 'archived').map((item) => item.sortOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps several images per item with a single cover', async () => {
    const id = await make('gallery');
    await addItemImage(center, id, blob('a'));
    await addItemImage(center, id, blob('b'));
    await addItemImage(center, id, blob('c'));
    const urls = async () => (await listItemImages(center, id)).map((image) => image.image_url);
    expect(await urls()).toEqual([blob('a'), blob('b'), blob('c')]);
    expect((await getAdminItem(center, id))?.imageUrl).toBe(blob('a'));

    const third = (await listItemImages(center, id))[2].id;
    expect(await setCoverImage(center, id, third)).toBe(true);
    expect(await urls()).toEqual([blob('c'), blob('a'), blob('b')]);
    expect((await getAdminItem(center, id))?.imageUrl).toBe(blob('c'));

    expect(await removeItemImage(center, id, third)).toBe(true);
    expect(await urls()).toEqual([blob('a'), blob('b')]);
    expect((await getAdminItem(center, id))?.imageUrl).toBe(blob('a'));
    expect((await listItemImages(center, id)).map((image) => image.sort_order)).toEqual([0, 1]);
  });

  it('caps the gallery and refuses images of other centers', async () => {
    const id = await make('crowded');
    for (let i = 0; i < MAX_ITEM_IMAGES; i++) expect(await addItemImage(center, id, blob(`n${i}`))).toBe('added');
    expect(await addItemImage(center, id, blob('extra'))).toBe('full');

    const other = (await createCenter({ slug: `it-d-${suffix}`, name: 'D' }))!.id;
    try {
      const imageId = (await listItemImages(center, id))[0].id;
      expect(await addItemImage(other, id, blob('x'))).toBe('missing');
      expect(await removeItemImage(other, id, imageId)).toBe(false);
      expect(await setCoverImage(other, id, imageId)).toBe(false);
    } finally {
      await sql`DELETE FROM centers WHERE id = ${other}`;
    }
  }, 30_000);

  it('refuses a manual donation above what is left to pay', async () => {
    const id = await make('limit', END, 100);
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 60, note: '' })).toEqual({ status: 'created' });
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 50, note: '' })).toEqual({ status: 'too_much', remaining: 40 });
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 40, note: '' })).toEqual({ status: 'created' });
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 0.01, note: '' })).toEqual({ status: 'too_much', remaining: 0 });
  });
});

describe.skipIf(!databaseUrl)('center fee schedule', () => {
  const slug = `it-fees-${Math.random().toString(36).slice(2, 8)}`;
  let centerId: string;

  beforeAll(async () => {
    centerId = (await createCenter({ slug, name: 'Fees' }))!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM centers WHERE id = ${centerId}`;
  });

  it('starts with the standard PayPal rates for both buttons and can be changed', async () => {
    expect((await getCenterBySlug(slug))?.fees).toEqual({
      paypal: { rate: 0.029, fixed: 0.35 },
      card: { rate: 0.029, fixed: 0.35 },
    });

    await updateFeeSettings(centerId, { paypalPercent: 3.49, paypalFixed: 0.4, cardPercent: 2.9, cardFixed: 0.35 });
    expect((await getCenterBySlug(slug))?.fees).toEqual({
      paypal: { rate: 0.0349, fixed: 0.4 },
      card: { rate: 0.029, fixed: 0.35 },
    });
  });
});

describe.skipIf(!databaseUrl)('center appearance images', () => {
  const slug = `it-look-${Math.random().toString(36).slice(2, 8)}`;
  let centerId: string;
  const base = { name: 'Look', heroTitle: 't', heroText: 'x', primaryColor: '#007986', removeHeroImage: false, removeLogo: false };
  const HERO = 'https://x.public.blob.vercel-storage.com/hero.png';
  const LOGO = 'https://x.public.blob.vercel-storage.com/logo.png';

  beforeAll(async () => {
    centerId = (await createCenter({ slug, name: 'Look' }))!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM centers WHERE id = ${centerId}`;
  });

  it('keeps the images when saved untouched and removes them only on request', async () => {
    await updateAppearance(centerId, { ...base, heroImageUrl: HERO, logoUrl: LOGO });
    expect(await getCenterBySlug(slug)).toMatchObject({ hero_image_url: HERO, logo_url: LOGO });

    await updateAppearance(centerId, { ...base, name: 'Look 2', heroImageUrl: null, logoUrl: null });
    expect(await getCenterBySlug(slug)).toMatchObject({ name: 'Look 2', hero_image_url: HERO, logo_url: LOGO });

    await updateAppearance(centerId, { ...base, heroImageUrl: null, logoUrl: null, removeHeroImage: true });
    expect(await getCenterBySlug(slug)).toMatchObject({ hero_image_url: null, logo_url: LOGO });

    await updateAppearance(centerId, { ...base, heroImageUrl: null, logoUrl: null, removeLogo: true });
    expect(await getCenterBySlug(slug)).toMatchObject({ hero_image_url: null, logo_url: null });
  });
});

describe.skipIf(!databaseUrl)('deleting files from Blob', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const blob = (name: string) => `https://x.public.blob.vercel-storage.com/it-blob-${suffix}/${name}.png`;
  let centerId: string;
  const input = { name: 'Blob', description: '', goal: 50, status: 'active' as const, sortOrder: 9300, imageUrl: null };
  const look = { name: 'Blob', heroTitle: 't', heroText: 'x', primaryColor: '#007986', removeHeroImage: false, removeLogo: false, heroImageUrl: null, logoUrl: null };

  beforeAll(async () => {
    centerId = (await createCenter({ slug: `it-blob-${suffix}`, name: 'Blob' }))!.id;
  });

  beforeEach(() => mockDel.mockReset());

  afterAll(async () => {
    await sql`DELETE FROM items WHERE center_id = ${centerId}`;
    await sql`DELETE FROM centers WHERE id = ${centerId}`;
  });

  it('deletes the file when a gallery image is removed, but not one still used elsewhere', async () => {
    const item = await createItem(centerId, input);
    await addItemImage(centerId, item, blob('one'));
    await addItemImage(centerId, item, blob('two'));
    const [one, two] = await listItemImages(centerId, item);

    expect(await removeItemImage(centerId, item, one.id)).toBe(true);
    expect(mockDel).toHaveBeenCalledWith([blob('one')]);

    mockDel.mockReset();
    const other = await createItem(centerId, { ...input, name: 'Other' });
    await addItemImage(centerId, other, blob('two'));
    expect(await removeItemImage(centerId, item, two.id)).toBe(true);
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('deletes the old cover and logo when they are replaced or removed, and keeps them when untouched', async () => {
    await updateAppearance(centerId, { ...look, heroImageUrl: blob('hero1'), logoUrl: blob('logo1') });
    expect(mockDel).not.toHaveBeenCalled();

    await updateAppearance(centerId, { ...look, name: 'Renamed' });
    expect(mockDel).not.toHaveBeenCalled();

    await updateAppearance(centerId, { ...look, heroImageUrl: blob('hero2') });
    expect(mockDel).toHaveBeenLastCalledWith([blob('hero1')]);

    await updateAppearance(centerId, { ...look, removeLogo: true });
    expect(mockDel).toHaveBeenLastCalledWith([blob('logo1')]);

    await updateAppearance(centerId, { ...look, heroImageUrl: blob('hero2') });
    expect(mockDel).toHaveBeenCalledTimes(2);
  });

  it('deletes the images of an item that is deleted, and none when it is only archived', async () => {
    const gone = await createItem(centerId, { ...input, name: 'Gone' });
    await addItemImage(centerId, gone, blob('g1'));
    await addItemImage(centerId, gone, blob('g2'));
    expect(await removeOrArchiveItem(centerId, gone)).toBe('deleted');
    expect(mockDel).toHaveBeenCalledTimes(1);
    expect([...mockDel.mock.calls[0][0]].sort()).toEqual([blob('g1'), blob('g2')]);

    mockDel.mockReset();
    const kept = await createItem(centerId, { ...input, name: 'Kept' });
    await addItemImage(centerId, kept, blob('k1'));
    await recordPaypalDonation({ centerId, itemId: kept, amount: '5.00', currency: 'EUR', captureId: `CAP-${suffix}-blob` });
    expect(await removeOrArchiveItem(centerId, kept)).toBe('archived');
    expect(mockDel).not.toHaveBeenCalled();
    await sql`DELETE FROM donations WHERE item_id = ${kept}`;
  });
});

describe.skipIf(!databaseUrl)('audit log and session versions', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let centerId: string;
  let otherId: string;
  const email = `audit-${suffix}@example.org`;

  beforeAll(async () => {
    centerId = (await createCenter({ slug: `it-au-${suffix}`, name: 'Audit' }))!.id;
    otherId = (await createCenter({ slug: `it-ao-${suffix}`, name: 'Other' }))!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM user_sessions WHERE email = ${email}`;
    await sql`DELETE FROM centers WHERE id IN (${centerId}, ${otherId})`;
  });

  it('lists entries newest first, scoped to the center and paginated', async () => {
    await sql`
      INSERT INTO audit_log (center_id, actor_email, action, entity_type, summary, created_at)
      SELECT ${centerId}, ${email}, 'item.update', 'item', 'change ' || n, now() - ((52 - n) || ' minutes')::interval
      FROM generate_series(0, 51) AS n
    `;
    await recordAudit({ centerId: otherId, actorEmail: email, action: 'item.update', entityType: 'item', summary: 'foreign' });
    const first = await listAudit(centerId, 1);
    expect(first.total).toBe(52);
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0].summary).toBe('change 51');
    expect(first.rows.some((row) => row.summary === 'foreign')).toBe(false);
    expect((await listAudit(centerId, 2)).rows).toHaveLength(2);
  });

  it('does not throw on a bad center reference', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordAudit({ centerId: '99999999-9999-4999-8999-999999999999', actorEmail: email, action: 'x', entityType: 'x', summary: 'x' }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('starts at 0 and increments per bump, case-insensitively', async () => {
    expect(await getSessionVersion(email)).toBe(0);
    expect(await bumpSessionVersion(email)).toBe(1);
    expect(await bumpSessionVersion(email.toUpperCase())).toBe(2);
    expect(await getSessionVersion(email)).toBe(2);
  });
});

describe.skipIf(!databaseUrl)('reconciling PayPal captures', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let center: string;
  let item: string;
  const order = (n: string) => `ORD-${suffix}-${n}`;
  const capture = { captureId: `CAP-${suffix}`, amount: '10.66', currency: 'EUR', itemId: '', donationAmount: '10.00' };
  const status = async (id: string) => (await sql`SELECT status FROM pending_captures WHERE paypal_order_id = ${id}`)[0]?.status;
  const age = (id: string, interval: string) =>
    sql`UPDATE pending_captures SET created_at = NOW() - ${interval}::interval WHERE paypal_order_id = ${id}`;
  const run = () => reconcilePendingCaptures({ encryptionKey: 'k' });

  beforeAll(async () => {
    center = (await createCenter({ slug: `it-rec-${suffix}`, name: 'Reconcile' }))!.id;
    item = await createItem(center, itemInput);
    capture.itemId = item;
  });

  beforeEach(() => mockLookupOrder.mockReset());

  afterAll(async () => {
    await sql`DELETE FROM pending_captures WHERE center_id = ${center}`;
    await sql`DELETE FROM donations WHERE center_id = ${center}`;
    await sql`DELETE FROM items WHERE center_id = ${center}`;
    await sql`DELETE FROM centers WHERE id = ${center}`;
  });

  it('recovers a captured payment whose donation insert failed, without duplicating it', async () => {
    await recordPendingCapture({ orderId: order('ok'), centerId: center, itemId: item, amount: '10.66' });
    await age(order('ok'), '10 minutes');
    mockLookupOrder.mockResolvedValue({ state: 'completed', capture });

    expect(await run()).toMatchObject({ recorded: 1 });
    expect(await status(order('ok'))).toBe('recorded');
    const donations = await sql`SELECT amount, fee_amount, source FROM donations WHERE paypal_capture_id = ${capture.captureId}`;
    expect(donations).toHaveLength(1);
    expect(donations[0]).toMatchObject({ amount: '10.00', fee_amount: '0.66', source: 'paypal' });

    await sql`UPDATE pending_captures SET status = 'pending', resolved_at = NULL WHERE paypal_order_id = ${order('ok')}`;
    expect(await run()).toMatchObject({ recorded: 1 });
    expect(await sql`SELECT 1 FROM donations WHERE paypal_capture_id = ${capture.captureId}`).toHaveLength(1);
  });

  it('ignores orders that are too recent', async () => {
    await recordPendingCapture({ orderId: order('new'), centerId: center, itemId: item, amount: '5.00' });
    expect(await run()).toMatchObject({ checked: 0 });
    expect(await status(order('new'))).toBe('pending');
  });

  it('exposes unresolved orders and hides abandoned ones', async () => {
    await recordPendingCapture({ orderId: order('abandoned'), centerId: center, itemId: item, amount: '5.00' });
    await recordPendingCapture({ orderId: order('approved'), centerId: center, itemId: item, amount: '7.00' });
    await age(order('abandoned'), '5 hours');
    await age(order('approved'), '5 hours');
    mockLookupOrder.mockImplementation(async (_credentials: unknown, id: string) => ({
      state: 'not_completed',
      status: id === order('approved') ? 'APPROVED' : 'CREATED',
    }));

    await run();
    expect(await status(order('abandoned'))).toBe('not_paid');
    expect(await status(order('approved'))).toBe('needs_review');
    const unresolved = (await listUnresolvedCaptures()).filter((row) => row.center_id === center);
    expect(unresolved.map((row) => row.paypal_order_id)).toEqual([order('approved')]);
    expect(unresolved[0].item_name).toBe('Cáliz');
  });

  it('never records an order the superadmin resolved by hand, even if PayPal completes it later', async () => {
    const id = order('manual');
    await recordPendingCapture({ orderId: id, centerId: center, itemId: item, amount: '20.00' });
    await age(id, '2 days');
    expect((await listUnresolvedCaptures()).map((row) => row.paypal_order_id)).toContain(id);

    expect(await resolveCaptureManually({ orderId: id, note: 'apuntada a mano', actorEmail: 'boss@example.org' })).toMatchObject({ center_id: center, amount: '20.00' });
    expect(await resolveCaptureManually({ orderId: id, note: 'otra vez', actorEmail: 'boss@example.org' })).toBeNull();
    const [row] = await sql`SELECT status, resolution_note, resolved_by, resolved_at FROM pending_captures WHERE paypal_order_id = ${id}`;
    expect(row).toMatchObject({ status: 'resolved', resolution_note: 'apuntada a mano', resolved_by: 'boss@example.org' });
    expect(row.resolved_at).not.toBeNull();
    expect((await listUnresolvedCaptures()).map((r) => r.paypal_order_id)).not.toContain(id);

    const manualCapture = `CAP-${suffix}-manual`;
    mockLookupOrder.mockResolvedValue({ state: 'completed', capture: { ...capture, captureId: manualCapture } });
    expect(await run()).toMatchObject({ recorded: 0 });
    await resolvePendingCapture(id, 'recorded');
    expect(await status(id)).toBe('resolved');
    expect(await sql`SELECT 1 FROM donations WHERE paypal_capture_id = ${manualCapture}`).toHaveLength(0);
  });

  it('flags a completed capture for an item outside the center, keeping the capture id for the admin list', async () => {
    const id = order('foreign');
    const foreignCapture = `CAP-${suffix}-foreign`;
    await recordPendingCapture({ orderId: id, centerId: center, itemId: item, amount: '5.00' });
    await age(id, '10 minutes');
    mockLookupOrder.mockImplementation(async (_credentials: unknown, orderId: string) =>
      orderId === id
        ? { state: 'completed', capture: { ...capture, captureId: foreignCapture, itemId: '00000000-0000-4000-8000-000000000000' } }
        : { state: 'not_found' },
    );

    await run();
    expect(await status(id)).toBe('needs_review');
    const flagged = (await listUnresolvedCaptures()).find((row) => row.paypal_order_id === id);
    expect(flagged?.paypal_capture_id).toBe(foreignCapture);
    expect(await sql`SELECT 1 FROM donations WHERE paypal_capture_id = ${foreignCapture}`).toHaveLength(0);
  });

  it('pages through reconcilable orders with a stable cursor', async () => {
    const ids = ['page-a', 'page-b', 'page-c'].map(order);
    for (const id of ids) {
      await recordPendingCapture({ orderId: id, centerId: center, itemId: item, amount: '1.00' });
    }
    await sql`UPDATE pending_captures SET created_at = '2001-01-01T00:00:00.123456Z' WHERE paypal_order_id = ANY(${ids})`;

    const first = await listReconcilableCaptures(5, 2);
    expect(first.map((row) => row.paypal_order_id)).toEqual(ids.slice(0, 2));
    const last = first[1];
    const second = await listReconcilableCaptures(5, 2, { cursor: last.cursor, orderId: last.paypal_order_id });
    expect(second[0].paypal_order_id).toBe(ids[2]);
    await sql`DELETE FROM pending_captures WHERE paypal_order_id = ANY(${ids})`;
  });

  it('prunes finished rows older than 30 days but keeps open and hand-resolved ones', async () => {
    const ids = { paid: order('old-paid'), gone: order('old-gone'), open: order('old-open'), review: order('old-review'), manual: order('old-manual') };
    for (const id of Object.values(ids)) {
      await recordPendingCapture({ orderId: id, centerId: center, itemId: item, amount: '1.00' });
    }
    await sql`UPDATE pending_captures SET status = 'recorded' WHERE paypal_order_id = ${ids.paid}`;
    await sql`UPDATE pending_captures SET status = 'not_paid' WHERE paypal_order_id = ${ids.gone}`;
    await sql`UPDATE pending_captures SET status = 'needs_review' WHERE paypal_order_id = ${ids.review}`;
    await sql`UPDATE pending_captures SET status = 'resolved' WHERE paypal_order_id = ${ids.manual}`;
    await sql`UPDATE pending_captures SET created_at = NOW() - interval '31 days' WHERE paypal_order_id = ANY(${Object.values(ids)})`;

    expect(await pruneFinishedCaptures()).toBeGreaterThanOrEqual(2);
    expect(await status(ids.paid)).toBeUndefined();
    expect(await status(ids.gone)).toBeUndefined();
    expect(await status(ids.open)).toBe('pending');
    expect(await status(ids.review)).toBe('needs_review');
    expect(await status(ids.manual)).toBe('resolved');
    await sql`DELETE FROM pending_captures WHERE paypal_order_id = ANY(${Object.values(ids)})`;
  });
});

describe.skipIf(!databaseUrl)('reordering, duplicating and batch status', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const blob = (name: string) => `https://x.public.blob.vercel-storage.com/it-ux-${suffix}/${name}.png`;
  let center: string;
  let other: string;
  const input = { name: 'x', description: 'desc', goal: 80, status: 'active' as const, sortOrder: 9999, imageUrl: null };
  const all = async (centerId = center) => listAdminItems(centerId);
  const live = async () => (await all()).filter((item) => item.status !== 'archived').map((item) => item.name);
  const idOf = async (name: string) => (await all()).find((item) => item.name === name)!.id;

  beforeAll(async () => {
    center = (await createCenter({ slug: `it-ux-${suffix}`, name: 'UX' }))!.id;
    other = (await createCenter({ slug: `it-ux2-${suffix}`, name: 'UX2' }))!.id;
    for (const name of ['a', 'b', 'c', 'd']) await createItem(center, { ...input, name });
  });

  beforeEach(() => mockDel.mockReset());

  afterAll(async () => {
    await sql`DELETE FROM items WHERE center_id IN (${center}, ${other})`;
    await sql`DELETE FROM centers WHERE id IN (${center}, ${other})`;
  });

  it('applies a full order in one statement and renumbers from 1', async () => {
    const [a, b, c, d] = await Promise.all(['a', 'b', 'c', 'd'].map(idOf));
    expect(await reorderItems(center, [d, b, a, c])).toBe(4);
    expect(await live()).toEqual(['d', 'b', 'a', 'c']);
    expect((await all()).map((item) => item.sortOrder)).toEqual([1, 2, 3, 4]);
  });

  it('keeps unlisted items after the listed ones, ignores duplicates, unknown ids and other centers', async () => {
    const foreign = await createItem(other, input);
    const [a, b] = await Promise.all(['a', 'b'].map(idOf));
    await reorderItems(center, [b, b, '00000000-0000-4000-8000-000000000000', foreign, a]);
    expect(await live()).toEqual(['b', 'a', 'd', 'c']);
    expect((await all(other))[0].sortOrder).toBe(1);
    expect(await reorderItems(center, [])).toBe(4);
    expect(await live()).toEqual(['b', 'a', 'd', 'c']);
  });

  it('applies batch status changes only inside the center and compacts positions', async () => {
    const foreign = await createItem(other, input);
    const [a, d] = await Promise.all(['a', 'd'].map(idOf));
    expect(await setItemsStatus(center, [a, foreign], 'archive')).toBe(1);
    expect((await getAdminItem(other, foreign))?.status).toBe('active');
    expect(await live()).toEqual(['b', 'd', 'c']);
    expect((await all()).filter((item) => item.status !== 'archived').map((item) => item.sortOrder)).toEqual([1, 2, 3]);

    expect(await setItemsStatus(center, [d], 'hide')).toBe(1);
    expect((await getAdminItem(center, d))?.status).toBe('draft');
    expect(await setItemsStatus(center, [a], 'hide')).toBe(0);
    expect(await setItemsStatus(center, [a, d], 'show')).toBe(2);
    expect((await getAdminItem(center, a))?.status).toBe('active');
    expect(await live()).toHaveLength(4);
    expect(new Set((await all()).map((item) => item.sortOrder)).size).toBe(4);
  });

  it('duplicates an item as a hidden copy at the end, with its images, and never across centers', async () => {
    const source = await createItem(center, { ...input, name: 'src', description: 'long', goal: 12.5 });
    await addItemImage(center, source, blob('one'));
    await addItemImage(center, source, blob('two'));
    const copy = (await duplicateItem(center, source))!;
    expect(copy).toBeTruthy();
    expect(await getAdminItem(center, copy)).toMatchObject({ name: 'Copia de src', description: 'long', goal: 12.5, status: 'draft', raised: 0 });
    expect((await live()).at(-1)).toBe('Copia de src');
    expect((await listItemImages(center, copy)).map((image) => image.image_url)).toEqual([blob('one'), blob('two')]);
    expect(await duplicateItem(other, source)).toBeNull();
    expect(await duplicateItem(center, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('keeps the shared files when one of the two items drops an image or is deleted', async () => {
    const source = await createItem(center, { ...input, name: 'shared' });
    await addItemImage(center, source, blob('s1'));
    const copy = (await duplicateItem(center, source))!;

    const [image] = await listItemImages(center, copy);
    expect(await removeItemImage(center, copy, image.id)).toBe(true);
    expect(mockDel).not.toHaveBeenCalled();

    const again = (await duplicateItem(center, source))!;
    expect(await removeOrArchiveItem(center, again)).toBe('deleted');
    expect(mockDel).not.toHaveBeenCalled();

    expect(await removeOrArchiveItem(center, source)).toBe('deleted');
    expect(mockDel).toHaveBeenCalledWith([blob('s1')]);
  });

  it('copies the long names truncated to the limit', async () => {
    const long = await createItem(center, { ...input, name: 'L'.repeat(120) });
    const copy = (await duplicateItem(center, long))!;
    expect((await getAdminItem(center, copy))?.name).toHaveLength(120);
  });
});

describe.skipIf(!databaseUrl)('integrity of deletes and concurrent writes', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let center: string;

  beforeAll(async () => {
    center = (await createCenter({ slug: `it-int-${suffix}`, name: 'Integrity' }))!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM pending_captures WHERE center_id = ${center}`;
    await sql`DELETE FROM donations WHERE center_id = ${center}`;
    await sql`DELETE FROM center_users WHERE center_id = ${center}`;
    await sql`DELETE FROM items WHERE center_id = ${center}`;
    await sql`DELETE FROM centers WHERE id = ${center}`;
  });

  const exists = async (id: string) => (await sql`SELECT 1 FROM items WHERE id = ${id}`).length > 0;
  const withCapture = async (status: string, age = '1 minute') => {
    const id = await createItem(center, { ...itemInput, name: `cap-${status}` });
    const order = `ORD-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    await recordPendingCapture({ orderId: order, centerId: center, itemId: id, amount: '5.00' });
    await sql`UPDATE pending_captures SET status = ${status}, created_at = NOW() - ${age}::interval WHERE paypal_order_id = ${order}`;
    return { id, order };
  };

  it('deletes an item whose only pending captures are abandoned or stale', async () => {
    for (const [status, age] of [['not_paid', '1 minute'], ['recorded', '1 minute'], ['pending', '30 hours']] as const) {
      const { id, order } = await withCapture(status, age);
      expect(await removeOrArchiveItem(center, id)).toBe('deleted');
      expect(await exists(id)).toBe(false);
      expect(await sql`SELECT 1 FROM pending_captures WHERE paypal_order_id = ${order}`).toHaveLength(0);
    }
  });

  it('archives instead of deleting while a payment may still be unrecorded', async () => {
    for (const [status, age] of [['pending', '1 minute'], ['needs_review', '30 hours']] as const) {
      const { id, order } = await withCapture(status, age);
      expect(await removeOrArchiveItem(center, id)).toBe('archived');
      expect(await exists(id)).toBe(true);
      expect(await sql`SELECT 1 FROM pending_captures WHERE paypal_order_id = ${order}`).toHaveLength(1);
    }
  });

  it('never exceeds the goal when manual donations race', async () => {
    const id = await createItem(center, { ...itemInput, name: 'race', goal: 100 });
    const holder = (sql as any).transaction((txn: typeof sql) => [
      txn`SELECT id FROM items WHERE id = ${id} FOR UPDATE`,
      txn`SELECT pg_sleep(1)`,
      txn`INSERT INTO donations (center_id, item_id, amount, currency, source) VALUES (${center}, ${id}, 60, 'EUR', 'manual')`,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const late = await addManualDonation({ centerId: center, itemId: id, amount: 60, note: 'bizum' });
    await holder;
    expect(late).toEqual({ status: 'too_much', remaining: 40 });
    const [{ total }] = await sql`SELECT SUM(amount) AS total FROM donations WHERE item_id = ${id}`;
    expect(Number(total)).toBe(60);
  });

  it('allows concurrent manual donations up to the goal and no further', async () => {
    const id = await createItem(center, { ...itemInput, name: 'race2', goal: 100 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => addManualDonation({ centerId: center, itemId: id, amount: 30, note: 'bizum' })),
    );
    expect(results.filter((r) => r.status === 'created')).toHaveLength(3);
    const [{ total }] = await sql`SELECT SUM(amount) AS total FROM donations WHERE item_id = ${id}`;
    expect(Number(total)).toBe(90);
  });

  it('keeps one manager when the last two remove each other', async () => {
    const a = `a-${suffix}@example.org`;
    const b = `b-${suffix}@example.org`;
    await addCenterUser(center, a);
    await addCenterUser(center, b);
    const results = await Promise.all([removeCenterUser(center, a), removeCenterUser(center, b)]);
    expect([...results].sort()).toEqual(['last', 'removed']);
    expect(await sql`SELECT 1 FROM center_users WHERE center_id = ${center}`).toHaveLength(1);
  });
});

describe.skipIf(!databaseUrl)('partial PayPal refunds', () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  let center: string;
  let other: string;

  beforeAll(async () => {
    center = (await createCenter({ slug: `it-pr-${suffix}`, name: 'Partial' }))!.id;
    other = (await createCenter({ slug: `it-po-${suffix}`, name: 'Other' }))!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM audit_log WHERE center_id IN (${center}, ${other})`;
    await sql`DELETE FROM donations WHERE center_id IN (${center}, ${other})`;
    await sql`DELETE FROM items WHERE center_id IN (${center}, ${other})`;
    await sql`DELETE FROM centers WHERE id IN (${center}, ${other})`;
  });

  const donationOf = async (itemId: string) => (await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${itemId}`)[0].id;
  const publicItem = async (itemId: string) => (await listPublicItems(center)).find((item) => item.id === itemId)!;

  it('discounts the refunded part everywhere, un-funds the item and keeps the donor', async () => {
    const id = await createItem(center, { ...itemInput, name: 'partial', goal: 20, sortOrder: 1 });
    await recordPaypalDonation({ centerId: center, itemId: id, amount: '20.00', feeAmount: '0.66', currency: 'EUR', captureId: `CAP-${suffix}-p1` });
    expect(await publicItem(id)).toMatchObject({ raised: 20, status: 'funded', donorCount: 1 });
    const donation = await donationOf(id);

    expect(await applyPartialRefund(other, donation, '5.00')).toEqual({ outcome: 'missing' });
    expect(await applyPartialRefund(center, donation, '5.00')).toEqual({ outcome: 'updated', previous: '0.00' });

    expect(await publicItem(id)).toMatchObject({ raised: 15, status: 'active', donorCount: 1 });
    expect(await getAdminItem(center, id)).toMatchObject({ raised: 15 });
    expect(await getDonationSummary(center, id)).toMatchObject({ raised: 15 });
    const page = await listDonations(center, { itemId: id });
    expect(page.activeSum).toBe(15);
    expect(page.rows[0]).toMatchObject({ amount: '20.00', refunded_amount: '5.00' });
    expect(page.rows[0].refunded_at).not.toBeNull();
    expect((await getDashboard(center)).netRaised).toBe(15);
    expect(await countCenterDonors(center)).toBe(1);
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 6, note: 'bizum' })).toEqual({ status: 'too_much', remaining: 5 });
  });

  it('is idempotent, follows a growing refund, clamps to the donation and refuses inconsistent values', async () => {
    const id = await createItem(center, { ...itemInput, name: 'grow', goal: 50, sortOrder: 2 });
    await recordPaypalDonation({ centerId: center, itemId: id, amount: '10.00', currency: 'EUR', captureId: `CAP-${suffix}-p2` });
    const donation = await donationOf(id);

    expect(await applyPartialRefund(center, donation, '2.00')).toEqual({ outcome: 'updated', previous: '0.00' });
    expect(await applyPartialRefund(center, donation, '2.00')).toEqual({ outcome: 'unchanged' });
    expect(await applyPartialRefund(center, donation, '7.50')).toEqual({ outcome: 'updated', previous: '2.00' });
    expect(await getAdminItem(center, id)).toMatchObject({ raised: 2.5 });
    expect(await applyPartialRefund(center, donation, '99.00')).toEqual({ outcome: 'updated', previous: '7.50' });
    expect(await getAdminItem(center, id)).toMatchObject({ raised: 0 });

    await expect(sql`UPDATE donations SET refunded_amount = 10.01 WHERE id = ${donation}`).rejects.toThrow();
    await expect(sql`UPDATE donations SET refunded_amount = -1 WHERE id = ${donation}`).rejects.toThrow();

    await addManualDonation({ centerId: center, itemId: id, amount: 5, note: 'efectivo' });
    const manual = (await sql<{ id: string }>`SELECT id FROM donations WHERE item_id = ${id} AND source = 'manual'`)[0].id;
    expect(await applyPartialRefund(center, manual, '1.00')).toEqual({ outcome: 'missing' });
  });

  it('lists live partial refunds for the superadmin and drops them once voided', async () => {
    const id = await createItem(center, { ...itemInput, name: 'listed', goal: 50, sortOrder: 3 });
    await recordPaypalDonation({ centerId: center, itemId: id, amount: '30.00', currency: 'EUR', captureId: `CAP-${suffix}-p3` });
    const donation = await donationOf(id);
    await applyPartialRefund(center, donation, '4.00');

    const listed = await listPartialRefunds();
    expect(listed.rows[0]).toMatchObject({ id: donation, center_slug: `it-pr-${suffix}`, item_name: 'listed', refunded_amount: '4.00', paypal_capture_id: `CAP-${suffix}-p3` });
    expect(listed.total).toBeGreaterThanOrEqual(1);

    await voidPaypalDonation(center, donation, { reason: 'Reembolso en PayPal', actorEmail: null });
    expect((await listPartialRefunds(200)).rows.some((row) => row.id === donation)).toBe(false);
    expect(await applyPartialRefund(center, donation, '5.00')).toEqual({ outcome: 'missing' });
  });

  it('runs end to end in the daily sync: discounts once, audits once, and voids when the refund becomes total', async () => {
    await updatePaypal(center, { clientId: 'cid', env: 'sandbox', secretEncrypted: 'v1:a:b:c' });
    const id = await createItem(center, { ...itemInput, name: 'synced', goal: 10, sortOrder: 4 });
    const capture = `CAP-${suffix}-sync`;
    await recordPaypalDonation({ centerId: center, itemId: id, amount: '10.00', feeAmount: '0.66', currency: 'EUR', captureId: capture });
    const donation = await donationOf(id);
    mockLookupCaptureRefund.mockImplementation(async (_credentials: unknown, captureId: string) =>
      captureId === capture ? { state: 'partially_refunded', refundedAmount: '5.33', currency: 'EUR' } : { state: 'not_refunded' },
    );

    const first = await syncPaypalRefunds({ encryptionKey: 'k' });
    expect(first.partiallyRefunded).toContainEqual({
      centerSlug: `it-pr-${suffix}`, donationId: donation, captureId: capture, refundedGross: '5.33', refundedNet: '5.00', updated: true,
    });
    expect(await publicItem(id)).toMatchObject({ raised: 5, status: 'active' });

    const second = await syncPaypalRefunds({ encryptionKey: 'k' });
    expect(second.partiallyRefunded.find((entry) => entry.donationId === donation)).toMatchObject({ updated: false });
    const audits = (await listAudit(center, 1)).rows.filter((entry) => entry.action === 'donation.partial_refund');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_email: 'PayPal (automático)', entity_id: donation });

    mockLookupCaptureRefund.mockImplementation(async (_credentials: unknown, captureId: string) =>
      captureId === capture ? { state: 'refunded' } : { state: 'not_refunded' },
    );
    expect((await syncPaypalRefunds({ encryptionKey: 'k' })).voided).toBeGreaterThanOrEqual(1);
    const row = (await listDonations(center, { itemId: id })).rows[0];
    expect(row).toMatchObject({ void_reason: 'Reembolso en PayPal', voided_by: null });
    expect(await publicItem(id)).toMatchObject({ raised: 0, donorCount: 0 });

    await sql`UPDATE centers SET paypal_client_id = NULL, paypal_secret_encrypted = NULL WHERE id = ${center}`;
  });
});
