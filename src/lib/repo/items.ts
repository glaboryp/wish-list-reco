import sql from '../db';
import { sortForPublic, toWishlistItem } from '../items';
import type { AdminItem, DBItemImage, ItemInput, ItemRow, WishlistItem } from '../../types/database';

export async function listPublicItems(centerId: string): Promise<WishlistItem[]> {
  const rows = await sql`
    SELECT
      i.id, i.center_id, i.name, i.description, i.goal_amount, i.status, i.sort_order, i.created_at, i.updated_at,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      img.image_url, img.alt_text
    FROM items i
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
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      img.image_url, img.alt_text
    FROM items i
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
  };
}

export async function listAdminItems(centerId: string): Promise<AdminItem[]> {
  const rows = await sql`
    SELECT
      i.id, i.name, i.description, i.goal_amount, i.status, i.sort_order,
      COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised_amount,
      (SELECT COUNT(*) FROM donations d WHERE d.item_id = i.id) AS donation_count,
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
      img.image_url, img.alt_text
    FROM items i
    LEFT JOIN item_images img ON img.item_id = i.id AND img.sort_order = 0
    WHERE i.id = ${itemId} AND i.center_id = ${centerId}
    LIMIT 1
  `;
  return rows.length > 0 ? toAdminItem(rows[0]) : null;
}

async function setMainImage(centerId: string, itemId: string, url: string, alt: string | null): Promise<void> {
  await sql`
    WITH removed AS (
      DELETE FROM item_images
      WHERE item_id = ${itemId} AND sort_order = 0
        AND EXISTS (SELECT 1 FROM items WHERE id = ${itemId} AND center_id = ${centerId})
    )
    INSERT INTO item_images (item_id, image_url, alt_text, sort_order)
    SELECT id, ${url}, ${alt}, 0 FROM items WHERE id = ${itemId} AND center_id = ${centerId}
  `;
}

export async function createItem(centerId: string, input: ItemInput): Promise<string> {
  const rows = await sql`
    INSERT INTO items (center_id, name, description, goal_amount, status, sort_order)
    VALUES (${centerId}, ${input.name}, ${input.description}, ${input.goal}, ${input.status}, ${input.sortOrder})
    RETURNING id
  `;
  const id = rows[0].id as string;
  if (input.imageUrl) await setMainImage(centerId, id, input.imageUrl, input.imageAlt);
  return id;
}

export async function updateItem(centerId: string, itemId: string, input: ItemInput): Promise<boolean> {
  const rows = await sql`
    UPDATE items SET
      name = ${input.name},
      description = ${input.description},
      goal_amount = ${input.goal},
      status = ${input.status},
      sort_order = ${input.sortOrder},
      updated_at = NOW()
    WHERE id = ${itemId} AND center_id = ${centerId}
    RETURNING id
  `;
  if (rows.length === 0) return false;
  if (input.imageUrl) {
    await setMainImage(centerId, itemId, input.imageUrl, input.imageAlt);
  } else {
    await sql`
      UPDATE item_images SET alt_text = ${input.imageAlt}
      WHERE item_id = ${itemId} AND sort_order = 0
        AND EXISTS (SELECT 1 FROM items WHERE id = ${itemId} AND center_id = ${centerId})
    `;
  }
  return true;
}

export async function removeOrArchiveItem(
  centerId: string,
  itemId: string,
): Promise<'deleted' | 'archived' | 'missing'> {
  const rows = await sql`
    WITH has AS (
      SELECT EXISTS (SELECT 1 FROM donations WHERE item_id = ${itemId} AND center_id = ${centerId}) AS yes
    ),
    del AS (
      DELETE FROM items
      WHERE id = ${itemId} AND center_id = ${centerId} AND NOT (SELECT yes FROM has)
      RETURNING id
    ),
    arch AS (
      UPDATE items SET status = 'archived', updated_at = NOW()
      WHERE id = ${itemId} AND center_id = ${centerId} AND (SELECT yes FROM has)
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM del) AS deleted, (SELECT COUNT(*) FROM arch) AS archived
  `;
  if (Number(rows[0].deleted) > 0) return 'deleted';
  if (Number(rows[0].archived) > 0) return 'archived';
  return 'missing';
}
