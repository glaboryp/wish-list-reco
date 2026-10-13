import sql from '../db';
import { discardBlobs } from './blobs';
import { sortForPublic, toWishlistItem } from '../items';
import type { AdminItem, DBItemImage, ItemInput, ItemRow, WishlistItem } from '../../types/database';

export async function listPublicItems(centerId: string): Promise<WishlistItem[]> {
  const rows = await sql`
    SELECT
      i.id, i.center_id, i.name, i.description, i.goal_amount, i.status, i.sort_order, i.created_at, i.updated_at,
      dn.raised_amount, dn.donor_count,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(d.amount), 0) AS raised_amount, COUNT(*) AS donor_count
      FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL
    ) dn ON true
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.center_id = ${centerId} AND i.status IN ('active', 'funded')
    ORDER BY i.sort_order ASC, i.created_at ASC
  `;
  return sortForPublic((rows as ItemRow[]).map(toWishlistItem));
}

export async function getPublicItem(centerId: string, itemId: string): Promise<WishlistItem | null> {
  const rows = await sql`
    SELECT
      i.id, i.center_id, i.name, i.description, i.goal_amount, i.status, i.sort_order, i.created_at, i.updated_at,
      dn.raised_amount, dn.donor_count,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(d.amount), 0) AS raised_amount, COUNT(*) AS donor_count
      FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL
    ) dn ON true
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.id = ${itemId} AND i.center_id = ${centerId} AND i.status IN ('active', 'funded')
    LIMIT 1
  `;
  return rows.length > 0 ? toWishlistItem(rows[0] as ItemRow) : null;
}

export async function getItemImages(itemId: string): Promise<DBItemImage[]> {
  const rows = await sql`
    SELECT id, item_id, image_url, alt_text, sort_order, created_at
    FROM item_images WHERE item_id = ${itemId} ORDER BY sort_order ASC
  `;
  return rows as DBItemImage[];
}

function toAdminItem(row: any): AdminItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    goal: parseFloat(row.goal_amount),
    raised: parseFloat(row.raised_amount),
    status: row.status,
    sortOrder: row.sort_order,
    imageUrl: row.image_url,
    imageAlt: row.alt_text,
    donationCount: Number(row.donation_count),
    blockingDonationCount: Number(row.blocking_donation_count),
  };
}

export async function listAdminItems(centerId: string): Promise<AdminItem[]> {
  const rows = await sql`
    SELECT
      i.id, i.name, i.description, i.goal_amount, i.status, i.sort_order,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      (SELECT COUNT(*) FROM donations d WHERE d.item_id = i.id) AS donation_count,
      (SELECT COUNT(*) FROM donations d WHERE d.item_id = i.id AND NOT (d.source = 'manual' AND d.voided_at IS NOT NULL)) AS blocking_donation_count,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.center_id = ${centerId}
    ORDER BY i.sort_order ASC, i.created_at ASC
  `;
  return rows.map(toAdminItem);
}

export async function getAdminItem(centerId: string, itemId: string): Promise<AdminItem | null> {
  const rows = await sql`
    SELECT
      i.id, i.name, i.description, i.goal_amount, i.status, i.sort_order,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      (SELECT COUNT(*) FROM donations d WHERE d.item_id = i.id) AS donation_count,
      (SELECT COUNT(*) FROM donations d WHERE d.item_id = i.id AND NOT (d.source = 'manual' AND d.voided_at IS NOT NULL)) AS blocking_donation_count,
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.id = ${itemId} AND i.center_id = ${centerId}
    LIMIT 1
  `;
  return rows.length > 0 ? toAdminItem(rows[0]) : null;
}

export const MAX_ITEM_IMAGES = 10;

async function placeItem(centerId: string, itemId: string, position: number): Promise<void> {
  await sql`
    WITH others AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, created_at ASC, id ASC) AS rn
      FROM items
      WHERE center_id = ${centerId} AND status <> 'archived' AND id <> ${itemId}
    ),
    target AS (
      SELECT GREATEST(1, LEAST(${position}::int, (SELECT COUNT(*) FROM others) + 1)) AS pos
    ),
    placed AS (
      SELECT o.id, CASE WHEN o.rn >= (SELECT pos FROM target) THEN o.rn + 1 ELSE o.rn END AS pos FROM others o
      UNION ALL
      SELECT ${itemId}::uuid, (SELECT pos FROM target)
    ),
    final AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY pos ASC) AS new_pos FROM placed
    )
    UPDATE items SET sort_order = final.new_pos::int
    FROM final
    WHERE items.id = final.id AND items.center_id = ${centerId}
  `;
}

export async function createItem(centerId: string, input: ItemInput): Promise<string> {
  const rows = await sql`
    INSERT INTO items (center_id, name, description, goal_amount, status, sort_order)
    VALUES (${centerId}, ${input.name}, ${input.description}, ${input.goal}, ${input.status === 'archived' ? 'draft' : input.status}, 0)
    RETURNING id
  `;
  const id = rows[0].id as string;
  await placeItem(centerId, id, input.sortOrder);
  if (input.imageUrl) await addItemImage(centerId, id, input.imageUrl);
  return id;
}

