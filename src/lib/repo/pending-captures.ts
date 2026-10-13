import sql from '../db';

export type PendingCaptureStatus = 'pending' | 'recorded' | 'not_paid' | 'needs_review' | 'resolved';

export interface PendingCapture {
  paypal_order_id: string;
  center_id: string;
  item_id: string;
  amount: string;
  status: PendingCaptureStatus;
  attempts: number;
  last_error: string | null;
  paypal_capture_id: string | null;
  created_at: string;
}

export interface ReconcilableCapture extends PendingCapture {
  cursor: string;
}

export interface UnresolvedCapture extends PendingCapture {
  item_name: string | null;
}

export const STALE_PENDING_HOURS = 24;
export const PRUNE_AFTER_DAYS = 30;

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
  status: Exclude<PendingCaptureStatus, 'pending' | 'resolved'>,
  lastError: string | null = null,
  captureId: string | null = null,
): Promise<void> {
  await sql`
    UPDATE pending_captures
    SET status = ${status}, last_error = ${lastError}, checked_at = NOW(),
        paypal_capture_id = COALESCE(${captureId}, paypal_capture_id),
        resolved_at = CASE WHEN ${status} = 'needs_review' THEN NULL ELSE NOW() END
    WHERE paypal_order_id = ${orderId} AND status NOT IN ('recorded', 'resolved')
  `;
}

export async function touchPendingCapture(orderId: string, lastError: string | null, captureId: string | null = null): Promise<void> {
  await sql`
    UPDATE pending_captures
    SET attempts = attempts + 1, last_error = ${lastError}, checked_at = NOW(),
        paypal_capture_id = COALESCE(${captureId}, paypal_capture_id)
    WHERE paypal_order_id = ${orderId}
  `;
}

export type ReconciledCaptureOutcome = 'created' | 'duplicate' | 'item_not_found' | 'not_pending';

export async function recordReconciledCapture(input: {
  orderId: string;
  centerId: string;
  itemId: string;
  amount: string;
  feeAmount: string;
  currency: string;
  captureId: string;
}): Promise<ReconciledCaptureOutcome> {
  const [result] = await sql<{ claimed: number; inserted: number }>`
    WITH claimed AS (
      UPDATE pending_captures
      SET status = 'recorded', paypal_capture_id = ${input.captureId}, last_error = NULL, checked_at = NOW(), resolved_at = NOW()
      WHERE paypal_order_id = ${input.orderId} AND status = 'pending'
        AND EXISTS (SELECT 1 FROM items WHERE id = ${input.itemId}::uuid AND center_id = ${input.centerId}::uuid)
      RETURNING paypal_order_id
    ), inserted AS (
      INSERT INTO donations (center_id, item_id, amount, fee_amount, currency, source, paypal_capture_id)
      SELECT ${input.centerId}::uuid, ${input.itemId}::uuid, ${input.amount}::numeric, ${input.feeAmount}::numeric, ${input.currency}, 'paypal', ${input.captureId}
      FROM claimed
      ON CONFLICT (paypal_capture_id) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM claimed)::int AS claimed, (SELECT COUNT(*) FROM inserted)::int AS inserted
  `;
  if (Number(result?.claimed) > 0) return Number(result.inserted) > 0 ? 'created' : 'duplicate';
  const [row] = await sql<{ status: PendingCaptureStatus }>`SELECT status FROM pending_captures WHERE paypal_order_id = ${input.orderId}`;
  return row?.status === 'pending' ? 'item_not_found' : 'not_pending';
}

export async function resolveCaptureManually(input: {
  orderId: string;
  note: string;
  actorEmail: string;
}): Promise<{ center_id: string; amount: string } | null> {
  const [row] = await sql<{ center_id: string; amount: string }>`
    UPDATE pending_captures
    SET status = 'resolved', resolution_note = ${input.note}, resolved_by = ${input.actorEmail}, resolved_at = NOW()
    WHERE paypal_order_id = ${input.orderId} AND status IN ('pending', 'needs_review')
    RETURNING center_id, amount
  `;
  return row ?? null;
}

export async function listReconcilableCaptures(
  olderThanMinutes: number,
  limit = 50,
  after: { cursor: string; orderId: string } | null = null,
): Promise<ReconcilableCapture[]> {
  return sql<ReconcilableCapture>`
    SELECT paypal_order_id, center_id, item_id, amount, status, attempts, last_error, paypal_capture_id, created_at,
      created_at::text AS cursor
    FROM pending_captures
    WHERE status = 'pending' AND created_at < NOW() - make_interval(mins => ${olderThanMinutes}::int)
      AND (${after?.cursor ?? null}::timestamptz IS NULL
        OR (created_at, paypal_order_id) > (${after?.cursor ?? null}::timestamptz, ${after?.orderId ?? ''}))
    ORDER BY created_at ASC, paypal_order_id ASC
    LIMIT ${limit}
  `;
}

export async function pruneFinishedCaptures(olderThanDays = PRUNE_AFTER_DAYS): Promise<number> {
  const deleted = await sql`
    DELETE FROM pending_captures
    WHERE status IN ('not_paid', 'recorded') AND created_at < NOW() - make_interval(days => ${olderThanDays}::int)
    RETURNING paypal_order_id
  `;
  return deleted.length;
}

export async function listUnresolvedCaptures(): Promise<UnresolvedCapture[]> {
  return sql<UnresolvedCapture>`
    SELECT p.paypal_order_id, p.center_id, p.item_id, p.amount, p.status, p.attempts, p.last_error, p.paypal_capture_id, p.created_at,
      (SELECT name FROM items WHERE id = p.item_id) AS item_name
    FROM pending_captures p
    WHERE p.status = 'needs_review'
      OR (p.status = 'pending' AND p.created_at < NOW() - make_interval(hours => ${STALE_PENDING_HOURS}::int))
    ORDER BY p.created_at ASC
  `;
}
