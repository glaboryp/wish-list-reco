import sql from '../db';

export type PendingCaptureStatus = 'pending' | 'recorded' | 'not_paid' | 'needs_review';

export interface PendingCapture {
  paypal_order_id: string;
  center_id: string;
  item_id: string;
  amount: string;
  status: PendingCaptureStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface UnresolvedCapture extends PendingCapture {
  item_name: string | null;
}

export const STALE_PENDING_HOURS = 24;

export async function recordPendingCapture(input: {
  orderId: string;
  centerId: string;
  itemId: string;
  amount: string;
}): Promise<void> {
  await sql`
    INSERT INTO pending_captures (paypal_order_id, center_id, item_id, amount)
    VALUES (${input.orderId}, ${input.centerId}, ${input.itemId}, ${input.amount})
    ON CONFLICT (paypal_order_id) DO NOTHING
  `;
}

export async function resolvePendingCapture(
  orderId: string,
  status: Exclude<PendingCaptureStatus, 'pending'>,
  lastError: string | null = null,
): Promise<void> {
  await sql`
    UPDATE pending_captures
    SET status = ${status}, last_error = ${lastError}, checked_at = NOW(),
        resolved_at = CASE WHEN ${status} = 'needs_review' THEN NULL ELSE NOW() END
    WHERE paypal_order_id = ${orderId} AND status <> 'recorded'
  `;
}

export async function touchPendingCapture(orderId: string, lastError: string | null): Promise<void> {
  await sql`
    UPDATE pending_captures
    SET attempts = attempts + 1, last_error = ${lastError}, checked_at = NOW()
    WHERE paypal_order_id = ${orderId}
  `;
}

export async function listReconcilableCaptures(olderThanMinutes: number, limit = 50): Promise<PendingCapture[]> {
  const rows = await sql`
    SELECT paypal_order_id, center_id, item_id, amount, status, attempts, last_error, created_at
    FROM pending_captures
    WHERE status = 'pending' AND created_at < NOW() - make_interval(mins => ${olderThanMinutes}::int)
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  return rows as PendingCapture[];
}

export async function listUnresolvedCaptures(): Promise<UnresolvedCapture[]> {
  const rows = await sql`
    SELECT p.paypal_order_id, p.center_id, p.item_id, p.amount, p.status, p.attempts, p.last_error, p.created_at,
      (SELECT name FROM items WHERE id = p.item_id) AS item_name
    FROM pending_captures p
    WHERE p.status = 'needs_review'
      OR (p.status = 'pending' AND p.created_at < NOW() - make_interval(hours => ${STALE_PENDING_HOURS}::int))
    ORDER BY p.created_at ASC
  `;
  return rows as UnresolvedCapture[];
}
