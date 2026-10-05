import { SignJWT } from 'jose';
import { expect, test, type BrowserContext } from '@playwright/test';

const secret = new TextEncoder().encode('e2e-session-secret-e2e-session-secret');
const ORIGIN = 'http://localhost:4321';

const mint = (email: string) =>
    new SignJWT({ email })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(`uid-${email}`)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

async function signIn(context: BrowserContext, email: string) {
    await context.addCookies([{ name: 'session', value: await mint(email), url: ORIGIN }]);
}

test.describe('admin access control', () => {
    test('anonymous visitors are sent to the login page', async ({ page }) => {
        await page.goto('/recoletos/admin');
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByRole('button', { name: 'Entrar con Google' })).toBeVisible();
    });

    test('the home page links to the login page', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('link', { name: 'Acceso para encargadas' }).click();
        await expect(page).toHaveURL(/\/login$/);
    });

    test('a forged cookie is rejected', async ({ page, context }) => {
        await context.addCookies([{ name: 'session', value: 'forged.value.here', url: ORIGIN }]);
        await page.goto('/recoletos/admin');
        await expect(page).toHaveURL(/\/login$/);
    });

    test('a manager reaches the panel of their own center', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin');
        await expect(page.getByRole('heading', { name: 'Apariencia' })).toBeVisible();
    });

    test('a manager cannot open another center or the superadmin panel', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        expect((await page.goto('/otro/admin'))?.status()).toBe(403);
        expect((await page.goto('/admin'))?.status()).toBe(403);
    });

    test('an unregistered Google account gets nothing', async ({ page, context }) => {
        await signIn(context, 'stranger@example.org');
        expect((await page.goto('/recoletos/admin'))?.status()).toBe(403);
    });

    test('the superadmin sees the centers and can open any panel', async ({ page, context }) => {
        await signIn(context, 'boss@example.org');
        await page.goto('/admin');
        await expect(page.getByRole('heading', { name: 'Centros' })).toBeVisible();
        expect((await page.goto('/otro/admin'))?.status()).toBe(200);
    });

    test('cross-origin writes are blocked', async ({ request }) => {
        const response = await request.post('/api/auth/logout', {
            headers: { origin: 'https://evil.example.com' },
            maxRedirects: 0,
        });
        expect(response.status()).toBe(403);
    });

    test('same-origin logout redirects to login', async ({ request }) => {
        const response = await request.post('/api/auth/logout', {
            headers: { origin: ORIGIN },
            maxRedirects: 0,
        });
        expect(response.status()).toBe(303);
        expect(response.headers()['location']).toBe('/login');
    });

    test('upload endpoint and PayPal endpoints respect center boundaries', async ({ request }) => {
        const anonymous = await request.post('/api/recoletos/upload', {
            headers: { origin: ORIGIN },
            data: {},
            maxRedirects: 0,
        });
        expect(anonymous.status()).toBe(401);

        const unknown = await request.post('/api/no-existe/paypal/create-order', {
            headers: { origin: ORIGIN },
            data: { itemId: '33333333-3333-4333-8333-333333333333', amount: 10 },
        });
        expect(unknown.status()).toBe(404);
    });
});

test.describe('manager removing themselves', () => {
    test('asks for a clear confirmation and ends on a readable page, not a bare 403', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/users');

        const own = page.locator('tr', { hasText: 'manager@example.org' });
        const other = page.locator('tr', { hasText: 'second@example.org' });
        await expect(own.getByRole('button', { name: 'Dejar de ser encargada' })).toBeVisible();
        await expect(other.getByRole('button', { name: 'Quitar acceso' })).toBeVisible();

        let message = '';
        page.once('dialog', (dialog) => {
            message = dialog.message();
            dialog.dismiss();
        });
        await own.getByRole('button', { name: 'Dejar de ser encargada' }).click();
        expect(message).toContain('Te quedarás sin acceso');
        await expect(page).toHaveURL(/\/admin\/users$/);

        page.once('dialog', (dialog) => dialog.accept());
        await own.getByRole('button', { name: 'Dejar de ser encargada' }).click();
        await expect(page).toHaveURL(/\/\?left=recoletos$/);
        await expect(page.getByRole('status')).toContainText('Has dejado de ser encargada de Recoletos');
    });

    test('the superadmin keeps the plain remove button and the forbidden page has a way out', async ({ page, context }) => {
        await signIn(context, 'boss@example.org');
        await page.goto('/recoletos/admin/users');
        await expect(page.getByRole('button', { name: 'Dejar de ser encargada' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Quitar acceso' })).toHaveCount(2);

        await context.clearCookies();
        await signIn(context, 'stranger@example.org');
        const response = await page.goto('/recoletos/admin');
        expect(response?.status()).toBe(403);
        await expect(page.getByRole('heading', { name: 'No tienes acceso a esta página' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Volver a la portada' })).toBeVisible();
    });
});
