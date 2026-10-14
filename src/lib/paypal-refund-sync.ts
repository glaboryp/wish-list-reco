import { formatEuro } from './format';
import { netRefundedAmount } from './money';
import { credentialsFor, lookupCaptureRefund } from './paypal';
import { recordAudit } from './repo/audit';
import { listCentersWithPaypal } from './repo/centers';
import { applyPartialRefund, listLivePaypalDonations, voidPaypalDonation } from './repo/donations';

export const REFUND_LOOKBACK_DAYS = 90;
export const REFUND_CHECKS_PER_CENTER = 100;
export const REFUND_VOID_REASON = 'Reembolso en PayPal';
export const REFUND_SYSTEM_ACTOR = 'PayPal (automático)';

export interface PartialRefund {
  centerSlug: string;
  donationId: string;
  captureId: string;
  refundedGross: string;
  refundedNet: string;
  updated: boolean;
}

export interface RefundSyncSummary {
  centers: number;
  checked: number;
  voided: number;
  partialRefunds: { detected: number; updated: number };
  partiallyRefunded: PartialRefund[];
  errors: number;
}

export async function syncPaypalRefunds(
  options: { encryptionKey?: string; lookbackDays?: number; limitPerCenter?: number } = {},
): Promise<RefundSyncSummary> {
  const encryptionKey = options.encryptionKey ?? import.meta.env.ENCRYPTION_KEY;
  const summary: RefundSyncSummary = {
    centers: 0,
    checked: 0,
    voided: 0,
    partialRefunds: { detected: 0, updated: 0 },
    partiallyRefunded: [],
    errors: 0,
  };

  for (const center of await listCentersWithPaypal()) {
    let credentials;
    try {
      credentials = credentialsFor(center, encryptionKey);
    } catch (error) {
      summary.errors++;
      console.error('Error leyendo credenciales PayPal', center.slug, error);
      continue;
    }
    if (!credentials) continue;
    summary.centers++;

    const donations = await listLivePaypalDonations(
      center.id,
      options.lookbackDays ?? REFUND_LOOKBACK_DAYS,
      options.limitPerCenter ?? REFUND_CHECKS_PER_CENTER,
    );
    for (const donation of donations) {
      summary.checked++;
      try {
        const lookup = await lookupCaptureRefund(credentials, donation.paypal_capture_id);
        if (lookup.state === 'refunded') {
          const outcome = await voidPaypalDonation(center.id, donation.id, { reason: REFUND_VOID_REASON, actorEmail: null });
          if (outcome === 'voided') summary.voided++;
        } else if (lookup.state === 'partially_refunded') {
          if (lookup.currency !== donation.currency) {
            throw new Error(`refund currency ${lookup.currency} does not match donation currency ${donation.currency}`);
          }
          summary.partialRefunds.detected++;
          const net = netRefundedAmount(lookup.refundedAmount, donation.amount, donation.fee_amount);
          const applied = await applyPartialRefund(center.id, donation.id, net);
          const updated = applied.outcome === 'updated';
          if (updated) {
            summary.partialRefunds.updated++;
            await recordAudit({
              centerId: center.id,
              actorEmail: REFUND_SYSTEM_ACTOR,
              action: 'donation.partial_refund',
              entityType: 'donation',
              entityId: donation.id,
              summary: `Reembolso parcial en PayPal (cobro ${donation.paypal_capture_id}): dejan de contar ${formatEuro(Number(net))} de ${formatEuro(Number(donation.amount))}`,
            });
          }
          summary.partiallyRefunded.push({
            centerSlug: center.slug,
            donationId: donation.id,
            captureId: donation.paypal_capture_id,
            refundedGross: lookup.refundedAmount,
            refundedNet: net,
            updated,
          });
        }
      } catch (error) {
        summary.errors++;
        console.error('Error comprobando reembolso PayPal', donation.paypal_capture_id, error);
      }
    }
  }
  return summary;
}
