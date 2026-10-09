import { credentialsFor, lookupCaptureRefund } from './paypal';
import { listCentersWithPaypal } from './repo/centers';
import { listLivePaypalDonations, voidPaypalDonation } from './repo/donations';

export const REFUND_LOOKBACK_DAYS = 90;
export const REFUND_CHECKS_PER_CENTER = 100;
export const REFUND_VOID_REASON = 'Reembolso en PayPal';

export interface PartialRefund {
  centerSlug: string;
  donationId: string;
  captureId: string;
}

export interface RefundSyncSummary {
  centers: number;
  checked: number;
  voided: number;
  partiallyRefunded: PartialRefund[];
  errors: number;
}

export async function syncPaypalRefunds(
  options: { encryptionKey?: string; lookbackDays?: number; limitPerCenter?: number } = {},
): Promise<RefundSyncSummary> {
  const encryptionKey = options.encryptionKey ?? import.meta.env.ENCRYPTION_KEY;
  const summary: RefundSyncSummary = { centers: 0, checked: 0, voided: 0, partiallyRefunded: [], errors: 0 };

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
        const state = await lookupCaptureRefund(credentials, donation.paypal_capture_id);
        if (state === 'refunded') {
          const outcome = await voidPaypalDonation(center.id, donation.id, { reason: REFUND_VOID_REASON, actorEmail: null });
          if (outcome === 'voided') summary.voided++;
        } else if (state === 'partially_refunded') {
          summary.partiallyRefunded.push({ centerSlug: center.slug, donationId: donation.id, captureId: donation.paypal_capture_id });
        }
      } catch (error) {
        summary.errors++;
        console.error('Error comprobando reembolso PayPal', donation.paypal_capture_id, error);
      }
    }
  }
  return summary;
}
