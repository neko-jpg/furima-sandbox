import { expect, test } from '@playwright/test';
import { assertNoPageErrors, installPageGuards, resetSandbox } from './_sandbox.mjs';

const control = { actorId: 'platform', scope: 'sandbox-control' };

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
  const result = await page.evaluate((fields) => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const controlOptions = { actorId: 'platform', scope: 'sandbox-control' };
    const suffix = Date.now().toString(36);
    const draft = api.createListingDraft(fields, { actorId: 'seller_01', idempotencyKey: `core-draft-${suffix}` });
    if (!draft.ok) return draft;
    const updated = api.updateListingDraft(draft.data.draftId, { ...fields, title: `${fields.title} updated` }, { actorId: 'seller_01', idempotencyKey: `core-draft-update-${suffix}` });
    const drafts = api.getListingDrafts({ actorId: 'seller_01', idempotencyKey: `core-drafts-${suffix}` });
    const submitted = api.submitListing(draft.data.draftId, { actorId: 'seller_01', idempotencyKey: `core-submit-${suffix}` });
    if (!updated.ok || !drafts.ok || !submitted.ok) return { ok: false, draft, updated, drafts, submitted };
    const itemId = submitted.data.itemId;
    const edited = api.updateListing(itemId, { title: `${fields.title} edited` }, { actorId: 'seller_01', idempotencyKey: `core-edit-${suffix}` });
    const paused = api.pauseListing(itemId, { actorId: 'seller_01', idempotencyKey: `core-pause-${suffix}` });
    const resumed = api.resumeListing(itemId, { actorId: 'seller_01', idempotencyKey: `core-resume-${suffix}` });
    if (!edited.ok || !paused.ok || !resumed.ok) return { ok: false, edited, paused, resumed };

    const buyerSwitch = api.switchActor('buyer_01', controlOptions);
    const started = api.startPurchase(itemId, { actorId: 'buyer_01', idempotencyKey: `core-start-${suffix}` });
    const confirmed = started.ok ? api.confirmPurchase(started.data.purchaseIntentId, { actorId: 'buyer_01', idempotencyKey: `core-confirm-${suffix}` }) : started;
    const sellerSwitch = api.switchActor('seller_01', controlOptions);
    const shipped = confirmed.ok ? api.shipOrder(confirmed.data.transactionId, { actorId: 'seller_01', idempotencyKey: `core-ship-${suffix}` }) : confirmed;
    const buyerAgain = api.switchActor('buyer_01', controlOptions);
    const delivered = confirmed.ok ? api.markDelivered(confirmed.data.transactionId, { actorId: 'buyer_01', idempotencyKey: `core-delivered-${suffix}` }) : confirmed;
    const buyerReview = confirmed.ok ? api.reviewOrder(confirmed.data.transactionId, 5, '受取評価', { actorId: 'buyer_01', idempotencyKey: `core-buyer-review-${suffix}` }) : confirmed;
    const sellerAgain = api.switchActor('seller_01', controlOptions);
    const sellerReview = confirmed.ok ? api.reviewOrder(confirmed.data.transactionId, 5, 'ありがとうございました', { actorId: 'seller_01', idempotencyKey: `core-seller-review-${suffix}` }) : confirmed;
    const relisted = api.relistItem(itemId, { actorId: 'seller_01', idempotencyKey: `core-relist-${suffix}` });
    return {
      ok: true,
      draft,
      drafts,
      submitted,
      edited,
      paused,
      resumed,
      buyerSwitch,
      started,
      confirmed,
      sellerSwitch,
      shipped,
      buyerAgain,
      delivered,
      buyerReview,
      sellerAgain,
      sellerReview,
      relisted,
      snapshot: api.getSandboxSnapshot(),
    };
  }, listingFields('lifecycle'));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.confirmed?.ok).toBe(true);
  expect(result.shipped?.ok).toBe(true);
  expect(result.delivered?.ok).toBe(true);
  expect(result.buyerReview?.ok).toBe(true);
  expect(result.sellerReview?.data?.status).toBe('COMPLETED');
  expect(result.relisted?.ok).toBe(true);
  expect(result.snapshot?.invariantViolations).toEqual([]);
  await assertNoPageErrors(errors);
});

