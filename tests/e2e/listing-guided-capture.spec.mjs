import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards } from './_sandbox.mjs';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const upload = async (input, name) => {
  await input.setInputFiles({ name, mimeType: 'image/png', buffer: onePixelPng });
};

test('fixture guided capture reaches ready without persisting the measurement image', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');

  await page.getByRole('button', { name: '出品', exact: true }).last().click();
  await expect(page.getByTestId('listing-view')).toBeVisible();
  await page.getByTestId('open-listing-flow').click();
  await expect(page.getByTestId('listing-flow')).toBeVisible();

  await page.getByTestId('guided-capture-toggle').click();
  await expect(page.getByTestId('guided-capture-content')).toBeVisible();
  await page.getByTestId('guided-capture-start').click();
  await expect(page.getByTestId('guided-capture-connection')).toContainText('接続済み');

  const listingImages = page.locator('#listing-images');
  for (const [index, name] of ['front.png', 'back.png', 'tag.png'].entries()) {
    await upload(listingImages, name);
    await expect(page.locator(`[aria-label="追加した写真 ${index + 1}枚"]`)).toBeVisible();
  }

  await expect(page.getByTestId('guided-capture-measurement-editor')).toBeVisible();
  const measurementInput = page.getByTestId('guided-capture-measurement-editor').locator('input[type="file"]').last();
  await upload(measurementInput, 'measurement.png');
  await expect(page.getByTestId('guided-capture-approve-measurement')).toBeEnabled();
  await page.getByTestId('guided-capture-approve-measurement').click();
  await expect(page.getByTestId('guided-capture-review')).toBeVisible();
  await expect(page.getByTestId('guided-capture-ready')).toHaveCount(0);
  await page.getByTestId('guided-capture-approve-review').click();
  await expect(page.getByTestId('guided-capture-ready')).toBeVisible();
  await expect(page.locator('[aria-label="追加した写真 3枚"]')).toBeVisible();
  await expect(page.locator('[aria-label="追加した写真 4枚"]')).toHaveCount(0);

  await assertNoPageErrors(errors);
});
