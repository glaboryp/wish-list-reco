import { describe, expect, it } from 'vitest';
import { onRequest } from '../middleware';

const run = (request: Request) =>
  (onRequest as any)({ request }, async () => new Response('ok', { status: 200 })) as Promise<Response>;

describe('middleware', () => {
  it('sets the security headers and a CSP that allows Firebase, Google and Blob', async () => {
    const response = await run(new Request('https://wish-list.vercel.app/'));
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(csp).toContain('https://www.paypal.com');
    expect(csp).toContain('https://identitytoolkit.googleapis.com');
    expect(csp).toContain('https://securetoken.googleapis.com');
    expect(csp).toContain('https://apis.google.com');
    expect(csp).toContain('https://*.firebaseapp.com');
    expect(csp).toContain('https://*.vercel-storage.com');
  });

  it('redirects GET requests on the legacy domain without running the app', async () => {
    let reachedApp = false;
    const response = await (onRequest as any)(
      { request: new Request('https://wish-list-reco.vercel.app/') },
      async () => {
        reachedApp = true;
        return new Response('ok');
      },
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://wish-list-oratorio.vercel.app/recoletos');
    expect(reachedApp).toBe(false);
  });

  it('redirects HEAD requests on the legacy domain and keeps the path', async () => {
    const response = await run(new Request('https://wish-list-reco.vercel.app/item/abc?x=1', { method: 'HEAD' }));
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://wish-list-oratorio.vercel.app/item/abc?x=1');
  });

  it('does not redirect writes on the legacy domain', async () => {
    const response = await run(
      new Request('https://wish-list-reco.vercel.app/x', { method: 'POST', headers: { origin: 'https://evil.example.com' } }),
    );
    expect(response.status).toBe(403);
  });

  it('does not redirect the canonical domain', async () => {
    expect((await run(new Request('https://wish-list-oratorio.vercel.app/'))).status).toBe(200);
  });

  it('lets safe methods through without an Origin', async () => {
    expect((await run(new Request('https://wish-list.vercel.app/'))).status).toBe(200);
  });

  it('rejects a cross-origin POST', async () => {
    const response = await run(
      new Request('https://wish-list.vercel.app/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example.com' } }),
    );
    expect(response.status).toBe(403);
  });

  it('rejects a POST with no Origin or Referer', async () => {
    expect((await run(new Request('https://wish-list.vercel.app/x', { method: 'POST' }))).status).toBe(403);
  });

  it('accepts a same-origin POST', async () => {
    const response = await run(
      new Request('https://wish-list.vercel.app/x', { method: 'POST', headers: { origin: 'https://wish-list.vercel.app' } }),
    );
    expect(response.status).toBe(200);
  });
});