test('auction, payment failure, wallet, profile, and actor isolation are deterministic', async ({ page }) => {
  const errors = await installPageGuards(page);
  await page.goto('/');
  await resetSandbox(page, 'core-scenarios');
  const result = await page.evaluate((controlOptions) => {
    const api = window.__SHOP_API__;
    if (!api) return { ok: false, error: 'BRIDGE_NOT_READY' };
    const auctionScenario = api.loadScenario('auction_outbid', { ...controlOptions, idempotencyKey: 'core-auction-scenario' });
    const auction = api.getItems().find((item) => item.isAuction);
    if (!auction) return { ok: false, error: 'NO_AUCTION', auctionScenario };
    const buyerTwo = api.switchActor('buyer_02', controlOptions);
    const bid = api.placeBid(auction.id, (auction.currentBid ?? auction.price) + 100, { actorId: 'buyer_02', idempotencyKey: 'core-auction-bid' });
    const advanced = api.advanceClock(7 * 60 * 60 * 1000, { ...controlOptions, idempotencyKey: 'core-auction-clock' });
    const closed = api.closeAuction(auction.id, { ...controlOptions, idempotencyKey: 'core-auction-close' });
    const paymentScenario = api.loadScenario('payment_timeout', { ...controlOptions, idempotencyKey: 'core-payment-scenario' });
    const paymentItem = api.getItems().find((item) => !item.isAuction && !item.isSold && item.listingStatus === 'ACTIVE');
    const buyer = api.switchActor('buyer_01', controlOptions);
    const start = paymentItem ? api.startPurchase(paymentItem.id, { actorId: 'buyer_01', idempotencyKey: 'core-payment-start' }) : { ok: false, error: 'NO_ITEM', stateVersion: api.getSandboxSnapshot().stateVersion };
    const failed = start.ok ? api.confirmPurchase(start.data.purchaseIntentId, { actorId: 'buyer_01', idempotencyKey: 'core-payment-confirm' }) : start;
    const walletBefore = api.getWallet({ actorId: 'buyer_01', idempotencyKey: 'core-wallet-read' });
    const deposited = api.depositWallet(1000, { actorId: 'buyer_01', idempotencyKey: 'core-wallet-deposit' });
    const withdrawn = api.withdrawWallet(300, { actorId: 'buyer_01', idempotencyKey: 'core-wallet-withdraw' });
    const profile = api.updateProfile({ displayName: 'E2E Buyer', bio: 'Sandbox test profile' }, { actorId: 'buyer_01', idempotencyKey: 'core-profile' });
    const guest = api.switchActor('guest', controlOptions);
    const guestWallet = api.getWallet({ actorId: 'guest', idempotencyKey: 'core-guest-wallet' });
    const buyerIsolation = api.getTransactions('buyer_01');
    return { ok: true, auctionScenario, buyerTwo, bid, advanced, closed, paymentScenario, buyer, start, failed, walletBefore, deposited, withdrawn, profile, guest, guestWallet, buyerIsolation, snapshot: api.getSandboxSnapshot() };
  }, control);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.bid?.ok).toBe(true);
  expect(result.advanced?.ok).toBe(true);
  expect(result.advanced?.events?.some((event) => event.type === 'AUCTION_CLOSED')).toBe(true);
  expect(result.closed?.ok).toBe(false);
  expect(result.closed?.error).toBe('INVALID_TRANSITION');
  expect(result.failed?.ok).toBe(false);
  expect(result.failed?.error).toBe('PAYMENT_FAILED');
  expect(result.deposited?.ok).toBe(true);
  expect(result.withdrawn?.ok).toBe(true);
  expect(result.profile?.ok).toBe(true);
  expect(result.guestWallet?.ok).toBe(false);
  expect(result.guestWallet?.error).toBe('AUTH_REQUIRED');
  expect(result.snapshot?.invariantViolations).toEqual([]);
  await assertNoPageErrors(errors);
});
