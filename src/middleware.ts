import { defineMiddleware } from 'astro:middleware';
import { isSameOrigin, SAFE_METHODS } from './lib/http';

const CSP = [
    "default-src 'self'",
    "img-src 'self' https: data:",
    "script-src 'self' 'unsafe-inline' https://www.paypal.com https://apis.google.com",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.vercel-storage.com https://vercel.com",
    "frame-src https://www.paypal.com https://www.sandbox.paypal.com https://*.firebaseapp.com https://accounts.google.com",
].join('; ') + ';';

export const onRequest = defineMiddleware(async (context: any, next: any) => {
    if (!SAFE_METHODS.has(context.request.method) && !isSameOrigin(context.request)) {
        return new Response('Forbidden', { status: 403 });
    }

    const response = await next();

    const headers = response.headers;

    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set('Content-Security-Policy', CSP);

    return response;
});
