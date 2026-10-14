import { credentialsFor, lookupOrder, type CaptureResult, type PayPalCredentials } from './paypal';
import { getCenterWithSecretById } from './repo/centers';
import { centsToDecimalString, toCents } from './money';
import { recordPaypalDonation } from './repo/donations';
import { notifyDonation } from './email/notify';
import {
  listReconcilableCaptures,
  pruneFinishedCaptures,
  recordReconciledCapture,
  resolvePendingCapture,
  touchPendingCapture,
  type PendingCapture,
} from './repo/pending-captures';
import type { CenterWithSecret } from '../types/database';

export const RECONCILE_MIN_AGE_MINUTES = 5;
export const ABANDONED_AFTER_HOURS = 3;
export const RECONCILE_BATCH_SIZE = 50;
export const RECONCILE_CONCURRENCY = 4;
export const RECONCILE_TIME_BUDGET_MS = 30_000;

export type RecordCaptureOutcome = 'created' | 'duplicate' | 'item_not_found' | 'unsupported_currency';

export function creditedAmount(capture: CaptureResult): string {
  return capture.donationAmount ?? capture.amount;
}

function donationFields(capture: CaptureResult) {
  const amount = creditedAmount(capture);
  return {
    amount,
    feeAmount: centsToDecimalString(toCents(capture.amount) - toCents(amount)),
    currency: capture.currency,
    captureId: capture.captureId,
  };
}

export async function recordCapture(centerId: string, capture: CaptureResult): Promise<RecordCaptureOutcome> {
  if (capture.currency !== 'EUR') return 'unsupported_currency';
  return recordPaypalDonation({ centerId, itemId: capture.itemId, ...donationFields(capture) });
}

export type ReconcileOutcome = 'created' | 'recorded' | 'not_paid' | 'needs_review' | 'pending' | 'skipped';

export async function reconcileCapture(
  credentials: PayPalCredentials,
  pending: Pick<PendingCapture, 'paypal_order_id' | 'center_id' | 'created_at'>,
  now: Date = new Date(),
): Promise<{ outcome: ReconcileOutcome; capture?: CaptureResult }> {
  const orderId = pending.paypal_order_id;
  const lookup = await lookupOrder(credentials, orderId);

  if (lookup.state === 'completed') {
    const { capture } = lookup;
    if (capture.currency !== 'EUR') {
      await resolvePendingCapture(orderId, 'needs_review', `captured ${capture.captureId}: unsupported_currency`, capture.captureId);
      return { outcome: 'needs_review' };
    }
    const outcome = await recordReconciledCapture({ orderId, centerId: pending.center_id, itemId: capture.itemId, ...donationFields(capture) });
    if (outcome === 'created') return { outcome: 'created', capture };
    if (outcome === 'duplicate') return { outcome: 'recorded' };
    if (outcome === 'not_pending') return { outcome: 'skipped' };
    await resolvePendingCapture(orderId, 'needs_review', `captured ${capture.captureId}: ${outcome}`, capture.captureId);
    return { outcome: 'needs_review' };
  }

  if (lookup.state === 'capture_pending') {
    await touchPendingCapture(orderId, `capture ${lookup.captureId} PENDING in PayPal`, lookup.captureId);
    return { outcome: 'pending' };
  }
  if (lookup.state === 'capture_failed') {
    await resolvePendingCapture(orderId, 'needs_review', `capture ${lookup.captureId} ${lookup.status} in PayPal, not credited`, lookup.captureId);
    return { outcome: 'needs_review' };
  }

  const abandoned = now.getTime() - new Date(pending.created_at).getTime() > ABANDONED_AFTER_HOURS * 3_600_000;
  if (lookup.state === 'not_found') {
    await resolvePendingCapture(orderId, 'not_paid', 'order not found in PayPal');
    return { outcome: 'not_paid' };
  }
  if (!abandoned) {
    await touchPendingCapture(orderId, `order ${lookup.status}`);
    return { outcome: 'pending' };
  }
  if (lookup.status === 'APPROVED') {
    await resolvePendingCapture(orderId, 'needs_review', 'approved by the payer but never captured');
    return { outcome: 'needs_review' };
  }
  await resolvePendingCapture(orderId, 'not_paid', `order ${lookup.status}`);
  return { outcome: 'not_paid' };
}

