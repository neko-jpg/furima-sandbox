import { expect, test } from '@playwright/test';
import { assertNoPageErrors, advanceSandboxClock, installPageGuards, loadSandboxScenario, resetSandbox, setSandboxActor } from './_sandbox.mjs';

const listingFields = (suffix) => ({
  title: `E2E Sandbox listing ${suffix}`,
  description: 'Hackathon Sandboxのライフサイクル検証用商品です。',
  price: 3000,
  category: ['その他'],
  condition: '新品・未使用',
  images: ['/favicon.svg'],
  shippingFee: '送料込み（出品者負担）',
  shippingMethod: 'らくらくメルカリ便',
  origin: '東京都',
  shippingDays: '1〜2日で発送',
});

test('listing draft, listing lifecycle, purchase, delivery, reviews, and relist stay consistent', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'core-lifecycle');
  const listing = await page.evaluate(async (fields) => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const suffix = Date.now().toString(36);
    const draft = await api.createListingDraft(fields, { actorId: 'seller_01', idempotencyKey: `core-draft-${suffix}` });
    if (!draft.ok) return draft;
    const updated = await api.updateListingDraft(draft.data.draftId, { ...fields, title: `${fields.title} updated` }, { actorId: 'seller_01', idempotencyKey: `core-draft-update-${suffix}` });
    const drafts = api.getListingDrafts({ actorId: 'seller_01', idempotencyKey: `core-drafts-${suffix}` });
    const submitted = await api.submitListing(draft.data.draftId, { actorId: 'seller_01', idempotencyKey: `core-submit-${suffix}` });
    if (!updated.ok || !drafts.ok || !submitted.ok) return { ok: false, draft, updated, drafts, submitted };
    const itemId = submitted.data.itemId;
    const edited = await api.updateListing(itemId, { title: `${fields.title} edited` }, { actorId: 'seller_01', idempotencyKey: `core-edit-${suffix}` });
    const paused = await api.pauseListing(itemId, { actorId: 'seller_01', idempotencyKey: `core-pause-${suffix}` });
    const resumed = await api.resumeListing(itemId, { actorId: 'seller_01', idempotencyKey: `core-resume-${suffix}` });
    if (!edited.ok || !paused.ok || !resumed.ok) return { ok: false, edited, paused, resumed };
    return { ok: true, draft, drafts, submitted, edited, paused, resumed, suffix };
  }, listingFields('lifecycle'));
  expect(listing.ok, JSON.stringify(listing)).toBe(true);
  expect(listing.submitted?.ok).toBe(true);
  if (!listing.submitted?.ok) return;
  const itemId = listing.submitted.data.itemId;
  const suffix = listing.suffix;

  await setSandboxActor(page, 'buyer_01');
  const purchase = await page.evaluate(async ({ itemId: targetId, key }) => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const started = await api.startPurchase(targetId, { actorId: 'buyer_01', idempotencyKey: `core-start-${key}` });
    const confirmed = started.ok ? await api.confirmPurchase(started.data.purchaseIntentId, { actorId: 'buyer_01', idempotencyKey: `core-confirm-${key}` }) : started;
    return { started, confirmed };
  }, { itemId, key: suffix });

  await setSandboxActor(page, 'seller_01');
  const shipped = await page.evaluate(async ({ transactionId, key }) => {
    const api = window.__SHOP_API__;
    return api && transactionId ? await api.shipOrder(transactionId, { actorId: 'seller_01', idempotencyKey: `core-ship-${key}` }) : { ok: false, error: 'NO_TRANSACTION' };
  }, { transactionId: purchase.confirmed?.ok ? purchase.confirmed.data.transactionId : null, key: suffix });

  await setSandboxActor(page, 'buyer_01');
  const buyerReview = await page.evaluate(async ({ transactionId, key }) => {
    const api = window.__SHOP_API__;
    if (!api || !transactionId) return { ok: false, error: 'NO_TRANSACTION' };
    const delivered = await api.markDelivered(transactionId, { actorId: 'buyer_01', idempotencyKey: `core-delivered-${key}` });
    const review = delivered.ok ? await api.reviewOrder(transactionId, 5, '受取評価', { actorId: 'buyer_01', idempotencyKey: `core-buyer-review-${key}` }) : delivered;
    return { delivered, review };
  }, { transactionId: purchase.confirmed?.ok ? purchase.confirmed.data.transactionId : null, key: suffix });

  await setSandboxActor(page, 'seller_01');
  const sellerCompletion = await page.evaluate(async ({ itemId: targetId, transactionId, key }) => {
    const api = window.__SHOP_API__;
    if (!api || !transactionId) return { ok: false, error: 'NO_TRANSACTION' };
    const review = await api.reviewOrder(transactionId, 5, 'ありがとうございました', { actorId: 'seller_01', idempotencyKey: `core-seller-review-${key}` });
    const relisted = review.ok ? await api.relistItem(targetId, { actorId: 'seller_01', idempotencyKey: `core-relist-${key}` }) : review;
    return { review, relisted, snapshot: api.getSandboxSnapshot() };
  }, { itemId, transactionId: purchase.confirmed?.ok ? purchase.confirmed.data.transactionId : null, key: suffix });

  expect(purchase.confirmed?.ok).toBe(true);
  expect(shipped.ok).toBe(true);
  expect(buyerReview.delivered?.ok).toBe(true);
  expect(buyerReview.review?.ok).toBe(true);
  expect(sellerCompletion.review?.data?.status).toBe('COMPLETED');
  expect(sellerCompletion.relisted?.ok).toBe(true);
  expect(sellerCompletion.snapshot?.invariantViolations).toEqual([]);
  await assertNoPageErrors(errors);
});

