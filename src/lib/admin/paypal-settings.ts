import { encryptSecret } from '../crypto';
import { updatePaypal } from '../repo/centers';
import type { PayPalEnv } from '../../types/database';
import type { PayPalFormInput } from './forms';

export function requiresNewSecret(
  center: { paypal_configured: boolean; paypal_client_id: string | null; paypal_env: PayPalEnv },
  input: PayPalFormInput,
): boolean {
  if (input.secret !== null) return false;
  return (
    !center.paypal_configured ||
    input.clientId !== center.paypal_client_id ||
    input.env !== center.paypal_env
  );
}

export async function savePaypalSettings(
  centerId: string,
  input: PayPalFormInput,
  encryptionKey: string,
): Promise<void> {
  await updatePaypal(centerId, {
    clientId: input.clientId,
    env: input.env,
    secretEncrypted: input.secret === null ? null : encryptSecret(input.secret, encryptionKey),
  });
}
