import type { APIRoute } from 'astro';
import sql from '../../../lib/db';

const PAYPAL_ENV = (import.meta.env.PUBLIC_PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase();
const PAYPAL_API_BASE = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { itemId, amount, coverFees } = await request.json();

    if (!itemId || !amount) {
      return new Response(JSON.stringify({ error: 'Faltan datos requeridos (itemId, amount)' }), { status: 400 });
    }

    const donationAmount = parseFloat(amount);
    if (isNaN(donationAmount) || donationAmount < 1) {
      return new Response(JSON.stringify({ error: 'La cantidad debe ser mayor o igual a 1€' }), { status: 400 });
    }

    // Validar item y límites en BD
    const itemResult = await sql`
      SELECT id, name, goal_amount, raised_amount, status
      FROM items
      WHERE id = ${itemId}
    `;

    if (itemResult.length === 0) {
      return new Response(JSON.stringify({ error: 'Artículo no encontrado' }), { status: 404 });
    }

    const item = itemResult[0];
    
    if (item.status === 'funded') {
      return new Response(JSON.stringify({ error: 'Este artículo ya ha sido financiado' }), { status: 400 });
    }

    const remaining = parseFloat(item.goal_amount) - parseFloat(item.raised_amount);
    // Permitimos un pequeño margen por redondeo, pero no mucho más
    if (donationAmount > Math.ceil(remaining)) {
       return new Response(JSON.stringify({ error: `La cantidad supera lo necesario para financiar el artículo (${Math.ceil(remaining)}€)` }), { status: 400 });
    }

    // Calcular fees si es necesario
    let purchaseAmount = donationAmount;
    if (coverFees) {
      const FEE_RATE = 0.029;
      const FIXED_FEE = 0.35;
      const totalToChargeRaw = (donationAmount + FIXED_FEE) / (1 - FEE_RATE);
      purchaseAmount = Math.round(totalToChargeRaw * 100) / 100;
    }

    // Obtener credenciales
    const clientId = import.meta.env.PAYPAL_CLIENT_ID;
    const clientSecret = import.meta.env.PAYPAL_APP_SECRET;

    if (!clientId || !clientSecret) {
      console.error('Faltan credenciales de PayPal');
      return new Response(JSON.stringify({ error: 'Error de configuración del servidor' }), { status: 500 });
    }

    // Obtener token
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' })
    });

    if (!tokenRes.ok) {
      console.error('Error obteniendo token de PayPal', await tokenRes.text());
      return new Response(JSON.stringify({ error: 'Error al conectar con pasarela de pago' }), { status: 500 });
    }

    const { access_token } = await tokenRes.json();

    // Crear orden
    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: {
              currency_code: 'EUR',
              value: String(purchaseAmount.toFixed(2))
            },
            description: `Donación para: ${item.name}`,
            custom_id: String(itemId),
            reference_id: String(itemId)
          }
        ],
        application_context: {
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          brand_name: 'Oratorio Recoletos'
        }
      })
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      console.error('Error creando orden PayPal', orderData);
      return new Response(JSON.stringify({ error: 'Error al crear la orden de pago' }), { status: 500 });
    }

    return new Response(JSON.stringify({ id: orderData.id }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('Error interno en create-order', e);
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), { status: 500 });
  }
};
