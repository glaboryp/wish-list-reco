import { createHash } from 'node:crypto';
import sql from './db';

export const RATE_LIMITS = {
  createOrder: { limit: 20, windowSeconds: 600 },
  upload: { limit: 30, windowSeconds: 600 },
} as const;

export const RATE_LIMIT_MESSAGE = 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';

const CLEANUP_PROBABILITY = 0.02;

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

export function clientIp(request: Request, clientAddress?: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || clientAddress || 'unknown';
}

export function rateLimitKey(route: string, ip: string, slug = ''): string {
  const hash = createHash('sha256').update(ip).digest('hex').slice(0, 32);
  return `${route}:${slug}:${hash}`;
}

export async function rateLimit(options: { key: string; limit: number; windowSeconds: number }): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = options;
  try {
    const rows = await sql`
      INSERT INTO rate_limits (key, window_start, count)
      VALUES (${key}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}::int) * ${windowSeconds}::int), 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
      RETURNING count, ceil(extract(epoch FROM (window_start + make_interval(secs => ${windowSeconds}::int) - now())))::int AS retry_after
    `;
    const count = Number(rows[0]?.count ?? 0);
    if (Math.random() < CLEANUP_PROBABILITY) {
      await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
    }
    if (count > limit) {
      return { allowed: false, retryAfter: Math.max(1, Number(rows[0]?.retry_after ?? windowSeconds)) };
    }
    return { allowed: true, retryAfter: 0 };
  } catch (error) {
    console.error('Rate limiter unavailable, allowing request', error);
    return { allowed: true, retryAfter: 0 };
  }
}

export async function rateLimitRequest(
  route: keyof typeof RATE_LIMITS,
  request: Request,
  clientAddress: string | undefined,
  slug: string,
): Promise<Response | null> {
  const { limit, windowSeconds } = RATE_LIMITS[route];
  const result = await rateLimit({ key: rateLimitKey(route, clientIp(request, clientAddress), slug), limit, windowSeconds });
  if (result.allowed) return null;
  return new Response(JSON.stringify({ error: RATE_LIMIT_MESSAGE }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(result.retryAfter) },
  });
}
