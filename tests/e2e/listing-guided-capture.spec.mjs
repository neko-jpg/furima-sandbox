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

test('guided camera exposes accessible full-screen controls and closes with Escape', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');

  await page.getByRole('button', { name: '出品', exact: true }).last().click();
  await page.getByTestId('open-listing-flow').click();
  await page.getByTestId('guided-capture-toggle').click();
  const preparation = page.getByTestId('guided-capture-preparation');
  await expect(preparation).toBeVisible();
  await expect(preparation).toContainText('半袖');
  await expect(preparation).toContainText('クルーネック');
  await expect(preparation).toContainText('平置き');
  await expect(preparation).toContainText('5cmマーカー');
  await expect(preparation).toContainText('長袖');
  await expect(preparation).toContainText('パーカー');
  await expect(preparation).toContainText('襟付き');
  await expect(preparation).toContainText('ボトムス');
  await expect(preparation).toContainText('カテゴリ未選択でも固定ガイドで進められます');
  await page.getByTestId('guided-capture-start').click();
  await expect(page.getByTestId('guided-capture-connection')).toContainText('接続済み');

  await page.getByTestId('guided-capture-open-camera').click();
  await expect(page.getByTestId('guided-capture-camera')).toBeVisible();
  await expect(page.getByTestId('guided-capture-camera-progress')).toBeVisible();
  await expect(page.getByTestId('guided-capture-camera-back')).toBeVisible();
  await expect(page.getByTestId('guided-capture-camera-help-toggle')).toBeVisible();
  await expect(page.getByTestId('guided-capture-camera-light')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('guided-capture-camera-shutter')).toHaveAttribute('aria-label', '表面を撮影');

  await page.getByTestId('guided-capture-camera-help-toggle').click();
  await expect(page.getByTestId('guided-capture-camera-help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('guided-capture-camera')).toBeHidden();

  await assertNoPageErrors(errors);
});
