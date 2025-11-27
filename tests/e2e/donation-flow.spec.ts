import { test, expect } from '@playwright/test';

test('Donation flow', async ({ page }) => {
    // 1. Visit Home Page
    await page.goto('/');
    await expect(page).toHaveTitle(/Lista de Deseos/);

    // Check if items are displayed
    const items = page.locator('article');
    await expect(items.first()).toBeVisible();

    // 2. Click on first item
    await items.first().click();

    // 3. Verify Detail Page
    await expect(page.url()).toContain('/item/');
    await expect(page.locator('h1')).toBeVisible();

    // 4. Check Donation Form
    const amountInput = page.locator('input[name="amount"]');
    await expect(amountInput).toBeVisible();

    // 5. Try invalid amount
    await amountInput.fill('999999');
    await amountInput.blur();
    await expect(page.locator('text=La cantidad no puede superar')).toBeVisible();

    // 6. Try valid amount
    await amountInput.fill('10');
    await amountInput.blur();
    await expect(page.locator('text=La cantidad no puede superar')).not.toBeVisible();

    // Note: We cannot easily test PayPal iframe interactions in E2E without complex setup
    // But we verified the form logic and navigation
});
