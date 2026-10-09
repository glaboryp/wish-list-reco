import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { reconcilePendingCaptures } from '../../../lib/paypal-reconcile';
import { syncPaypalRefunds } from '../../../lib/paypal-refund-sync';

export const prerender = false;

function authorized(request: Request): boolean {
  const secret = import.meta.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const GET: APIRoute = async ({ request }) => {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });

  const result: Record<string, unknown> = {};
  let failed = false;
  for (const [name, task] of [
    ['reconcile', reconcilePendingCaptures],
    ['refunds', syncPaypalRefunds],
  ] as const) {
    try {
      result[name] = await task();
    } catch (error) {
      failed = true;
      result[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  console.log('paypal-sync', JSON.stringify(result));
  return new Response(JSON.stringify(result), {
    status: failed ? 500 : 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
