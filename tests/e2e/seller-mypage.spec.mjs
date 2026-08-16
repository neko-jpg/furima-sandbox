import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, resetSandbox } from './_sandbox.mjs';

test.describe('seller My Page regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetSandbox(page, 'seller');
  });

  test('sold summary opens only sold listings and detail returns to the same panel', async ({ page }) => {
    const errors = await installPageGuards(page);
    const expectedSoldCount = await page.evaluate(() => window.__SHOP_API__?.getItems().filter((item) => item.sellerId === 'seller_01' && item.listingStatus === 'SOLD').length ?? -1);
    expect(expectedSoldCount).toBeGreaterThan(0);

    const mobileMyPage = page.getByTestId('nav-mypage');
    if (await mobileMyPage.isVisible().catch(() => false)) {
      await mobileMyPage.click();
    } else {
      await page.getByTestId('account-menu-trigger').click();
      await page.getByRole('menuitem', { name: 'マイページ' }).click();
    }
    await expect(page.getByRole('heading', { name: 'マイページ' })).toBeVisible();
    await page.getByRole('button', { name: /売却済み/ }).first().click();

    const soldPanel = page.getByRole('dialog', { name: '売却済み商品の詳細' });
    await expect(soldPanel).toBeVisible();
    await expect(soldPanel.locator('article')).toHaveCount(expectedSoldCount);
    await expect(soldPanel).not.toContainText('出品中');
    await expect(soldPanel).not.toContainText('審査中');

    const firstRow = soldPanel.locator('article').first();
    const title = await firstRow.locator('button').nth(1).innerText();
    await firstRow.locator('button').nth(1).click();
    await expect(page.getByTestId('item-detail-view')).toBeVisible();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.getByTestId('back-button').click();
    await expect(soldPanel).toBeVisible();
    await expect(soldPanel.locator('article')).toHaveCount(expectedSoldCount);

    await page.goForward();
    await expect(page.getByTestId('item-detail-view')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: '売却済み商品の詳細' })).toBeVisible();
    await assertNoPageErrors(errors);
  });
});
