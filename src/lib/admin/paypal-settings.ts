import { encryptSecret } from '../crypto';
import { updatePaypal } from '../repo/centers';
import type { PayPalFormInput } from './forms';

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
