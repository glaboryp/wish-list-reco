import type { APIRoute } from 'astro';
import { captureOrder, credentialsFor } from '../../../../lib/paypal';
import { getCenterWithSecret } from '../../../../lib/repo/centers';
import { notifyDonation } from '../../../../lib/email/notify';
import { recordPaypalDonation } from '../../../../lib/repo/donations';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
  const feeCents = Math.round(parseFloat(capture.amount) * 100) - Math.round(parseFloat(creditedAmount) * 100);

  let outcome;
  try {
    outcome = await recordPaypalDonation({
      centerId: center.id,
      itemId: capture.itemId,
      amount: creditedAmount,
      feeAmount: (feeCents / 100).toFixed(2),
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

  if (outcome === 'created') {
    await notifyDonation({ center, itemId: capture.itemId, amount: creditedAmount, donorEmail: capture.payerEmail });
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
