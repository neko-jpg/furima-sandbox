import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, resetSandbox, setSandboxActor, TEST_API_HEADERS, TEST_CONTROL_HEADERS, waitForBridge } from './_sandbox.mjs';

test('IndexedDB hydration preserves preview idempotency across a page reload', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'reload');
  await setSandboxActor(page, 'buyer_01');
  const prepared = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const preview = await api.previewAction('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'reload-preview-wallet-1' });
    return { preview };
  });
  expect(prepared.preview.ok).toBe(true);
  if (!prepared.preview.ok) return;
  const previewId = prepared.preview.data.previewId;
  await page.waitForTimeout(150);
  await page.reload();
  await waitForBridge(page);
  const replayed = await page.evaluate(async (id) => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const samePreview = await api.previewAction('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'reload-preview-wallet-1' });
    const committed = await api.commitPreview(id, { actorId: 'buyer_01', idempotencyKey: 'reload-commit-wallet-1' });
    const repeated = await api.commitPreview(id, { actorId: 'buyer_01', idempotencyKey: 'reload-commit-wallet-1' });
    return { samePreview, committed, repeated, wallet: api.getWallet({ actorId: 'buyer_01' }) };
  }, previewId);
  expect(replayed.samePreview.ok).toBe(true);
  expect(replayed.samePreview.data.previewId).toBe(previewId);
  expect(replayed.committed.ok).toBe(true);
  expect(replayed.repeated).toEqual(replayed.committed);
  expect(replayed.wallet.ok).toBe(true);
  await assertNoPageErrors(errors);
});

test('HTTP preview, commit, conflict, and health expose the same metadata contract', async ({ request }) => {
  const sandboxId = `hardening-${Date.now()}`;
  const reset = await request.post('/api/sandbox/reset', { headers: TEST_CONTROL_HEADERS, data: { sandboxId, scenarioId: 'catalog_default', seed: 'hardening-seed', idempotencyKey: 'http-hardening-reset-1' } });
  expect(reset.status()).toBe(200);
  const preview = await request.post('/api/sandbox/preview', { headers: TEST_API_HEADERS, data: { sandboxId, command: 'wallet.deposit', payload: { amount: 1000 }, idempotencyKey: 'http-hardening-preview-1' } });
  expect(preview.status()).toBe(200);
  const previewBody = await preview.json();
  expect(previewBody.meta.mode).toBe('preview');
  const commitData = { sandboxId, previewId: previewBody.data.previewId, idempotencyKey: 'http-hardening-commit-1' };
  const commit = await request.post('/api/sandbox/commit', { headers: TEST_API_HEADERS, data: commitData });
  expect(commit.status()).toBe(200);
  const commitBody = await commit.json();
  expect(commitBody.meta.mode).toBe('commit');
  const repeated = await request.post('/api/sandbox/commit', { headers: TEST_API_HEADERS, data: commitData });
  expect(repeated.status()).toBe(200);
  expect(await repeated.json()).toEqual(commitBody);
  const conflict = await request.post('/api/sandbox/commit', { headers: TEST_API_HEADERS, data: { ...commitData, idempotencyKey: 'http-hardening-other-key' } });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).error).toBe('PREVIEW_EXPIRED');
  const spoofedControlAction = await request.post('/api/sandbox/preview', { headers: TEST_API_HEADERS, data: {
    sandboxId,
    actorId: 'seller_01',
    command: 'listing.create',
    payload: {
      title: 'spoofed seller listing',
      description: 'authorization boundary check',
      price: 1000,
      category: ['その他'],
      condition: '新品・未使用',
      images: ['/favicon.svg'],
      shippingFee: '送料込み（出品者負担）',
      shippingMethod: 'らくらくメルカリ便',
      origin: '東京都',
      shippingDays: '1〜2日で発送',
    },
    idempotencyKey: 'http-hardening-actor-spoof',
  } });
  expect(spoofedControlAction.status()).toBe(400);
  expect((await spoofedControlAction.json()).error).toBe('INVALID_INPUT');
  const health = await request.get(`/api/sandbox/health?sandboxId=${sandboxId}`, { headers: TEST_API_HEADERS });
  expect(health.status()).toBe(200);
  const healthBody = await health.json();
  expect(healthBody.capabilities).toMatchObject({ preview: true, commit: true, idempotency: true, cas: true, externalPayment: false });
});

