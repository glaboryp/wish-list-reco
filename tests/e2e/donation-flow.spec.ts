import { test, expect } from '@playwright/test';

test('Donation flow', async ({ page }) => {
    await page.route('https://www.paypal.com/sdk/js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.paypal = {
                FUNDING: { PAYPAL: 'paypal', CARD: 'card' },
                Buttons: () => ({ render: () => Promise.resolve() }),
            };`,
        }),
    );

    await page.goto('/recoletos');
    await expect(page).toHaveTitle(/Lista de deseos/);

    const items = page.locator('article');
    await expect(items.first()).toBeVisible();

    await items.first().locator('a[href^="/recoletos/item/"]').first().click();

    await expect(page.url()).toContain('/recoletos/item/');
    await expect(page.locator('h1')).toBeVisible();

    const amountInput = page.locator('input[name="amount"]');
    await expect(amountInput).toBeVisible();

    await amountInput.fill('999999');
    await amountInput.blur();
    await expect(page.locator('text=La cantidad no puede superar')).toBeVisible();

    await amountInput.fill('10');
    await amountInput.blur();
    await expect(page.locator('text=La cantidad no puede superar')).not.toBeVisible();
});

test('Home lists the active centers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Recoletos' })).toBeVisible();
});

test('Unknown and uppercase slugs give 404', async ({ request }) => {
    expect((await request.get('/no-existe')).status()).toBe(404);
    expect((await request.get('/Recoletos')).status()).toBe(404);
});

test('Legacy item URLs redirect to the Recoletos center', async ({ request }) => {
    const response = await request.get('/item/33333333-3333-4333-8333-333333333333', { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toBe('/recoletos/item/33333333-3333-4333-8333-333333333333');
});

test('A non-uuid item id does not crash the page', async ({ request }) => {
    const response = await request.get('/recoletos/item/abc', { maxRedirects: 0 });
    expect(response.status()).toBe(302);
});

test('Item page exposes share metadata', async ({ page, request }) => {
    await page.goto('/recoletos');
    await page.locator('article a[href^="/recoletos/item/"]').first().click();
    await expect(page).toHaveURL(/\/recoletos\/item\//);

    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Cáliz - Recoletos/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /25,00 € de 100,00 €/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^http:\/\/localhost:\d+\/.+\.webp$/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/recoletos\/item\//);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /initial-scale=1/);

    await page.getByRole('button', { name: 'Compartir', exact: true }).click();
    await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
    await expect(page.getByRole('button', { name: 'Copiar enlace' })).toBeVisible();

    const robots = await request.get('/robots.txt');
    expect(await robots.text()).toContain('Sitemap:');
    const sitemap = await request.get('/sitemap.xml');
    const xml = await sitemap.text();
    expect(xml).toContain('/recoletos</loc>');
    expect(xml).toContain('/recoletos/item/');
});
