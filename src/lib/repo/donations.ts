import sql from '../db';
import type { DonationRow } from '../../types/database';

export async function recordPaypalDonation(input: {
  centerId: string;
  itemId: string;
  amount: string;
  currency: string;
  captureId: string;
}): Promise<'created' | 'duplicate' | 'item_not_found'> {
  const inserted = await sql`
    INSERT INTO donations (center_id, item_id, amount, currency, source, paypal_capture_id)
    SELECT ${input.centerId}, id, ${input.amount}, ${input.currency}, 'paypal', ${input.captureId}
    FROM items WHERE id = ${input.itemId} AND center_id = ${input.centerId}
    ON CONFLICT (paypal_capture_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return 'created';
  const existing = await sql`SELECT 1 AS ok FROM donations WHERE paypal_capture_id = ${input.captureId}`;
  return existing.length > 0 ? 'duplicate' : 'item_not_found';
}

export async function addManualDonation(input: {
  centerId: string;
  itemId: string;
  amount: number;
  note: string;
}): Promise<boolean> {
  const rows = await sql`
    INSERT INTO donations (center_id, item_id, amount, currency, source, note)
    SELECT ${input.centerId}, id, ${input.amount}, 'EUR', 'manual', ${input.note}
    FROM items WHERE id = ${input.itemId} AND center_id = ${input.centerId}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function voidManualDonation(centerId: string, donationId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE donations SET voided_at = NOW()
    WHERE id = ${donationId} AND center_id = ${centerId} AND source = 'manual' AND voided_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function listDonations(centerId: string): Promise<DonationRow[]> {
  const rows = await sql`
    SELECT d.id, d.item_id, i.name AS item_name, d.amount, d.currency, d.source, d.note, d.voided_at, d.created_at
    FROM donations d JOIN items i ON i.id = d.item_id
    WHERE d.center_id = ${centerId}
    ORDER BY d.created_at DESC
    LIMIT 200
  `;
  return rows as DonationRow[];
}
