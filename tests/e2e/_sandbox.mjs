import { expect } from '@playwright/test';

export const TEST_API_HEADERS = { authorization: 'Bearer playwright-api-token' };
export const TEST_CONTROL_HEADERS = { authorization: 'Bearer playwright-control-token' };

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

export async function openInspector(page) {
  const inspector = page.getByRole('complementary', { name: 'Sandbox Inspector' });
  const collapsed = inspector.locator('button[aria-expanded="false"]');
  if (await collapsed.count()) {
    await expect(collapsed).toBeVisible({ timeout: 30_000 });
    await collapsed.click();
  }
  await expect(inspector.getByRole('button', { name: 'Load' })).toBeVisible();
  return inspector;
}

async function closeInspector(inspector) {
  const shrink = inspector.getByRole('button', { name: '縮小' });
  if (await shrink.count()) await shrink.click();
}

export async function setSandboxActor(page, actorId) {
  const inspector = await openInspector(page);
  const select = inspector.getByLabel('Actor');
  await select.selectOption(actorId);
  await expect(select).toHaveValue(actorId);
  await expect(inspector.getByRole('status')).toContainText('操作を適用しました');
  await closeInspector(inspector);
}

export async function loadSandboxScenario(page, scenarioId) {
  const inspector = await openInspector(page);
  const select = inspector.getByLabel('Scenarioを読み込む');
  await select.selectOption(scenarioId);
  await inspector.getByRole('button', { name: 'Load' }).click();
  await expect(inspector.getByRole('status')).toContainText('操作を適用しました');
  await closeInspector(inspector);
}

export async function advanceSandboxClock(page, milliseconds) {
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds % (15 * 60 * 1000) !== 0) throw new Error('CLOCK_STEP_MUST_BE_15_MINUTES');
  const inspector = await openInspector(page);
  for (let step = 0; step < milliseconds / (15 * 60 * 1000); step += 1) {
    const beforeVersion = await page.evaluate(() => window.__MERCARI_API__?.getSandboxSnapshot().stateVersion ?? 0);
    await inspector.getByRole('button', { name: '+15分' }).click();
    await expect.poll(() => page.evaluate(() => window.__MERCARI_API__?.getSandboxSnapshot().stateVersion ?? 0)).toBeGreaterThan(beforeVersion);
  }
  await closeInspector(inspector);
}

export async function resetSandbox(page) {
  await waitForBridge(page);
  await loadSandboxScenario(page, 'catalog_default');
  await setSandboxActor(page, 'seller_01');
}

export async function assertNoPageErrors(errors) {
  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
}
