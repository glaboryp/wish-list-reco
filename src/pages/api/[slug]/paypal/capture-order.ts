import type { APIRoute } from 'astro';
import { captureOrder, credentialsFor, lookupOrder, type CaptureResult } from '../../../../lib/paypal';
import { recordCapture } from '../../../../lib/paypal-reconcile';
import { getCenterWithSecret } from '../../../../lib/repo/centers';
import { resolvePendingCapture } from '../../../../lib/repo/pending-captures';

async function recoverCapture(credentials: Parameters<typeof lookupOrder>[0], orderId: string): Promise<CaptureResult | null> {
  try {
    const lookup = await lookupOrder(credentials, orderId);
    return lookup.state === 'completed' ? lookup.capture : null;
  } catch (error) {
    console.error('Error consultando la orden en PayPal', error);
    return null;
  }
}

async function flagForReview(orderId: string, reason: string) {
  await resolvePendingCapture(orderId, 'needs_review', reason).catch((error) =>
    console.error('Error marcando captura para revisión', error),
  );
}

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

  let capture: CaptureResult;
  try {
    capture = await captureOrder(credentials, orderID);
  } catch (error) {
    console.error('Error en captura PayPal', error);
    const recovered = await recoverCapture(credentials, orderID);
    if (!recovered) return json({ error: 'Fallo al capturar la orden' }, 500);
    capture = recovered;
  }

  const failure = {
    error: 'Pago capturado pero error al registrar la donación',
    paymentId: capture.captureId,
    itemId: capture.itemId,
    amount: capture.amount,
  };

  let outcome;
  try {
    outcome = await recordCapture(center.id, capture);
  } catch (error) {
    console.error('Error registrando donación', failure, error);
    return json(failure, 500);
  }

  if (outcome === 'unsupported_currency') {
    console.error('Captura PayPal en divisa no admitida, no registrada', failure, capture.currency);
    await flagForReview(orderID, outcome);
    return json(failure, 500);
  }
  if (outcome === 'item_not_found') {
    console.error('Donación capturada para un artículo que no pertenece al centro', failure);
    await flagForReview(orderID, outcome);
    return json(failure, 500);
  }
  await resolvePendingCapture(orderID, 'recorded').catch((error) => console.error('Error cerrando captura pendiente', error));

  const creditedAmount = capture.donationAmount ?? capture.amount;

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
