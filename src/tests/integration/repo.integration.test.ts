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
  });

  it('refuses a manual donation above what is left to pay', async () => {
    const id = await make('limit', END, 100);
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 60, note: '' })).toEqual({ status: 'created' });
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 50, note: '' })).toEqual({ status: 'too_much', remaining: 40 });
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 40, note: '' })).toEqual({ status: 'created' });
    expect(await addManualDonation({ centerId: center, itemId: id, amount: 0.01, note: '' })).toEqual({ status: 'too_much', remaining: 0 });
  });
});
