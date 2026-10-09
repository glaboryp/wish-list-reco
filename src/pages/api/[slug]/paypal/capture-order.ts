import type { APIRoute } from 'astro';
import { captureOrder, credentialsFor } from '../../../../lib/paypal';
import { getCenterWithSecret } from '../../../../lib/repo/centers';
import { recordPaypalDonation } from '../../../../lib/repo/donations';
import { json } from '../../../../lib/http';
import { centsToDecimalString, toCents } from '../../../../lib/money';

export const POST: APIRoute = async ({ params, request }) => {
  const center = await getCenterWithSecret(params.slug ?? '');
  if (!center) {
    return json({ error: 'Centro no encontrado' }, 404);
  }

  let orderID: unknown;
  try {
    ({ orderID } = await request.json());
  } catch {
    orderID = undefined;
  }
  if (typeof orderID !== 'string' || !orderID) {
    return json({ error: 'orderID requerido' }, 400);
  }

  const credentials = credentialsFor(center, import.meta.env.ENCRYPTION_KEY);
  if (!credentials) {
    return json({ error: 'Este centro todavía no acepta donaciones' }, 503);
  }

  let capture;
  try {
    capture = await captureOrder(credentials, orderID);
  } catch (error) {
    console.error('Error en captura PayPal', error);
    return json({ error: 'Fallo al capturar la orden' }, 500);
  }

  const failure = {
    error: 'Pago capturado pero error al registrar la donación',
    paymentId: capture.captureId,
    itemId: capture.itemId,
    amount: capture.amount,
  };

  if (capture.currency !== 'EUR') {
    console.error('Captura PayPal en divisa no admitida, no registrada', failure, capture.currency);
    return json(failure, 500);
  }

  const creditedAmount = capture.donationAmount ?? capture.amount;
  const feeCents = toCents(capture.amount) - toCents(creditedAmount);

  let outcome;
  try {
    outcome = await recordPaypalDonation({
      centerId: center.id,
      itemId: capture.itemId,
      amount: creditedAmount,
      feeAmount: centsToDecimalString(feeCents),
      currency: capture.currency,
      captureId: capture.captureId,
    });
  } catch (error) {
    console.error('Error registrando donación', failure, error);
    return json(failure, 500);
  }

  if (outcome === 'item_not_found') {
    console.error('Donación capturada para un artículo que no pertenece al centro', failure);
    return json(failure, 500);
  }

  return json({
    ok: true,
    amount: creditedAmount,
    chargedAmount: capture.amount,
    currency: capture.currency,
    itemId: capture.itemId,
    captureId: capture.captureId,
    duplicate: outcome === 'duplicate',
  });
};