test('auction, payment failure, wallet, profile, and actor isolation are deterministic', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'core-scenarios');
  await loadSandboxScenario(page, 'auction_outbid');
  await setSandboxActor(page, 'buyer_02');
  const auctionResult = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const auction = api.getItems().find((item) => item.isAuction);
    if (!auction) return { ok: false, error: 'NO_AUCTION' };
    const bid = await api.placeBid(auction.id, (auction.currentBid ?? auction.price) + 100, { actorId: 'buyer_02', idempotencyKey: 'core-auction-bid' });
    return { auctionId: auction.id, bid };
  });
  await advanceSandboxClock(page, 7 * 60 * 60 * 1000);
  const auctionAfterClock = await page.evaluate(async (auctionId) => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const advanced = api.getSandboxSnapshot();
    const closed = await api.closeAuction(auctionId);
    return { advanced, item: api.getItems().find((item) => item.id === auctionId), transactions: api.getTransactions(), closed };
  }, auctionResult.auctionId);

  await loadSandboxScenario(page, 'payment_timeout');
  await setSandboxActor(page, 'buyer_01');
  const paymentResult = await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const paymentItem = api.getItems().find((item) => !item.isAuction && !item.isSold && item.listingStatus === 'ACTIVE');
    const start = paymentItem ? await api.startPurchase(paymentItem.id, { actorId: 'buyer_01', idempotencyKey: 'core-payment-start' }) : { ok: false, error: 'NO_ITEM', stateVersion: api.getSandboxSnapshot().stateVersion };
    const failed = start.ok ? await api.confirmPurchase(start.data.purchaseIntentId, { actorId: 'buyer_01', idempotencyKey: 'core-payment-confirm' }) : start;
    const walletBefore = api.getWallet({ actorId: 'buyer_01', idempotencyKey: 'core-wallet-read' });
    const deposited = await api.depositWallet(1000, { actorId: 'buyer_01', idempotencyKey: 'core-wallet-deposit' });
    const withdrawn = await api.withdrawWallet(300, { actorId: 'buyer_01', idempotencyKey: 'core-wallet-withdraw' });
    const profile = await api.updateProfile({ displayName: 'E2E Buyer', bio: 'Sandbox test profile' }, { actorId: 'buyer_01', idempotencyKey: 'core-profile' });
    return { start, failed, walletBefore, deposited, withdrawn, profile, snapshot: api.getSandboxSnapshot() };
  });
  await setSandboxActor(page, 'guest');
  const guestWallet = await page.evaluate(() => {
    const api = window.__SHOP_API__;
    return api ? api.getWallet({ actorId: 'guest' }) : { ok: false, error: 'BRIDGE_NOT_READY' };
  });
  expect(auctionResult.bid?.ok).toBe(true);
  expect(auctionAfterClock.item?.isSold).toBe(true);
  expect(auctionAfterClock.transactions?.some((transaction) => transaction.itemId === auctionResult.auctionId && transaction.status === 'AWAITING_SHIPMENT')).toBe(true);
  expect(auctionAfterClock.closed?.ok).toBe(false);
  expect(auctionAfterClock.closed?.error).toBe('FORBIDDEN');
  expect(paymentResult.failed?.ok).toBe(false);
  expect(paymentResult.failed?.error).toBe('PAYMENT_FAILED');
  expect(paymentResult.deposited?.ok).toBe(true);
  expect(paymentResult.withdrawn?.ok).toBe(true);
  expect(paymentResult.profile?.ok).toBe(true);
  expect(guestWallet?.ok).toBe(false);
  expect(guestWallet?.error).toBe('AUTH_REQUIRED');
  expect(paymentResult.snapshot?.invariantViolations).toEqual([]);
  await assertNoPageErrors(errors);
});
