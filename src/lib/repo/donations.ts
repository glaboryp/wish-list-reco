import sql from '../db';
import { listAdminItems } from './items';
import type { AdminItem, DonationRow } from '../../types/database';

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

export async function getDonationSummary(
  centerId: string,
  itemId: string,
): Promise<{ name: string; goal: number; raised: number } | null> {
  const rows = await sql<{ name: string; goal_amount: string; raised: string }>`
    SELECT i.name, i.goal_amount,
      COALESCE((SELECT SUM(d.amount - d.refunded_amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0) AS raised
    FROM items i WHERE i.id = ${itemId} AND i.center_id = ${centerId}
  `;
  if (rows.length === 0) return null;
  return { name: rows[0].name, goal: parseFloat(rows[0].goal_amount), raised: parseFloat(rows[0].raised) };
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
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT id FROM items WHERE id = ${input.itemId} AND center_id = ${input.centerId} FOR UPDATE`,
    txn`
      INSERT INTO donations (center_id, item_id, amount, currency, source, note)
      SELECT ${input.centerId}, i.id, ${input.amount}, 'EUR', 'manual', ${input.note}
      FROM items i
      WHERE i.id = ${input.itemId} AND i.center_id = ${input.centerId}
        AND ${input.amount}::numeric <= i.goal_amount - COALESCE((SELECT SUM(d.amount - d.refunded_amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0)
      RETURNING id
    `,
  ]);
  if (rows.length > 0) return { status: 'created' };

  const item = await sql<{ remaining: string }>`
    SELECT GREATEST(i.goal_amount - COALESCE((SELECT SUM(d.amount - d.refunded_amount) FROM donations d WHERE d.item_id = i.id AND d.voided_at IS NULL), 0), 0) AS remaining
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
  input: { reason: string; actorEmail: string | null },
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

export type PartialRefundOutcome = { outcome: 'updated'; previous: string } | { outcome: 'unchanged' } | { outcome: 'missing' };

export async function applyPartialRefund(centerId: string, donationId: string, refundedAmount: string): Promise<PartialRefundOutcome> {
  const rows = await sql<{ previous: string }>`
    UPDATE donations d SET refunded_amount = LEAST(${refundedAmount}::numeric, d.amount), refunded_at = NOW()
    FROM donations old
    WHERE old.id = d.id AND d.id = ${donationId} AND d.center_id = ${centerId}
      AND d.source = 'paypal' AND d.voided_at IS NULL
      AND d.refunded_amount <> LEAST(${refundedAmount}::numeric, d.amount)
    RETURNING old.refunded_amount AS previous
  `;
  if (rows.length > 0) return { outcome: 'updated', previous: rows[0].previous };
  const existing = await sql`
    SELECT 1 AS ok FROM donations
    WHERE id = ${donationId} AND center_id = ${centerId} AND source = 'paypal' AND voided_at IS NULL
  `;
  return existing.length > 0 ? { outcome: 'unchanged' } : { outcome: 'missing' };
}

export const PARTIAL_REFUNDS_LIMIT = 20;

export interface PartialRefundRow {
  id: string;
  center_id: string;
  center_name: string;
  center_slug: string;
  item_name: string;
  amount: string;
  fee_amount: string;
  refunded_amount: string;
  refunded_at: string;
  paypal_capture_id: string;
}

export async function listPartialRefunds(limit = PARTIAL_REFUNDS_LIMIT): Promise<{ rows: PartialRefundRow[]; total: number }> {
  const [rows, count] = await Promise.all([
    sql<PartialRefundRow>`
      SELECT d.id, d.center_id, c.name AS center_name, c.slug AS center_slug, i.name AS item_name,
        d.amount, d.fee_amount, d.refunded_amount, d.refunded_at, d.paypal_capture_id
      FROM donations d JOIN items i ON i.id = d.item_id JOIN centers c ON c.id = d.center_id
      WHERE d.refunded_amount > 0 AND d.voided_at IS NULL
      ORDER BY d.refunded_at DESC NULLS LAST, d.id DESC
      LIMIT ${limit}
    `,
    sql`SELECT COUNT(*) AS total FROM donations WHERE refunded_amount > 0 AND voided_at IS NULL`,
  ]);
  return { rows, total: Number(count[0]?.total ?? 0) };
}

export interface LivePaypalDonation {
  id: string;
  paypal_capture_id: string;
  amount: string;
  fee_amount: string;
  refunded_amount: string;
  currency: string;
}

export async function listLivePaypalDonations(centerId: string, sinceDays: number, limit: number): Promise<LivePaypalDonation[]> {
  return sql<LivePaypalDonation>`
    SELECT id, paypal_capture_id, amount, fee_amount, refunded_amount, currency FROM donations
    WHERE center_id = ${centerId} AND source = 'paypal' AND voided_at IS NULL
      AND created_at > NOW() - make_interval(days => ${sinceDays}::int)
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
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
    sql<DonationRow>`
      SELECT d.id, d.item_id, i.name AS item_name, d.amount, d.fee_amount, d.refunded_amount, d.refunded_at, d.currency, d.source, d.note, d.voided_at, d.voided_by, d.void_reason, d.created_at
      FROM donations d JOIN items i ON i.id = d.item_id
      WHERE d.center_id = ${centerId} AND (${itemId}::uuid IS NULL OR d.item_id = ${itemId}::uuid)
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    sql<{ total: string; active_sum: string }>`
      SELECT COUNT(*) AS total, COALESCE(SUM(d.amount - d.refunded_amount) FILTER (WHERE d.voided_at IS NULL), 0) AS active_sum
      FROM donations d
      WHERE d.center_id = ${centerId} AND (${itemId}::uuid IS NULL OR d.item_id = ${itemId}::uuid)
    `,
  ]);
  return {
    rows,
    total: Number(totals[0].total),
    activeSum: parseFloat(totals[0].active_sum),
  };
}

export async function listAllDonations(centerId: string, itemId: string | null = null): Promise<DonationRow[]> {
  return sql<DonationRow>`
    SELECT d.id, d.item_id, i.name AS item_name, d.amount, d.fee_amount, d.refunded_amount, d.refunded_at, d.currency, d.source, d.note, d.voided_at, d.voided_by, d.void_reason, d.created_at
    FROM donations d JOIN items i ON i.id = d.item_id
    WHERE d.center_id = ${centerId} AND (${itemId}::uuid IS NULL OR d.item_id = ${itemId}::uuid)
    ORDER BY d.created_at DESC, d.id DESC
  `;
}

export const RECENT_DONATIONS_LIMIT = 5;

export interface DashboardData {
  netRaised: number;
  donationCount: number;
  recent: DonationRow[];
  items: AdminItem[];
}

export async function getDashboard(centerId: string): Promise<DashboardData> {
  const [page, items] = await Promise.all([
    listDonations(centerId, { page: 1, pageSize: RECENT_DONATIONS_LIMIT }),
    listAdminItems(centerId),
  ]);
  return { netRaised: page.activeSum, donationCount: page.total, recent: page.rows, items };
}

export async function countCenterDonors(centerId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*) AS donor_count FROM donations WHERE center_id = ${centerId} AND voided_at IS NULL
  `;
  return Number(rows[0]?.donor_count ?? 0);
}
