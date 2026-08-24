import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, resetSandbox, setSandboxActor } from './_sandbox.mjs';

test('Browser API preview is read-only and commit is idempotent', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'preview');
  await setSandboxActor(page, 'buyer_01');
  const result = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const readDurableUpdatedAt = (sandboxId) => new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      const request = window.indexedDB.open('furima-sandbox-state-v1');
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const database = request.result;
        try {
          const transaction = database.transaction('states', 'readonly');
          const get = transaction.objectStore('states').get(sandboxId);
          get.onsuccess = () => { resolve(get.result?.updatedAt ?? null); database.close(); };
          get.onerror = () => { resolve(null); database.close(); };
        } catch {
          database.close();
          resolve(null);
        }
      };
    });
    const target = api.getItems().find((item) => !item.isSold && item.listingStatus === 'ACTIVE');
    if (!target) return { ok: false, error: 'NO_AVAILABLE_ITEM' };
    const before = api.getSnapshot();
    const durableBefore = await readDurableUpdatedAt(before.sandboxId);
    const preview = await api.previewAction('purchase', { itemId: target.id }, { actorId: 'buyer_01', operationId: 'preview-purchase-1' });
    const afterPreview = api.getSnapshot();
    if (!preview.ok) return { ok: false, error: preview.error, preview, before, afterPreview };
    let durableAfterPreview = null;
    for (let attempt = 0; attempt < 20 && !durableAfterPreview; attempt += 1) {
      durableAfterPreview = await readDurableUpdatedAt(before.sandboxId);
      if (!durableAfterPreview) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const committed = await api.commitPreview(preview.data.previewId, { actorId: 'buyer_01', idempotencyKey: 'commit-purchase-1' });
    const repeated = await api.commitPreview(preview.data.previewId, { actorId: 'buyer_01', idempotencyKey: 'commit-purchase-1' });
    return { ok: true, targetId: target.id, beforeVersion: before.stateVersion, preview, afterPreviewVersion: afterPreview.stateVersion, durableBefore, durableAfterPreview, committed, repeated, after: api.getSnapshot() };
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.afterPreviewVersion).toBe(result.beforeVersion);
  expect(result.durableBefore).toBeTruthy();
  expect(result.durableAfterPreview).toBe(result.durableBefore);
  expect(result.preview?.meta?.mode).toBe('preview');
  expect(result.preview?.data?.sandboxId).toBe(result.preview?.meta?.sandboxId);
  expect(result.committed?.ok).toBe(true);
  expect(result.committed?.meta?.mode).toBe('commit');
  expect(result.repeated).toEqual(result.committed);
  expect(result.after?.stateVersion).toBeGreaterThan(result.beforeVersion);
  await assertNoPageErrors(errors);
});

test('stale preview is rejected after the sandbox version changes', async ({ page }) => {
  await page.goto('/');
  await resetSandbox(page, 'preview-stale');
  await setSandboxActor(page, 'buyer_01');
  const result = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const target = api.getItems().find((item) => !item.isSold && item.listingStatus === 'ACTIVE');
    if (!target) return { ok: false, error: 'NO_AVAILABLE_ITEM' };
    const preview = await api.previewAction('purchase', { itemId: target.id }, { actorId: 'buyer_01', operationId: 'preview-stale-1' });
    if (!preview.ok) return preview;
    await api.depositWallet(1, { actorId: 'buyer_01', operationId: 'version-bump-1' });
    return api.commitPreview(preview.data.previewId, { actorId: 'buyer_01', operationId: 'stale-commit-1' });
  });
  expect(result.ok).toBe(false);
  expect(result.error).toBe('STATE_CONFLICT');
});
