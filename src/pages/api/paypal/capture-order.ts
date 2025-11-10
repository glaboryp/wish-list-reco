import type { APIRoute } from 'astro';
import sql from '../../../lib/db';

const PAYPAL_ENV = (import.meta.env.PUBLIC_PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase();
const PAYPAL_API_BASE = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { orderID } = await request.json();
    if (!orderID) {
      return new Response(JSON.stringify({ error: 'orderID requerido' }), { status: 400 });
    }

    const clientId = import.meta.env.PAYPAL_CLIENT_ID;
    const clientSecret = import.meta.env.PAYPAL_APP_SECRET;
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Faltan credenciales de PayPal en el entorno' }), { status: 500 });
    }

    // Get OAuth token
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
      const txt = await tokenRes.text();
      console.error('PayPal token error', tokenRes.status, txt);
      return new Response(JSON.stringify({ error: 'No se pudo autenticar con PayPal' }), { status: 500 });
    }

    const { access_token } = await tokenRes.json();

    // Capture order
    const capRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    });

    const captureJson: any = await capRes.json();
    if (!capRes.ok) {
      console.error('PayPal capture error', capRes.status, captureJson);
      return new Response(JSON.stringify({ error: 'Fallo al capturar la orden' }), { status: 500 });
    }

    const status = captureJson.status;
    if (status !== 'COMPLETED') {
      console.error('Orden no completada', status, captureJson);
      return new Response(JSON.stringify({ error: 'La transacción no se completó' }), { status: 500 });
    }

    // Extract amount and custom_id
    const pu = captureJson.purchase_units?.[0];
    const payments = pu?.payments;
    const capture = payments?.captures?.[0];
    const amount = capture?.amount?.value;
    const currency = capture?.amount?.currency_code;
    const itemId = capture?.custom_id; // El custom_id está en el capture, no en purchase_unit

    if (!itemId || !amount) {
      console.error('Faltan datos en la respuesta de PayPal', { itemId, amount });
      return new Response(JSON.stringify({ error: 'Datos incompletos de PayPal' }), { status: 500 });
    }

    // Actualizar la base de datos
    let updatedItem: any;
    try {
      // Actualizar raised_amount y cambiar status a 'funded' si se alcanza la meta
      const result = await sql`
        UPDATE items
        SET 
          raised_amount = raised_amount + ${amount},
          status = CASE 
            WHEN (raised_amount + ${amount}) >= goal_amount THEN 'funded'::item_status
            ELSE status
          END,
          updated_at = NOW()
        WHERE id = ${itemId}
        RETURNING id, name, raised_amount, goal_amount, status
      `;
      
      updatedItem = result[0];
      const isFunded = updatedItem.status === 'funded';
      
      console.log(`✅ Capturado con éxito €${amount} ${currency} para el artículo ${itemId}`);
      console.log(`   Base de datos actualizada correctamente`);
      console.log(`   ${updatedItem.name}: €${updatedItem.raised_amount} / €${updatedItem.goal_amount}`);
      
      if (isFunded) {
        console.log(`   🎉 ¡Meta alcanzada! Estado cambiado a 'funded'`);
      }

    } catch (dbError) {
      console.error('❌ Error al actualizar la base de datos:', dbError);
      // Aunque el pago fue exitoso, falló la actualización de BD
      // Deberías tener un sistema de retry o notificación manual
      return new Response(
        JSON.stringify({ 
          error: 'Pago capturado pero error al actualizar la base de datos',
          paymentId: capture?.id,
          itemId,
          amount 
        }), 
        { status: 500 }
      );
    }

    return new Response(
      JSON.stringify({ 
        ok: true, 
        amount, 
        currency, 
        itemId, 
        status,
        isFunded: updatedItem.status === 'funded',
        itemName: updatedItem.name,
        raised: updatedItem.raised_amount,
        goal: updatedItem.goal_amount
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('Error en captura', e);
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), { status: 500 });
  }
};
