import { SignJWT } from 'jose';
import { expect, test, type BrowserContext } from '@playwright/test';

const secret = new TextEncoder().encode('e2e-session-secret-e2e-session-secret');
const ORIGIN = 'http://localhost:4321';

async function signIn(context: BrowserContext, email: string) {
    const token = await new SignJWT({ email })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(`uid-${email}`)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);
    await context.addCookies([{ name: 'session', value: token, url: ORIGIN }]);
}

const rowNames = (page: import('@playwright/test').Page) => page.locator('tr[data-reorderable] td[data-label="Artículo"]');

test.describe('reordering items', () => {
    test('the move buttons reorder the list, announce it and persist the new order', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items');
        await expect(rowNames(page)).toHaveText(['Cáliz', 'Casulla']);
        await expect(page.getByRole('button', { name: 'Subir Cáliz' })).toHaveAttribute('aria-disabled', 'true');

        const request = page.waitForRequest((req) => req.url().endsWith('/api/recoletos/items/reorder'));
        await page.getByRole('button', { name: 'Bajar Cáliz' }).click();

        await expect(rowNames(page)).toHaveText(['Casulla', 'Cáliz']);
        await expect(page.locator('[data-reorder-status]')).toContainText('«Cáliz» movido a la posición 2 de 2.');
        expect((await request).postDataJSON()).toEqual({
            ids: ['66666666-6666-4666-8666-666666666666', '33333333-3333-4333-8333-333333333333'],
        });
        await expect(page.locator('[data-reorder-status]')).toContainText('Orden guardado');
        await expect(page.locator('tr[data-reorderable]').first().locator('[data-position]')).toHaveText('1');
    });

    test('the buttons work with the keyboard alone', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items');
        const down = page.getByRole('button', { name: 'Bajar Cáliz' });
        await down.focus();
        await page.keyboard.press('Enter');
        await expect(rowNames(page)).toHaveText(['Casulla', 'Cáliz']);
        await expect(page.getByRole('button', { name: 'Bajar Cáliz' })).toBeFocused();
        await page.getByRole('button', { name: 'Subir Cáliz' }).focus();
        await page.keyboard.press('Space');
        await expect(rowNames(page)).toHaveText(['Cáliz', 'Casulla']);
    });

    test('dragging the handle with the pointer moves the row', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items');
        const handle = page.locator('tr[data-reorderable]').first().locator('[data-handle]');
        const target = await page.locator('tr[data-reorderable]').nth(1).boundingBox();
        const from = (await handle.boundingBox())!;
        const request = page.waitForRequest((req) => req.url().endsWith('/api/recoletos/items/reorder'));
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2, target!.y + target!.height - 4, { steps: 8 });
        await page.mouse.up();
        await expect(rowNames(page)).toHaveText(['Casulla', 'Cáliz']);
        expect((await request).postDataJSON().ids).toHaveLength(2);
    });

    test('the endpoint rejects anonymous callers and bad bodies', async ({ request, context }) => {
        const anonymous = await request.post('/api/recoletos/items/reorder', { headers: { origin: ORIGIN }, data: { ids: [] } });
        expect(anonymous.status()).toBe(401);

        await signIn(context, 'manager@example.org');
        const bad = await context.request.post('/api/recoletos/items/reorder', { headers: { origin: ORIGIN }, data: { ids: 'x' } });
        expect(bad.status()).toBe(400);
        const foreign = await context.request.post('/api/otro/items/reorder', { headers: { origin: ORIGIN }, data: { ids: [] } });
        expect(foreign.status()).toBe(403);
    });
});

test.describe('reordering on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('tapping the buttons reorders the stacked list and the page does not scroll sideways', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items');
        await page.getByRole('button', { name: 'Bajar Cáliz' }).tap();
        await expect(rowNames(page)).toHaveText(['Casulla', 'Cáliz']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});

test.describe('batch actions', () => {
    test('stay disabled until something is selected and then hide the chosen items', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items');
        const hide = page.getByRole('button', { name: 'Ocultar de la web' });
        await expect(hide).toBeDisabled();

        await page.getByLabel('Seleccionar Cáliz').check();
        await expect(page.locator('[data-selected-count]')).toHaveText('1 seleccionado');
        await hide.click();
        await expect(page.getByRole('status').filter({ hasText: 'Artículos ocultos.' })).toBeVisible();
    });

    test('select all and archive asks for confirmation', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items');
        await page.getByLabel('Seleccionar todos').check();
        await expect(page.locator('[data-selected-count]')).toHaveText('2 seleccionados');

        let message = '';
        page.once('dialog', (dialog) => {
            message = dialog.message();
            dialog.dismiss();
        });
        await page.getByRole('button', { name: 'Archivar', exact: true }).click();
        expect(message).toContain('Se archivarán 2 artículos');
        await expect(page).toHaveURL(/\/admin\/items$/);

        page.once('dialog', (dialog) => dialog.accept());
        await page.getByRole('button', { name: 'Archivar', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Artículos archivados.' })).toBeVisible();
    });

    test('a forged batch with an unknown action or no items is refused', async ({ context }) => {
        await signIn(context, 'manager@example.org');
        const unknown = await context.request.post('/recoletos/admin/items', {
            form: { batch_action: 'delete', ids: '33333333-3333-4333-8333-333333333333' },
            headers: { origin: ORIGIN },
            maxRedirects: 0,
        });
        expect(unknown.headers()['location']).toContain('error=');
        const empty = await context.request.post('/recoletos/admin/items', {
            form: { batch_action: 'show' },
            headers: { origin: ORIGIN },
            maxRedirects: 0,
        });
        expect(empty.headers()['location']).toContain('error=');
    });
});

