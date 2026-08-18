import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, resetSandbox } from './_sandbox.mjs';

test('desktop search and item detail support keyboard navigation and focus containment', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The mobile header uses a separate search trigger.');
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'accessibility');

  const search = page.getByRole('combobox', { name: '検索キーワードを入力' }).first();
  await expect(search).toBeVisible();
  await search.focus();
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();

  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
  await search.press('End');
  await expect(search).toHaveAttribute('aria-activedescendant', /search-suggestion-/u);
  await search.press('Home');
  await expect(search).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
  await search.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');

  const card = page.locator('[data-testid^="item-card-"]').first();
  await expect(card).toBeVisible();
  await card.click();
  const dialog = page.getByTestId('item-detail-view');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const focusable = dialog.locator('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]');
  const first = focusable.first();
  const last = focusable.last();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await last.focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await assertNoPageErrors(errors);
});
