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