test.describe('duplicating an item', () => {
    test('offers the action on the item page and confirms it', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items/33333333-3333-4333-8333-333333333333');
        await page.getByRole('button', { name: 'Duplicar artículo' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Artículo duplicado' })).toBeVisible();
    });
});

test.describe('unsaved changes', () => {
    const itemUrl = '/recoletos/admin/items/33333333-3333-4333-8333-333333333333';

    test('warns before leaving a changed form, and not after reverting or saving', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto(itemUrl);
        const name = page.getByLabel('Nombre del artículo');
        const original = await name.inputValue();

        const dialogs: string[] = [];
        page.on('dialog', (dialog) => {
            dialogs.push(dialog.message());
            dialog.dismiss();
        });

        await page.getByRole('link', { name: 'Volver a los artículos' }).click();
        expect(dialogs).toHaveLength(0);
        await page.goBack().catch(() => undefined);
        await page.goto(itemUrl);

        await name.fill('Otro nombre');
        await page.getByRole('link', { name: 'Volver a los artículos' }).click();
        expect(dialogs.at(-1)).toContain('cambios sin guardar');
        await expect(page).toHaveURL(new RegExp(`${itemUrl}$`));

        await name.fill(original);
        page.removeAllListeners('dialog');
        const stray: string[] = [];
        page.on('dialog', (dialog) => {
            stray.push(dialog.message());
            dialog.dismiss();
        });
        await page.getByRole('link', { name: 'Volver a los artículos' }).click();
        await expect(page).toHaveURL(/\/admin\/items$/);
        expect(stray).toHaveLength(0);
    });

    test('saving a changed form does not warn', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items/33333333-3333-4333-8333-333333333333');
        const dialogs: string[] = [];
        page.on('dialog', (dialog) => {
            dialogs.push(dialog.message());
            dialog.dismiss();
        });
        await page.getByLabel('Nombre del artículo').fill('Cáliz renovado');
        await page.getByRole('button', { name: 'Guardar cambios' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Artículo guardado.' })).toBeVisible();
        expect(dialogs).toHaveLength(0);
    });

    test('marks the browser unload as cancellable only while there are changes', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items/33333333-3333-4333-8333-333333333333');
        const prevented = () =>
            page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            });
        expect(await prevented()).toBe(false);
        await page.getByLabel('Descripción').fill('cambiada');
        expect(await prevented()).toBe(true);
    });
});

test.describe('toasts', () => {
    test('success is a polite status that dismisses itself and leaves the URL clean', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.clock.install();
        await page.goto('/recoletos/admin/items?ok=item-saved');
        const toast = page.getByRole('status').filter({ hasText: 'Artículo guardado.' });
        await expect(toast).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/items$/);
        await page.clock.fastForward(9000);
        await expect(toast).toHaveCount(0);
    });

    test('errors are alerts that stay until dismissed', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.clock.install();
        await page.goto('/recoletos/admin/items?error=Algo%20ha%20fallado');
        const toast = page.getByRole('alert').filter({ hasText: 'Algo ha fallado' });
        await expect(toast).toBeVisible();
        await page.clock.fastForward(30000);
        await expect(toast).toBeVisible();
        await toast.getByRole('button', { name: 'Cerrar aviso' }).click();
        await expect(toast).toHaveCount(0);
    });
});

test.describe('empty states', () => {
    test('items, donations and users lists explain what to do next', async ({ page, context }) => {
        await signIn(context, 'boss@example.org');
        await page.goto('/otro/admin/items');
        await expect(page.getByText('Todavía no hay artículos')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Añadir el primer artículo' })).toHaveAttribute('href', '#nuevo-articulo');
        await expect(page.getByLabel('Nombre del artículo')).toBeVisible();

        await page.goto('/otro/admin/donations');
        await expect(page.getByText('Todavía no hay donaciones')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Ver los artículos' })).toBeVisible();

        await page.goto('/otro/admin/users');
        await expect(page.getByText('Este centro no tiene encargadas')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Dar acceso a una encargada' })).toBeVisible();
    });
});

test.describe('skip links', () => {
    test('the admin panel offers a skip link as the first stop', async ({ page, context }) => {
        await signIn(context, 'manager@example.org');
        await page.goto('/recoletos/admin/items');
        await page.keyboard.press('Tab');
        const skip = page.getByRole('link', { name: 'Saltar al contenido' });
        await expect(skip).toBeFocused();
        await expect(skip).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#contenido$/);
        await expect(page.locator('main#contenido')).toBeFocused();
    });

    test('the public center page has one too', async ({ page }) => {
        await page.goto('/recoletos');
        await page.keyboard.press('Tab');
        const skip = page.getByRole('link', { name: 'Saltar al contenido' });
        await expect(skip).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#wishlist$/);
    });
});
