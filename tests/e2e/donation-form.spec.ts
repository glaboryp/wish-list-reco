import { test, expect, type Page } from '@playwright/test';

const ITEM_URL = '/recoletos/item/33333333-3333-4333-8333-333333333333';

async function mockSdk(page: Page) {
    await page.route('https://www.paypal.com/sdk/js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.paypal = {
                FUNDING: { PAYPAL: 'paypal', CARD: 'card' },
                Buttons: (config) => {
                    (window.__buttons = window.__buttons || []).push(config);
                    return { render: () => Promise.resolve() };
                },
            };`,
        }),
    );
}

const buttonConfig = (page: Page, fundingSource: string) =>
    page.evaluateHandle(
        (source) => (window as any).__buttons.find((b: any) => b.fundingSource === source),
        fundingSource,
    );

test('Preset buttons fill the amount and show the pressed state', async ({ page }) => {
    await mockSdk(page);
    await page.goto(ITEM_URL);

    const amountInput = page.locator('input[name="amount"]');
    const preset = page.getByRole('button', { name: '25 €', exact: true });
    await preset.click();
    await expect(amountInput).toHaveValue('25');
    await expect(preset).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /Completar/ }).click();
    await expect(amountInput).toHaveValue('75');
    await expect(preset).toHaveAttribute('aria-pressed', 'false');
});

test('Covering fees shows the totals for each payment source', async ({ page }) => {
    await mockSdk(page);
    await page.goto(ITEM_URL);

    await page.locator('input[name="amount"]').fill('10');
    await page.getByLabel(/Añadir las comisiones/).check();
    await expect(page.getByText(/Total a pagar: 10,66 € con PayPal o 10,66 € con tarjeta/)).toBeVisible();

    await page.getByLabel(/Añadir las comisiones/).uncheck();
    await expect(page.getByText(/Total a pagar/)).toBeHidden();
});

test('Both PayPal buttons are created once the SDK is ready', async ({ page }) => {
    await mockSdk(page);
    await page.goto(ITEM_URL);

    await expect.poll(() => page.evaluate(() => (window as any).__buttons?.length)).toBe(2);
});

test('Creating an order sends the amount, fee choice and payment source', async ({ page }) => {
    await mockSdk(page);
    let body: any = null;
    await page.route('**/api/recoletos/paypal/create-order', async (route) => {
        body = route.request().postDataJSON();
        await route.fulfill({ json: { id: 'ORDER-1' } });
    });
    await page.goto(ITEM_URL);

    await page.locator('input[name="amount"]').fill('10');
    await page.getByLabel(/Añadir las comisiones/).check();
    await expect.poll(() => page.evaluate(() => (window as any).__buttons?.length)).toBe(2);

    const card = await buttonConfig(page, 'card');
    const orderId = await card.evaluate((config: any) => config.createOrder({}, {}));
    expect(orderId).toBe('ORDER-1');
    expect(body).toEqual({
        itemId: '33333333-3333-4333-8333-333333333333',
        amount: 10,
        coverFees: true,
        paymentSource: 'card',
    });
});

test('Approving a payment shows the thank-you panel', async ({ page }) => {
    await mockSdk(page);
    await page.route('**/api/recoletos/paypal/capture-order', (route) => route.fulfill({ json: { ok: true } }));
    await page.goto(ITEM_URL);
    await expect.poll(() => page.evaluate(() => (window as any).__buttons?.length)).toBe(2);

    const paypal = await buttonConfig(page, 'paypal');
    await paypal.evaluate((config: any) => config.onApprove({ orderID: 'ORDER-1' }));

    await expect(page.getByRole('heading', { name: '¡Gracias por tu donación!' })).toBeVisible();
    await expect(page.getByText('¿Cuánto quieres donar?')).toBeHidden();
});

test('The form shows a visible error when the PayPal SDK fails to load', async ({ page }) => {
    await page.route('https://www.paypal.com/sdk/js*', (route) => route.abort());
    await page.goto(ITEM_URL);

    await expect(page.getByRole('alert').filter({ hasText: 'No hemos podido cargar PayPal' })).toBeVisible();
    await expect(page.getByText('Cargando el formulario de pago')).toBeHidden();
});

test('The PayPal SDK does not block rendering', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('https://www.paypal.com/sdk/js*', async (route) => {
        await gate;
        await route.fulfill({ contentType: 'application/javascript', body: 'window.paypal = undefined;' });
    });
    await page.goto(ITEM_URL, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText('Cargando el formulario de pago')).toBeVisible();
    release();
});

test('Clicking the card button on a small screen pins the card form height', async ({ page }) => {
    await mockSdk(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(ITEM_URL);
    await page.locator('input[name="amount"]').fill('10');
    await expect.poll(() => page.evaluate(() => (window as any).__buttons?.length)).toBe(2);

    const card = await buttonConfig(page, 'card');
    await card.evaluate((config: any) => config.onClick({}, { resolve: async () => {}, reject: async () => {} }));

    await expect(page.locator('[id$="-card"]')).toHaveAttribute('data-expanded', '');
});
