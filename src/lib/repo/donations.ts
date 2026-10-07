import sql from '../db';
import type { DonationRow } from '../../types/database';

export async function recordPaypalDonation(input: {
  centerId: string;
  itemId: string;
  amount: string;
  feeAmount?: string;
  currency: string;
  captureId: string;
}): Promise<'created' | 'duplicate' | 'item_not_found'> {
  const inserted = await sql`
    INSERT INTO donations (center_id, item_id, amount, fee_amount, currency, source, paypal_capture_id)
    SELECT ${input.centerId}, id, ${input.amount}, ${input.feeAmount ?? '0'}, ${input.currency}, 'paypal', ${input.captureId}
    FROM items WHERE id = ${input.itemId} AND center_id = ${input.centerId}
    ON CONFLICT (paypal_capture_id) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return 'created';
  const existing = await sql`SELECT 1 AS ok FROM donations WHERE paypal_capture_id = ${input.captureId}`;
  return existing.length > 0 ? 'duplicate' : 'item_not_found';
}

export type ManualDonationResult =
  | { status: 'created' }
  | { status: 'missing' }
  | { status: 'too_much'; remaining: number };

export async function addManualDonation(input: {
  centerId: string;
  itemId: string;
  amount: number;
  note: string;
}): Promise<ManualDonationResult> {
  const rows = await sql`
    INSERT INTO donations (center_id, item_id, amount, currency, source, note)
    SELECT ${input.centerId}, i.id, ${input.amount}, 'EUR', 'manual', ${input.note}
    FROM items i
    WHERE i.id = ${input.itemId} AND i.center_id = ${input.centerId}
      AND ${input.amount}::numeric <= i.goal_amount - COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0)
    RETURNING id
  `;
  if (rows.length > 0) return { status: 'created' };

  const item = await sql`
    SELECT GREATEST(i.goal_amount - COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0), 0) AS remaining
    FROM items i WHERE i.id = ${input.itemId} AND i.center_id = ${input.centerId}
  `;
  if (item.length === 0) return { status: 'missing' };
  return { status: 'too_much', remaining: parseFloat(item[0].remaining) };
}

export async function voidManualDonation(centerId: string, donationId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE donations SET voided_at = NOW()
    WHERE id = ${donationId} AND center_id = ${centerId} AND source = 'manual' AND voided_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function voidPaypalDonation(
  centerId: string,
  donationId: string,
  input: { reason: string; actorEmail: string },
): Promise<'voided' | 'already_voided' | 'missing'> {
  const rows = await sql`
    UPDATE donations SET voided_at = NOW(), voided_by = ${input.actorEmail}, void_reason = ${input.reason}
    WHERE id = ${donationId} AND center_id = ${centerId} AND source = 'paypal' AND voided_at IS NULL
    RETURNING id
  `;
  if (rows.length > 0) return 'voided';
  const existing = await sql`
    SELECT 1 AS ok FROM donations WHERE id = ${donationId} AND center_id = ${centerId} AND source = 'paypal'
  `;
  return existing.length > 0 ? 'already_voided' : 'missing';
}

export const DONATIONS_PAGE_SIZE = 50;

export interface DonationsPage {
  rows: DonationRow[];
  total: number;
  activeSum: number;
}

export async function listDonations(
  centerId: string,
  options: { itemId?: string | null; page?: number; pageSize?: number } = {},
): Promise<DonationsPage> {
  const itemId = options.itemId ?? null;
  const pageSize = options.pageSize ?? DONATIONS_PAGE_SIZE;
  const offset = (Math.max(1, options.page ?? 1) - 1) * pageSize;

  const [rows, totals] = await Promise.all([
    sql`
      SELECT d.id, d.item_id, i.name AS item_name, d.amount, d.fee_amount, d.currency, d.source, d.note, d.voided_at, d.voided_by, d.void_reason, d.created_at
      FROM donations d JOIN items i ON i.id = d.item_id
      WHERE d.center_id = ${centerId} AND (${itemId}::uuid IS NULL OR d.item_id = ${itemId}::uuid)
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*) AS total, COALESCE(SUM(d.amount) FILTER (WHERE d.voided_at IS NULL), 0) AS active_sum
      FROM donations d
      WHERE d.center_id = ${centerId} AND (${itemId}::uuid IS NULL OR d.item_id = ${itemId}::uuid)
    `,
  ]);
  return {
    rows: rows as DonationRow[],
    total: Number(totals[0].total),
    activeSum: parseFloat(totals[0].active_sum),
  };
}
