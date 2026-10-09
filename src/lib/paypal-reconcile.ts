import { credentialsFor, lookupOrder, type CaptureResult, type PayPalCredentials } from './paypal';
import { getCenterWithSecretById } from './repo/centers';
import { recordPaypalDonation } from './repo/donations';
import {
  listReconcilableCaptures,
  resolvePendingCapture,
  touchPendingCapture,
  type PendingCapture,
} from './repo/pending-captures';

export const RECONCILE_MIN_AGE_MINUTES = 5;
export const ABANDONED_AFTER_HOURS = 3;

export type RecordCaptureOutcome = 'created' | 'duplicate' | 'item_not_found' | 'unsupported_currency';

export async function recordCapture(centerId: string, capture: CaptureResult): Promise<RecordCaptureOutcome> {
  if (capture.currency !== 'EUR') return 'unsupported_currency';
  const creditedAmount = capture.donationAmount ?? capture.amount;
  const feeCents = Math.round(parseFloat(capture.amount) * 100) - Math.round(parseFloat(creditedAmount) * 100);
  return recordPaypalDonation({
    centerId,
    itemId: capture.itemId,
    amount: creditedAmount,
    feeAmount: (feeCents / 100).toFixed(2),
    currency: capture.currency,
    captureId: capture.captureId,
  });
}

export type ReconcileOutcome = 'recorded' | 'not_paid' | 'needs_review' | 'pending';

export async function reconcileCapture(
  credentials: PayPalCredentials,
  pending: Pick<PendingCapture, 'paypal_order_id' | 'center_id' | 'created_at'>,
  now: Date = new Date(),
): Promise<ReconcileOutcome> {
  const orderId = pending.paypal_order_id;
  const lookup = await lookupOrder(credentials, orderId);

  if (lookup.state === 'completed') {
    const outcome = await recordCapture(pending.center_id, lookup.capture);
    if (outcome === 'created' || outcome === 'duplicate') {
      await resolvePendingCapture(orderId, 'recorded');
      return 'recorded';
    }
    await resolvePendingCapture(orderId, 'needs_review', `captured ${lookup.capture.captureId}: ${outcome}`);
    return 'needs_review';
  }

  const abandoned = now.getTime() - new Date(pending.created_at).getTime() > ABANDONED_AFTER_HOURS * 3_600_000;
  if (lookup.state === 'not_found') {
    await resolvePendingCapture(orderId, 'not_paid', 'order not found in PayPal');
    return 'not_paid';
  }
  if (!abandoned) {
    await touchPendingCapture(orderId, `order ${lookup.status}`);
    return 'pending';
  }
  if (lookup.status === 'APPROVED') {
    await resolvePendingCapture(orderId, 'needs_review', 'approved by the payer but never captured');
    return 'needs_review';
  }
  await resolvePendingCapture(orderId, 'not_paid', `order ${lookup.status}`);
  return 'not_paid';
}

export interface ReconcileSummary {
  checked: number;
  recorded: number;
  notPaid: number;
  needsReview: number;
  stillPending: number;
  errors: number;
}

export async function reconcilePendingCaptures(
  options: { olderThanMinutes?: number; encryptionKey?: string; now?: Date } = {},
): Promise<ReconcileSummary> {
  const encryptionKey = options.encryptionKey ?? import.meta.env.ENCRYPTION_KEY;
  const pendings = await listReconcilableCaptures(options.olderThanMinutes ?? RECONCILE_MIN_AGE_MINUTES);
  const summary: ReconcileSummary = { checked: 0, recorded: 0, notPaid: 0, needsReview: 0, stillPending: 0, errors: 0 };
  const credentialsByCenter = new Map<string, PayPalCredentials | null>();

  for (const pending of pendings) {
    summary.checked++;
    try {
      if (!credentialsByCenter.has(pending.center_id)) {
        const center = await getCenterWithSecretById(pending.center_id);
        credentialsByCenter.set(pending.center_id, center ? credentialsFor(center, encryptionKey) : null);
      }
      const credentials = credentialsByCenter.get(pending.center_id);
      if (!credentials) {
        await resolvePendingCapture(pending.paypal_order_id, 'needs_review', 'center has no PayPal credentials');
        summary.needsReview++;
        continue;
      }
      const outcome = await reconcileCapture(credentials, pending, options.now);
      if (outcome === 'recorded') summary.recorded++;
      else if (outcome === 'not_paid') summary.notPaid++;
      else if (outcome === 'needs_review') summary.needsReview++;
      else summary.stillPending++;
    } catch (error) {
      summary.errors++;
      console.error('Error conciliando orden PayPal', pending.paypal_order_id, error);
      await touchPendingCapture(pending.paypal_order_id, error instanceof Error ? error.message : String(error)).catch(() => {});
    }
  }
  return summary;
}
