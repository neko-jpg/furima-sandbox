import { expect } from '@playwright/test';

export async function installPageGuards(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`http-${response.status()}: ${response.url()}`);
  });
  return errors;
}

export async function waitForBridge(page) {
  await page.waitForFunction(() => Boolean(window.__SHOP_API__ && window.__MERCARI_API__), undefined, { timeout: 30_000 });
  await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) throw new Error('BRIDGE_NOT_READY');
    const ready = await api.waitForReady();
    if (!ready.ok) throw new Error(ready.error);
  });
}

export async function resetSandbox(page, suffix = 'e2e') {
  await waitForBridge(page);
  const result = await page.evaluate((key) => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const reset = api.resetScenario({ actorId: 'platform', scope: 'sandbox-control', scenarioId: 'catalog_default', operationId: `e2e-reset-${key}` });
    const switched = api.switchActor('seller_01', { actorId: 'platform', scope: 'sandbox-control', operationId: `e2e-seller-${key}` });
    return { reset, switched };
  }, `${suffix}-${Date.now()}`);
  expect(result.reset?.ok, JSON.stringify(result)).toBe(true);
  expect(result.switched?.ok, JSON.stringify(result)).toBe(true);
}

export async function assertNoPageErrors(errors) {
  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
}
