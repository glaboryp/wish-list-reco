import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

const { mockDel } = vi.hoisted(() => ({ mockDel: vi.fn() }));
vi.mock('@vercel/blob', () => ({ del: mockDel }));

const { mockLookupOrder } = vi.hoisted(() => ({ mockLookupOrder: vi.fn() }));
vi.mock('../../lib/paypal', () => ({
  lookupOrder: mockLookupOrder,
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
import { createCenter, getCenterBySlug, updateAppearance, updateFeeSettings } from '../../lib/repo/centers';
import { addManualDonation, listDonations, recordPaypalDonation, voidManualDonation, voidPaypalDonation } from '../../lib/repo/donations';
import {
  addItemImage,
  createItem,
  getAdminItem,
  listAdminItems,
  listItemImages,
  listPublicItems,
  MAX_ITEM_IMAGES,
  removeItemImage,
  removeOrArchiveItem,
  setCoverImage,
  updateItem,
} from '../../lib/repo/items';
import { reconcilePendingCaptures } from '../../lib/paypal-reconcile';
import { listUnresolvedCaptures, recordPendingCapture } from '../../lib/repo/pending-captures';
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

    const manual = await sql`SELECT id FROM donations WHERE item_id = ${itemA} AND source = 'manual'`;
    expect(await voidManualDonation(centerA, manual[0].id)).toBe(true);
    expect((await listPublicItems(centerA))[0]).toMatchObject({ raised: 60, status: 'active' });
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
    const donation = (await sql`SELECT id FROM donations WHERE item_id = ${id}`)[0].id;

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
    const donation = (await sql`SELECT id FROM donations WHERE item_id = ${id}`)[0].id;
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
    const manual = await sql`SELECT id FROM donations WHERE item_id = ${itemOne} AND source = 'manual'`;
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

    for (const row of await sql`SELECT id FROM donations WHERE item_id = ${id}`) {
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
    const first = await sql`SELECT id FROM donations WHERE item_id = ${live} AND note = 'voided'`;
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
});