export interface ReconcileSummary {
  checked: number;
  recorded: number;
  notPaid: number;
  needsReview: number;
  stillPending: number;
  skipped: number;
  errors: number;
  pruned: number;
  timedOut: boolean;
}

interface CenterContext {
  center: CenterWithSecret;
  credentials: PayPalCredentials | null;
}

export async function reconcilePendingCaptures(
  options: {
    olderThanMinutes?: number;
    encryptionKey?: string;
    now?: Date;
    batchSize?: number;
    concurrency?: number;
    timeBudgetMs?: number;
  } = {},
): Promise<ReconcileSummary> {
  const encryptionKey = options.encryptionKey ?? import.meta.env.ENCRYPTION_KEY;
  const batchSize = options.batchSize ?? RECONCILE_BATCH_SIZE;
  const concurrency = options.concurrency ?? RECONCILE_CONCURRENCY;
  const deadline = Date.now() + (options.timeBudgetMs ?? RECONCILE_TIME_BUDGET_MS);
  const summary: ReconcileSummary = {
    checked: 0,
    recorded: 0,
    notPaid: 0,
    needsReview: 0,
    stillPending: 0,
    skipped: 0,
    errors: 0,
    pruned: 0,
    timedOut: false,
  };

  try {
    summary.pruned = await pruneFinishedCaptures();
  } catch (error) {
    console.error('Error borrando capturas antiguas', error);
  }

  const contexts = new Map<string, Promise<CenterContext | null>>();
  const contextFor = (centerId: string) => {
    let context = contexts.get(centerId);
    if (!context) {
      context = getCenterWithSecretById(centerId).then((center) =>
        center ? { center, credentials: credentialsFor(center, encryptionKey) } : null,
      );
      context.catch(() => contexts.delete(centerId));
      contexts.set(centerId, context);
    }
    return context;
  };

  const reconcileOne = async (pending: PendingCapture) => {
    summary.checked++;
    try {
      const context = await contextFor(pending.center_id);
      if (!context?.credentials) {
        await resolvePendingCapture(pending.paypal_order_id, 'needs_review', 'center has no PayPal credentials');
        summary.needsReview++;
        return;
      }
      const { outcome, capture } = await reconcileCapture(context.credentials, pending, options.now);
      if (outcome === 'created' || outcome === 'recorded') summary.recorded++;
      else if (outcome === 'not_paid') summary.notPaid++;
      else if (outcome === 'needs_review') summary.needsReview++;
      else if (outcome === 'skipped') summary.skipped++;
      else summary.stillPending++;
      if (outcome === 'created' && capture) {
        await notifyDonation({
          center: context.center,
          itemId: capture.itemId,
          amount: creditedAmount(capture),
          donorEmail: capture.payerEmail,
        }).catch((error) => console.error('Error avisando de una donación conciliada', error));
      }
    } catch (error) {
      summary.errors++;
      console.error('Error conciliando orden PayPal', pending.paypal_order_id, error);
      await touchPendingCapture(pending.paypal_order_id, error instanceof Error ? error.message : String(error)).catch(() => {});
    }
  };

  let after: { cursor: string; orderId: string } | null = null;
  while (true) {
    if (Date.now() >= deadline) {
      summary.timedOut = true;
      break;
    }
    const batch = await listReconcilableCaptures(options.olderThanMinutes ?? RECONCILE_MIN_AGE_MINUTES, batchSize, after);
    if (batch.length === 0) break;
    const last = batch[batch.length - 1];
    after = { cursor: last.cursor, orderId: last.paypal_order_id };

    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        if (Date.now() >= deadline) {
          summary.timedOut = true;
          return;
        }
        await reconcileOne(batch[next++]);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, batch.length)) }, worker));
    if (summary.timedOut || batch.length < batchSize) break;
  }
  return summary;
}