export async function updateItem(centerId: string, itemId: string, input: ItemInput): Promise<boolean> {
  const rows = await sql`
    UPDATE items SET
      name = ${input.name},
      description = ${input.description},
      goal_amount = ${input.goal},
      status = CASE WHEN ${input.status}::item_status = 'archived' AND items.status <> 'archived' THEN items.status ELSE ${input.status}::item_status END,
      updated_at = NOW()
    WHERE id = ${itemId} AND center_id = ${centerId}
    RETURNING id, status
  `;
  if (rows.length === 0) return false;
  if (rows[0].status !== 'archived') await placeItem(centerId, itemId, input.sortOrder);
  return true;
}

export async function listItemImages(centerId: string, itemId: string): Promise<DBItemImage[]> {
  const rows = await sql`
    SELECT img.id, img.item_id, img.image_url, img.alt_text, img.sort_order, img.created_at
    FROM item_images img JOIN items i ON i.id = img.item_id
    WHERE img.item_id = ${itemId} AND i.center_id = ${centerId}
    ORDER BY img.sort_order ASC, img.created_at ASC, img.id ASC
  `;
  return rows as DBItemImage[];
}

async function resequenceImages(itemId: string, firstId: string | null): Promise<void> {
  await sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (
        ORDER BY (id = ${firstId}::uuid) DESC, sort_order ASC, created_at ASC, id ASC
      ) - 1 AS pos
      FROM item_images WHERE item_id = ${itemId}
    )
    UPDATE item_images SET sort_order = ranked.pos::int FROM ranked WHERE item_images.id = ranked.id
  `;
}

export async function addItemImage(centerId: string, itemId: string, url: string): Promise<'added' | 'full' | 'missing'> {
  const rows = await sql`
    INSERT INTO item_images (item_id, image_url, sort_order)
    SELECT i.id, ${url}, COALESCE((SELECT MAX(sort_order) + 1 FROM item_images WHERE item_id = i.id), 0)
    FROM items i
    WHERE i.id = ${itemId} AND i.center_id = ${centerId}
      AND (SELECT COUNT(*) FROM item_images WHERE item_id = i.id) < ${MAX_ITEM_IMAGES}
    RETURNING id
  `;
  if (rows.length > 0) {
    await resequenceImages(itemId, null);
    return 'added';
  }
  const exists = await sql`SELECT 1 AS ok FROM items WHERE id = ${itemId} AND center_id = ${centerId}`;
  return exists.length > 0 ? 'full' : 'missing';
}

export async function removeItemImage(centerId: string, itemId: string, imageId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM item_images
    WHERE id = ${imageId} AND item_id = ${itemId}
      AND EXISTS (SELECT 1 FROM items WHERE id = ${itemId} AND center_id = ${centerId})
    RETURNING id, image_url
  `;
  if (rows.length === 0) return false;
  await resequenceImages(itemId, null);
  await discardBlobs([rows[0].image_url]);
  return true;
}

export async function setCoverImage(centerId: string, itemId: string, imageId: string): Promise<boolean> {
  const found = await sql`
    SELECT 1 AS ok FROM item_images img JOIN items i ON i.id = img.item_id
    WHERE img.id = ${imageId} AND img.item_id = ${itemId} AND i.center_id = ${centerId}
  `;
  if (found.length === 0) return false;
  await resequenceImages(itemId, imageId);
  return true;
}

export async function removeOrArchiveItem(
  centerId: string,
  itemId: string,
): Promise<'deleted' | 'archived' | 'missing'> {
  const rows = await sql`
    WITH blocked AS (
      SELECT EXISTS (
        SELECT 1 FROM donations
        WHERE item_id = ${itemId} AND center_id = ${centerId}
          AND NOT (source = 'manual' AND voided_at IS NOT NULL)
      ) AS yes
    ),
    cleared AS (
      DELETE FROM donations
      WHERE item_id = ${itemId} AND center_id = ${centerId}
        AND source = 'manual' AND voided_at IS NOT NULL AND NOT (SELECT yes FROM blocked)
      RETURNING id
    ),
    imgs AS (
      SELECT image_url FROM item_images
      WHERE item_id = ${itemId} AND NOT (SELECT yes FROM blocked)
        AND EXISTS (SELECT 1 FROM items WHERE id = ${itemId} AND center_id = ${centerId})
    ),
    del AS (
      DELETE FROM items
      WHERE id = ${itemId} AND center_id = ${centerId} AND NOT (SELECT yes FROM blocked)
      RETURNING id
    ),
    arch AS (
      UPDATE items SET status = 'archived', updated_at = NOW()
      WHERE id = ${itemId} AND center_id = ${centerId} AND (SELECT yes FROM blocked)
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM del) AS deleted, (SELECT COUNT(*) FROM arch) AS archived, (SELECT COUNT(*) FROM cleared) AS cleared,
           (SELECT COALESCE(array_agg(image_url), '{}') FROM imgs) AS image_urls
  `;
  if (Number(rows[0].deleted) > 0) {
    await discardBlobs(rows[0].image_urls ?? []);
    return 'deleted';
  }
  if (Number(rows[0].archived) > 0) return 'archived';
  return 'missing';
}
