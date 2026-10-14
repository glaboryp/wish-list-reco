import type { APIRoute } from 'astro';
import { captureOrder, credentialsFor, declinedPayment, lookupOrder, type CaptureState } from '../../../../lib/paypal';
import { creditedAmount, recordCapture } from '../../../../lib/paypal-reconcile';
import { getCenterWithSecret } from '../../../../lib/repo/centers';
import { notifyDonation } from '../../../../lib/email/notify';
import { resolvePendingCapture, touchPendingCapture } from '../../../../lib/repo/pending-captures';

const PROCESSING_MESSAGE =
  'PayPal está terminando de procesar tu pago. No hace falta que vuelvas a pagar: la donación aparecerá en la web en cuanto PayPal la confirme.';
const UNCONFIRMED_MESSAGE =
  'No hemos podido confirmar tu pago. No lo repitas: revisa tu cuenta de PayPal o tu banco y, si ves el cargo, escríbenos.';

async function recoverCapture(credentials: Parameters<typeof lookupOrder>[0], orderId: string): Promise<CaptureState | null> {
  try {
    const lookup = await lookupOrder(credentials, orderId);
    return lookup.state === 'not_completed' || lookup.state === 'not_found' ? null : lookup;
  } catch (error) {
    console.error('Error consultando la orden en PayPal', error);
    return null;
  }
}

async function flagForReview(orderId: string, reason: string, captureId: string | null = null) {
  await resolvePendingCapture(orderId, 'needs_review', reason, captureId).catch((error) =>
    console.error('Error marcando captura para revisión', error),
  );
}
import { json } from '../../../../lib/http';

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

  let state: CaptureState;
  try {
    state = await captureOrder(credentials, orderID);
  } catch (error) {
    const declined = declinedPayment(error);
    if (declined) {
      console.warn('Pago rechazado por PayPal', orderID, declined.code);
      return json({ error: declined.message, code: declined.code }, 422);
    }
    console.error('Error en captura PayPal', error);
    const recovered = await recoverCapture(credentials, orderID);
    if (!recovered) return json({ error: 'Fallo al capturar la orden' }, 500);
    state = recovered;
  }

  if (state.state === 'capture_pending') {
    await touchPendingCapture(orderID, `capture ${state.captureId} PENDING in PayPal`, state.captureId).catch((error) =>
      console.error('Error anotando captura en proceso', error),
    );
    return json({ pending: true, message: PROCESSING_MESSAGE, captureId: state.captureId }, 202);
  }
  if (state.state === 'capture_failed') {
    console.error('Orden completada con captura no cobrada', orderID, state.captureId, state.status);
    await flagForReview(orderID, `capture ${state.captureId} ${state.status} in PayPal, not credited`, state.captureId);
    return json({ error: UNCONFIRMED_MESSAGE, paymentId: state.captureId }, 409);
  }
  const capture = state.capture;

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
    await flagForReview(orderID, outcome, capture.captureId);
    return json(failure, 500);
  }
  if (outcome === 'item_not_found') {
    console.error('Donación capturada para un artículo que no pertenece al centro', failure);
    await flagForReview(orderID, outcome, capture.captureId);
    return json(failure, 500);
  }
  await resolvePendingCapture(orderID, 'recorded').catch((error) => console.error('Error cerrando captura pendiente', error));

  const amount = creditedAmount(capture);

  if (outcome === 'created') {
    await notifyDonation({ center, itemId: capture.itemId, amount, donorEmail: capture.payerEmail });
  }

  return json({
    ok: true,
    amount,
    chargedAmount: capture.amount,
    currency: capture.currency,
    itemId: capture.itemId,
    captureId: capture.captureId,
    duplicate: outcome === 'duplicate',
  });
};
