export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSameOrigin(request: Request): boolean {
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;
  try {
    return new URL(source).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
