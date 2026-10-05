import type { APIRoute } from 'astro';
import { DEFAULT_FEE_SCHEDULE, amountWithFees, parsePaymentSource } from '../../../../lib/fees';
import { isUuid } from '../../../../lib/ids';
import { createOrder, credentialsFor } from '../../../../lib/paypal';
import { getCenterWithSecret } from '../../../../lib/repo/centers';
import { getPublicItem } from '../../../../lib/repo/items';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const center = await getCenterWithSecret(params.slug ?? '');
    if (!center || center.status !== 'active') {
      return json({ error: 'Centro no encontrado' }, 404);
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Faltan datos requeridos (itemId, amount)' }, 400);
    }
    const { itemId, amount, coverFees, paymentSource } = body ?? {};

    if (!itemId || amount === undefined || amount === null) {
      return json({ error: 'Faltan datos requeridos (itemId, amount)' }, 400);
    }
    if (!isUuid(itemId)) {
      return json({ error: 'Artículo no encontrado' }, 404);
    }

    const donationAmount = Number(amount);
    if (!Number.isFinite(donationAmount) || donationAmount < 1) {
      return json({ error: 'La cantidad debe ser mayor o igual a 1€' }, 400);
    }

    const item = await getPublicItem(center.id, itemId);
    if (!item) {
      return json({ error: 'Artículo no encontrado' }, 404);
    }
    if (item.status === 'funded') {
      return json({ error: 'Este artículo ya ha sido financiado' }, 400);
    }

    const remaining = Math.ceil(item.goal - item.raised);
    if (donationAmount > remaining) {
      return json({ error: `La cantidad supera lo necesario para financiar el artículo (${remaining}€)` }, 400);
    }

    const credentials = credentialsFor(center, import.meta.env.ENCRYPTION_KEY);
    if (!credentials) {
      return json({ error: 'Este centro todavía no acepta donaciones' }, 503);
    }

    let purchaseAmount = donationAmount;
    if (coverFees) {
      purchaseAmount = amountWithFees(donationAmount, parsePaymentSource(paymentSource), center.fees ?? DEFAULT_FEE_SCHEDULE);
    }

    const id = await createOrder(credentials, {
      amount: purchaseAmount,
      description: `Donación para: ${item.name}`,
      itemId,
      brandName: center.name,
    });
    return json({ id });
  } catch (error) {
    console.error('Error creando orden PayPal', error);
    return json({ error: 'Error al crear la orden de pago' }, 500);
  }
};
