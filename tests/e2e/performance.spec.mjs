import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, waitForBridge } from './_sandbox.mjs';

test('initial shell and catalog requests stay within sandbox performance budgets', async ({ page, request }) => {
  const errors = await installPageGuards(page);
  const started = Date.now();
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await waitForBridge(page);
  const elapsed = Date.now() - started;
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    return {
      domContentLoaded: entry?.domContentLoadedEventEnd ?? 0,
      load: entry?.loadEventEnd ?? 0,
      resourceCount: resources.length,
      resourceTransfer: resources.reduce((total, resource) => total + (resource.transferSize || 0), 0),
    };
  });
  expect(elapsed).toBeLessThan(15_000);
  expect(navigation.resourceCount).toBeLessThan(180);
  expect(navigation.resourceTransfer).toBeLessThan(12 * 1024 * 1024);

  const catalogStarted = Date.now();
  const catalog = await request.get('/api/catalog?limit=24&offset=0');
  const catalogElapsed = Date.now() - catalogStarted;
  expect(catalog.status()).toBe(200);
  expect((await catalog.json()).length).toBeLessThanOrEqual(24);
  expect(catalogElapsed).toBeLessThan(5_000);
  await assertNoPageErrors(errors);
});