test('agent page exposes no control-plane capability and rejects actor spoofing', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'browser-boundary');
  const result = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const before = api.getSandboxSnapshot();
    const forbiddenNames = ['switchActor', 'loadScenario', 'resetScenario', 'advanceClock', 'injectFailure', 'importState', 'exportState'];
    const exposed = forbiddenNames.filter((name) => typeof api[name] !== 'undefined');
    const advertised = api.getCapabilities().commands.filter((command) => forbiddenNames.includes(command));
    const firstItemId = api.getItems()[0]?.id;
    const opened = firstItemId ? await api.openItem(firstItemId, { actorId: 'seller_01', idempotencyKey: 'browser-open-cas-1' }) : undefined;
    const versionAfterOpen = api.getSandboxSnapshot().stateVersion;
    const spoofedRead = api.getWallet({ actorId: 'buyer_01' });
    const spoofedWrite = await api.depositWallet(1, { actorId: 'buyer_01', idempotencyKey: 'browser-actor-spoof' });
    const after = api.getSandboxSnapshot();
    return {
      ok: true,
      exposed,
      advertised,
      inspectorInDom: document.body.textContent?.includes('Sandbox Inspector') ?? false,
      controlTokenInGlobal: Object.values(window).some((value) => value === 'playwright-control-token'),
      opened,
      versionAfterOpen,
      spoofedRead,
      spoofedWrite,
      beforeVersion: before.stateVersion,
      afterVersion: after.stateVersion,
    };
  });
  expect(result.ok).toBe(true);
  expect(result.exposed).toEqual([]);
  expect(result.advertised).toEqual([]);
  expect(result.inspectorInDom).toBe(false);
  expect(result.controlTokenInGlobal).toBe(false);
  expect(result.opened).toMatchObject({ ok: true });
  expect(result.opened.stateVersion).toBe(result.versionAfterOpen);
  expect(result.versionAfterOpen).toBe(result.beforeVersion + 1);
  expect(result.spoofedRead.error).toBe('FORBIDDEN');
  expect(result.spoofedWrite.error).toBe('FORBIDDEN');
  expect(result.afterVersion).toBe(result.versionAfterOpen);
  await assertNoPageErrors(errors);
});

test('follow list is backed by Sandbox state and survives actor changes', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'follow');
  await setSandboxActor(page, 'buyer_01');
  const result = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false };
    const followed = await api.followUser('seller_01', { actorId: 'buyer_01', idempotencyKey: `follow-create-${Date.now()}` });
    const page = api.navigateTab('mypage', { actorId: 'buyer_01', idempotencyKey: `follow-mypage-${Date.now()}` });
    return { followed, page };
  });
  expect(result.followed.ok).toBe(true);
  expect(result.page.ok).toBe(true);
  await expect(page.getByTestId('mypage-view')).toBeVisible();
  await expect(page.getByRole('button', { name: /フォローリスト/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /支払い方法/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /アカウント設定/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /フォローリスト/ })).toHaveAttribute('data-feature-status', 'implemented');
  await page.getByRole('button', { name: /フォローリスト/ }).click();
  await expect(page.getByTestId('follow-list-panel')).toContainText('Sandbox Seller');
  await page.getByRole('dialog', { name: 'フォローリストの詳細' }).getByRole('button', { name: '詳細を閉じる' }).click();
  await setSandboxActor(page, 'seller_01');
  const sellerList = await page.evaluate(() => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false };
    const list = api.getFollowList('following', { actorId: 'seller_01' });
    return { list };
  });
  expect(sellerList.list.ok).toBe(true);
  if (sellerList.list.ok) expect(sellerList.list.data.users).toHaveLength(0);
  await setSandboxActor(page, 'buyer_01');
  const unfollowed = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    return api ? await api.unfollowUser('seller_01', { actorId: 'buyer_01', idempotencyKey: `follow-remove-${Date.now()}` }) : { ok: false };
  });
  expect(unfollowed.ok).toBe(true);
  await assertNoPageErrors(errors);
});
