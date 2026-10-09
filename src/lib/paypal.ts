import { decryptSecret } from './crypto';
import type { CenterWithSecret, PayPalEnv } from '../types/database';

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  env: PayPalEnv;
}

export interface CaptureResult {
  captureId: string;
  amount: string;
  currency: string;
  itemId: string;
  donationAmount: string | null;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function apiBase(env: PayPalEnv): string {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export function credentialsFor(center: CenterWithSecret, encryptionKey: string): PayPalCredentials | null {
  if (!center.paypal_client_id || !center.paypal_secret_encrypted) return null;
  return {
    clientId: center.paypal_client_id,
    clientSecret: decryptSecret(center.paypal_secret_encrypted, encryptionKey),
    env: center.paypal_env,
  };
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

const TOKEN_SAFETY_MARGIN_MS = 60_000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

async function accessToken(credentials: PayPalCredentials): Promise<string> {
  const cacheKey = `${credentials.env}:${credentials.clientId}:${credentials.clientSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const res = await fetch(`${apiBase(credentials.env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  const data = await safeJson(res);
  if (!res.ok || !data.access_token) throw new PayPalError('token request failed', res.status);
  const lifetimeMs = Number(data.expires_in) * 1000;
  if (Number.isFinite(lifetimeMs) && lifetimeMs > TOKEN_SAFETY_MARGIN_MS) {
    tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + lifetimeMs - TOKEN_SAFETY_MARGIN_MS });
  }
  return data.access_token;
}

const DONATION_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

export function customIdFor(itemId: string, donationAmount?: number): string {
  return donationAmount === undefined ? itemId : `${itemId}:${donationAmount.toFixed(2)}`;
}

export function parseCustomId(customId: string, charged: string): { itemId: string; donationAmount: string | null } {
  const [itemId, donation] = customId.split(':');
  if (donation === undefined || !DONATION_PATTERN.test(donation)) return { itemId, donationAmount: null };
  const donationCents = Math.round(parseFloat(donation) * 100);
  const chargedCents = Math.round(parseFloat(charged) * 100);
  if (donationCents <= 0 || donationCents >= chargedCents) return { itemId, donationAmount: null };
  return { itemId, donationAmount: (donationCents / 100).toFixed(2) };
}

export async function createOrder(
  credentials: PayPalCredentials,
  input: { amount: number; description: string; itemId: string; brandName: string; donationAmount?: number },
): Promise<string> {
  const token = await accessToken(credentials);
  const res = await fetch(`${apiBase(credentials.env)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: 'EUR', value: input.amount.toFixed(2) },
          description: input.description,
          custom_id: customIdFor(input.itemId, input.donationAmount),
          reference_id: input.itemId,
        },
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        brand_name: input.brandName,
      },
    }),
  });
  const data = await safeJson(res);
  if (!res.ok || !data.id) throw new PayPalError('order creation failed', res.status);
  return data.id;
}

export async function captureOrder(credentials: PayPalCredentials, orderId: string): Promise<CaptureResult> {
  const token = await accessToken(credentials);
  const base = `${apiBase(credentials.env)}/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let data: any;
  const res = await fetch(`${base}/capture`, { method: 'POST', headers });
  data = await safeJson(res);
  if (!res.ok) {
    const alreadyCaptured = data?.details?.some((d: any) => d.issue === 'ORDER_ALREADY_CAPTURED');
    if (!alreadyCaptured) throw new PayPalError('capture failed', res.status);
    const readBack = await fetch(base, { headers });
    data = await safeJson(readBack);
    if (!readBack.ok) throw new PayPalError('order lookup failed', readBack.status);
  }

  return completedCapture(data);
}

function completedCapture(data: any): CaptureResult {
  if (data.status !== 'COMPLETED') throw new PayPalError(`order not completed: ${data.status}`);
  const captures = data.purchase_units?.[0]?.payments?.captures ?? [];
  const capture = captures.find((c: any) => c.status === 'COMPLETED');
  if (!capture?.id || !capture.amount?.value || !capture.custom_id) {
    throw new PayPalError('incomplete capture data');
  }
  const { itemId, donationAmount } = parseCustomId(capture.custom_id, capture.amount.value);
  return {
    captureId: capture.id,
    amount: capture.amount.value,
    currency: capture.amount.currency_code,
    itemId,
    donationAmount,
  };
}

export type OrderLookup = { state: 'completed'; capture: CaptureResult } | { state: 'not_completed'; status: string } | { state: 'not_found' };

export async function lookupOrder(credentials: PayPalCredentials, orderId: string): Promise<OrderLookup> {
  const token = await accessToken(credentials);
  const res = await fetch(`${apiBase(credentials.env)}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return { state: 'not_found' };
  const data = await safeJson(res);
  if (!res.ok) throw new PayPalError('order lookup failed', res.status);
  if (data.status !== 'COMPLETED') return { state: 'not_completed', status: String(data.status) };
  return { state: 'completed', capture: completedCapture(data) };
}
