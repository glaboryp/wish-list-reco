import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context: any, next: any) => {
    const response = await next();

    const headers = response.headers;

    // Security Headers
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' https://www.paypal.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://www.paypal.com https://www.sandbox.paypal.com; frame-src https://www.paypal.com https://www.sandbox.paypal.com;");

    return response;
});
