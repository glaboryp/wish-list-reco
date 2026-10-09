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

test.use({ viewport: { width: 390, height: 600 } });

test.beforeEach(async ({ page }) => {
    await mockSdk(page);
});

test.describe('Sticky donate bar', () => {
    test('shows while the form is out of view and scrolls to it', async ({ page }) => {
        await page.goto(ITEM_URL);
        const bar = page.locator('#donate-bar');
        await expect(bar).toBeVisible();

        await bar.getByRole('button', { name: 'Donar' }).click();
        await expect(page.locator('input[name="amount"]')).toBeFocused();
        await expect(bar).toBeHidden();
        await expect(page.locator('input[name="amount"]')).toBeInViewport();
    });

    test('reappears when the form scrolls out of view', async ({ page }) => {
        await page.goto(ITEM_URL);
        await page.locator('#donar').scrollIntoViewIfNeeded();
        await expect(page.locator('#donate-bar')).toBeHidden();

        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await expect(page.locator('#donate-bar')).toBeVisible();
    });

    test('respects the safe-area inset and sits below the form content', async ({ page }) => {
        await page.goto(ITEM_URL);
        const style = await page.locator('#donate-bar').getAttribute('style');
        expect(style).toContain('safe-area-inset-bottom');
    });

    test('is hidden on wide screens', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 800 });
        await page.goto(ITEM_URL);
        await expect(page.locator('#donate-bar')).toBeHidden();
    });

    test('goes away once the donation is completed', async ({ page }) => {
        await page.route('**/api/recoletos/paypal/capture-order', (route) => route.fulfill({ json: { ok: true } }));
        await page.goto(ITEM_URL);
        await expect.poll(() => page.evaluate(() => (window as any).__buttons?.length)).toBe(2);

        await page.evaluate(() => {
            const paypal = (window as any).__buttons.find((b: any) => b.fundingSource === 'paypal');
            return paypal.onApprove({ orderID: 'ORDER-1' });
        });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await expect(page.locator('#donate-bar')).toBeHidden();
    });
});

test.describe('Gallery lightbox', () => {
    test('opens on tap, navigates and closes with the keyboard', async ({ page }) => {
        await page.goto(ITEM_URL);
        await page.getByRole('button', { name: 'Ampliar imagen' }).tap();

        const dialog = page.getByRole('dialog', { name: 'Galería de imágenes' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect(dialog.getByText('1 de 2')).toBeVisible();

        await page.keyboard.press('ArrowRight');
        await expect(dialog.getByText('2 de 2')).toBeVisible();
        await expect(dialog.locator('img')).toHaveAttribute('src', '/oratorio.webp');
        await page.keyboard.press('ArrowLeft');
        await expect(dialog.getByText('1 de 2')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('button', { name: 'Ampliar imagen' })).toBeFocused();
    });

    test('prev and next buttons cycle through the images', async ({ page }) => {
        await page.goto(ITEM_URL);
        await page.getByRole('button', { name: 'Ampliar imagen' }).tap();
        const dialog = page.getByRole('dialog');

        await dialog.getByRole('button', { name: 'Imagen siguiente' }).tap();
        await expect(dialog.getByText('2 de 2')).toBeVisible();
        await dialog.getByRole('button', { name: 'Imagen siguiente' }).tap();
        await expect(dialog.getByText('1 de 2')).toBeVisible();
        await dialog.getByRole('button', { name: 'Imagen anterior' }).tap();
        await expect(dialog.getByText('2 de 2')).toBeVisible();
    });

    test('keeps keyboard focus inside the dialog', async ({ page }) => {
        await page.goto(ITEM_URL);
        await page.getByRole('button', { name: 'Ampliar imagen' }).focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: 'Cerrar galería' })).toBeFocused();

        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Tab');
            expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        }
        await page.keyboard.press('Shift+Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    });

    test('swiping changes the image', async ({ page }) => {
        await page.goto(ITEM_URL);
        await page.getByRole('button', { name: 'Ampliar imagen' }).tap();
        const dialog = page.getByRole('dialog');
        const stage = dialog.locator('[data-lightbox-stage]');
        const box = (await stage.boundingBox())!;
        const y = box.y + box.height / 2;

        await page.mouse.move(box.x + box.width * 0.8, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.2, y, { steps: 5 });
        await page.mouse.up();
        await expect(dialog.getByText('2 de 2')).toBeVisible();

        await page.mouse.move(box.x + box.width * 0.2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.8, y, { steps: 5 });
        await page.mouse.up();
        await expect(dialog.getByText('1 de 2')).toBeVisible();
    });

    test('swiping the page image changes it without opening the lightbox', async ({ page }) => {
        await page.goto(ITEM_URL);
        const opener = page.getByRole('button', { name: 'Ampliar imagen' });
        const box = (await opener.boundingBox())!;
        const y = box.y + box.height / 2;

        await page.mouse.move(box.x + box.width * 0.8, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.2, y, { steps: 5 });
        await page.mouse.up();

        await expect(opener.locator('img')).toHaveAttribute('src', '/oratorio.webp');
        await expect(page.getByRole('dialog')).toBeHidden();
    });
});

test('Thank-you panel celebrates and links to the other items', async ({ page }) => {
    await page.route('**/api/recoletos/paypal/capture-order', (route) => route.fulfill({ json: { ok: true } }));
    await page.goto(ITEM_URL);
    await expect.poll(() => page.evaluate(() => (window as any).__buttons?.length)).toBe(2);

    await page.evaluate(() => {
        const paypal = (window as any).__buttons.find((b: any) => b.fundingSource === 'paypal');
        return paypal.onApprove({ orderID: 'ORDER-1' });
    });

    await expect(page.getByRole('heading', { name: '¡Gracias por tu donación!' })).toBeVisible();
    await expect(page.locator('.confetti')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Ver el artículo actualizado' })).toBeVisible();
    await page.getByRole('link', { name: 'Ver otros artículos' }).click();
    await expect(page).toHaveURL(/\/recoletos#wishlist$/);
});
