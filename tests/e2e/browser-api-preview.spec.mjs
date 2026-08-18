import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, resetSandbox } from './_sandbox.mjs';

test('Browser API preview is read-only and commit is idempotent', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'preview');
  const result = await page.evaluate(() => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    api.switchActor('buyer_01', { actorId: 'platform', scope: 'sandbox-control', operationId: 'preview-buyer' });
    const target = api.getItems().find((item) => !item.isSold && item.listingStatus === 'ACTIVE');
    if (!target) return { ok: false, error: 'NO_AVAILABLE_ITEM' };
    const before = api.getSnapshot();
    const preview = api.previewAction('purchase', { itemId: target.id }, { actorId: 'buyer_01', operationId: 'preview-purchase-1' });
    const afterPreview = api.getSnapshot();
    if (!preview.ok) return { ok: false, error: preview.error, preview, before, afterPreview };
    const committed = api.commitPreview(preview.data.previewId, { actorId: 'buyer_01', idempotencyKey: 'commit-purchase-1' });
    const repeated = api.commitPreview(preview.data.previewId, { actorId: 'buyer_01', idempotencyKey: 'commit-purchase-1' });
    return { ok: true, targetId: target.id, beforeVersion: before.stateVersion, preview, afterPreviewVersion: afterPreview.stateVersion, committed, repeated, after: api.getSnapshot() };
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.afterPreviewVersion).toBe(result.beforeVersion);
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
  const result = await page.evaluate(() => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    api.switchActor('buyer_01', { actorId: 'platform', scope: 'sandbox-control', operationId: 'stale-buyer' });
    const target = api.getItems().find((item) => !item.isSold && item.listingStatus === 'ACTIVE');
    if (!target) return { ok: false, error: 'NO_AVAILABLE_ITEM' };
    const preview = api.previewAction('purchase', { itemId: target.id }, { actorId: 'buyer_01', operationId: 'preview-stale-1' });
    if (!preview.ok) return preview;
    api.depositWallet(1, { actorId: 'buyer_01', operationId: 'version-bump-1' });
    return api.commitPreview(preview.data.previewId, { actorId: 'buyer_01', operationId: 'stale-commit-1' });
  });
  expect(result.ok).toBe(false);
  expect(result.error).toBe('STATE_CONFLICT');
});
