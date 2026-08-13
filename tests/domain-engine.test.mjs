import assert from "node:assert/strict";
import test from "node:test";

import { SandboxEngine } from "../app/domain/sandboxEngine.ts";
import { filterCatalogItems, searchCatalogItems } from "../app/components/searchUtils.ts";

const seller = { name: "Sandbox Seller", avatar: "/images/favicon.svg", rating: 5, ratingsCount: 10, isVerified: true };
const controlOptions = { actorId: "platform", scope: "sandbox-control" };

const makeItem = (overrides = {}) => ({
  id: "item-basic",
  sku: "SKU-BASIC",
  title: "テスト商品",
  price: 1200,
  images: ["/images/products/knit.jpg"],
  isSold: false,
  description: "サンドボックス用の商品説明です。",
  category: ["ファッション", "トップス"],
  condition: "新品・未使用",
  shippingFee: "送料込み（出品者負担）",
  shippingMethod: "らくらくメルカリ便",
  origin: "東京都",
  shippingDays: "1〜2日で発送",
  likesCount: 0,
  seller,
  comments: [],
  brand: "Sandbox Brand",
  size: "M",
  color: "ブラック",
  sellerType: "shop",
  isAnonymousShipping: true,
  inventoryPolicy: "SINGLE",
  inventoryInitialQuantity: 1,
  inventoryQuantity: 1,
  reservedQuantity: 0,
  listingStatus: "ACTIVE",
  ...overrides,
});

const auction = makeItem({
  id: "item-auction",
  sku: "SKU-AUCTION",
  title: "オークション商品",
  isAuction: true,
  currentBid: 1000,
  bidsCount: 1,
});

const createEngine = (items = [makeItem(), auction]) => new SandboxEngine(items, { seed: "test-seed-v1" });

test("purchase cannot bypass reservation and confirmation", () => {
  const engine = createEngine();

  const directConfirm = engine.confirmPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(directConfirm.ok, false);
  assert.equal(directConfirm.error, "CONFIRMATION_REQUIRED");

  const directBuy = engine.purchaseItem("item-basic", { actorId: "buyer_01" });
  assert.equal(directBuy.ok, false);
  assert.equal(directBuy.error, "CONFIRMATION_REQUIRED");
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 1);
  assert.equal(engine.getSnapshot().transactions.length, 0);
});

test("happy path reserves, captures, ships, delivers, reviews, and settles", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(engine.getItem("item-basic")?.reservedQuantity, 1);
  assert.equal(engine.getItem("item-basic")?.listingStatus, "RESERVED");

  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(confirmed.data.status, "AWAITING_SHIPMENT");
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 0);
  assert.equal(engine.getItem("item-basic")?.isSold, true);
  assert.equal(engine.getSnapshot().payments[0]?.status, "CAPTURED");

  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  assert.equal(engine.shipOrder(confirmed.data.transactionId).ok, true);
  assert.equal(engine.switchActor("buyer_01", controlOptions).ok, true);
  assert.equal(engine.markDelivered(confirmed.data.transactionId).ok, true);
  assert.equal(engine.reviewOrder(confirmed.data.transactionId, 5, "受取評価").ok, true);
  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  const sellerReview = engine.reviewOrder(confirmed.data.transactionId, 5, "ありがとうございました");
  assert.equal(sellerReview.ok, true);
  if (!sellerReview.ok) return;
  assert.equal(sellerReview.data.status, "COMPLETED");

  const transaction = engine.getTransactions()[0];
  assert.equal(transaction?.status, "COMPLETED");
  const buyerWallet = engine.getSnapshot().wallets.find((wallet) => wallet.actorId === "buyer_01");
  const sellerWallet = engine.getSnapshot().wallets.find((wallet) => wallet.actorId === "seller_01");
  assert.equal(buyerWallet?.heldBalance, 0);
  assert.equal(buyerWallet?.availableBalance, 198800);
  assert.equal(sellerWallet?.availableBalance, 1080);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("reservation expiry releases inventory and wallet hold", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  const advanced = engine.advanceClock(15 * 60 * 1000, controlOptions);
  assert.equal(advanced.ok, true);
  if (!advanced.ok || !started.ok) return;
  assert.deepEqual(advanced.data.expiredPurchaseIntentIds, [started.data.purchaseIntentId]);
  assert.equal(engine.getItem("item-basic")?.reservedQuantity, 0);
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 1);
  assert.equal(engine.getSnapshot().purchaseIntents[0]?.status, "EXPIRED");
  const wallet = engine.getSnapshot().wallets.find((candidate) => candidate.actorId === "buyer_01");
  assert.equal(wallet?.availableBalance, 200000);
  assert.equal(wallet?.heldBalance, 0);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("payment failure releases the reservation without selling the item", () => {
  const engine = createEngine();
  assert.equal(engine.loadScenario("payment_timeout", controlOptions).ok, true);
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.error, "PAYMENT_FAILED");
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 1);
  assert.equal(engine.getItem("item-basic")?.reservedQuantity, 0);
  assert.equal(engine.getSnapshot().payments[0]?.status, "FAILED");
  const wallet = engine.getSnapshot().wallets.find((candidate) => candidate.actorId === "buyer_01");
  assert.equal(wallet?.availableBalance, 200000);
  assert.equal(wallet?.heldBalance, 0);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("canceling an unconfirmed reservation does not create phantom inventory", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const canceled = engine.cancelOrder(started.data.transactionId, "購入を取りやめます", { actorId: "buyer_01" });
  assert.equal(canceled.ok, true);
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 1);
  assert.equal(engine.getItem("item-basic")?.reservedQuantity, 0);
  assert.equal(engine.getSnapshot().transactions[0]?.status, "CANCELED");
  assert.deepEqual(engine.assertInvariants(), []);
});

test("domain pricing applies coupon and points before payment capture", () => {
  const engine = createEngine([makeItem({ isCouponEligible: true, price: 5000 })]);
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.purchaseItemWithPricing("item-basic", { couponDiscount: 500, pointsDiscount: 200 }, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(confirmed.data.total, 4300);
  assert.equal(engine.getSnapshot().transactions[0]?.couponDiscount, 500);
  assert.equal(engine.getSnapshot().transactions[0]?.pointsUsed, 200);
  assert.equal(engine.getSnapshot().wallets.find((wallet) => wallet.actorId === "buyer_01")?.points, 800);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("refund releases escrow and restores points", () => {
  const engine = createEngine([makeItem({ isCouponEligible: true, price: 5000 })]);
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(engine.purchaseItemWithPricing("item-basic", { couponDiscount: 500, pointsDiscount: 200 }, { actorId: "buyer_01" }).ok, true);
  const transactionId = engine.getSnapshot().transactions[0]?.id;
  assert.ok(transactionId);
  const refunded = engine.cancelOrder(transactionId, "購入者都合", { actorId: "buyer_01" });
  assert.equal(refunded.ok, true);
  assert.equal(engine.getSnapshot().transactions[0]?.status, "REFUNDED");
  const wallet = engine.getSnapshot().wallets.find((candidate) => candidate.actorId === "buyer_01");
  assert.equal(wallet?.heldBalance, 0);
  assert.equal(wallet?.availableBalance, 200000);
  assert.equal(wallet?.points, 1000);
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 1);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("shipping cancellation is a request and never refunds in-transit stock immediately", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  assert.equal(engine.shipOrder(confirmed.data.transactionId).ok, true);
  const requested = engine.cancelOrder(confirmed.data.transactionId, "配送中のため問い合わせ", { actorId: "buyer_01" });
  assert.equal(requested.ok, true);
  assert.equal(engine.getSnapshot().transactions[0]?.status, "CANCEL_REQUESTED");
  assert.equal(engine.getSnapshot().payments[0]?.status, "CAPTURED");
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 0);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("notification failure injection drops one notification without breaking the transaction", () => {
  const engine = createEngine();
  assert.equal(engine.switchActor("admin_01", controlOptions).ok, true);
  assert.equal(engine.injectFailure("notification", controlOptions).ok, true);
  assert.equal(engine.switchActor("buyer_01", controlOptions).ok, true);
  const before = engine.getNotifications().length;
  assert.equal(engine.startPurchase("item-basic").ok, true);
  assert.equal(engine.getNotifications().length, before);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("multi inventory allows two buyers and keeps quantity non-negative", () => {
  const engine = createEngine();
  assert.equal(engine.loadScenario("multi_inventory", controlOptions).ok, true);
  const itemId = engine.getItems().find((item) => !item.isAuction)?.id;
  assert.ok(itemId);
  const first = engine.startPurchase(itemId, { actorId: "buyer_01" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(engine.confirmPurchase(first.data.purchaseIntentId, { actorId: "buyer_01" }).ok, true);
  assert.equal(engine.switchActor("buyer_02", controlOptions).ok, true);
  const second = engine.startPurchase(itemId, { actorId: "buyer_02" });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(engine.confirmPurchase(second.data.purchaseIntentId, { actorId: "buyer_02" }).ok, true);
  assert.equal(engine.getItem(itemId)?.inventoryQuantity, 3);
  assert.equal(engine.getItem(itemId)?.reservedQuantity, 0);
  assert.equal(engine.getItem(itemId)?.isSold, false);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("listing policy is enforced in the domain even when called directly", () => {
  const engine = createEngine();
  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  const blocked = engine.listItem({
    title: "拳銃の出品",
    description: "危険物です",
    price: 1000,
    category: ["その他"],
    condition: "新品・未使用",
    shippingMethod: "らくらくメルカリ便",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "POLICY_BLOCKED");

  const approvedWithImage = engine.listItem({
    title: "安全なテスト商品",
    description: "状態のよい商品です",
    price: 1000,
    category: ["その他"],
    condition: "新品・未使用",
    shippingMethod: "らくらくメルカリ便",
    images: ["/images/products/knit.jpg"],
    sku: "SKU-SAFE",
  });
  assert.equal(approvedWithImage.ok, true);
  assert.equal(engine.getItems().some((item) => item.title === "安全なテスト商品"), true);
});

test("warning-level listings stay held and cannot be purchased", () => {
  const engine = createEngine();
  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  const held = engine.listItem({
    title: "画像なしのテスト商品",
    description: "審査待ちになります",
    price: 1000,
    category: ["その他"],
    condition: "新品・未使用",
    shippingMethod: "らくらくメルカリ便",
  });
  assert.equal(held.ok, true);
  if (!held.ok) return;
  assert.equal(held.data.listingStatus, "HELD");
  assert.equal(engine.switchActor("buyer_01", controlOptions).ok, true);
  const purchase = engine.startPurchase(held.data.id);
  assert.equal(purchase.ok, false);
  assert.equal(purchase.error, "POLICY_REVIEW_REQUIRED");
});

test("auction outbid notifications and expiry are deterministic", () => {
  const engine = createEngine();
  assert.equal(engine.loadScenario("auction_outbid", controlOptions).ok, true);
  const auctionItem = engine.getItems().find((item) => item.isAuction);
  assert.ok(auctionItem);
  const firstAmount = (auctionItem.currentBid ?? auctionItem.price) + 100;
  assert.equal(engine.placeBid(auctionItem.id, firstAmount, { actorId: "buyer_01" }).ok, true);
  assert.equal(engine.switchActor("buyer_02", controlOptions).ok, true);
  assert.equal(engine.placeBid(auctionItem.id, firstAmount + 100, { actorId: "buyer_02" }).ok, true);
  assert.equal(engine.getNotifications().some((notification) => notification.actorId === "buyer_01" && notification.title.includes("上回られ")), true);
  assert.equal(engine.advanceClock(6 * 60 * 60 * 1000, controlOptions).ok, true);
  const auctionTransaction = engine.getTransactions().find((transaction) => transaction.itemId === auctionItem.id);
  assert.equal(auctionTransaction?.buyerId, "buyer_02");
  assert.equal(auctionTransaction?.status, "AWAITING_SHIPMENT");
  assert.equal(engine.getItem(auctionItem.id)?.isSold, true);
  assert.equal(engine.getSnapshot().payments.some((payment) => payment.transactionId === auctionTransaction?.id && payment.status === "CAPTURED"), true);
  const afterEnd = engine.placeBid(auctionItem.id, firstAmount + 300, { actorId: "buyer_01" });
  assert.equal(afterEnd.ok, false);
  assert.equal(afterEnd.error, "AUCTION_ENDED");
});

test("idempotent state export/import preserves deterministic state", () => {
  const engine = createEngine();
   assert.equal(engine.startPurchase("item-basic", { actorId: "buyer_01" }).ok, true);
   const serialized = engine.exportState();
   const restored = createEngine();
   assert.equal(restored.importState(serialized).error, "FORBIDDEN");
   assert.equal(restored.importState(serialized, controlOptions).ok, true);
  assert.deepEqual(restored.getItems(), engine.getItems());
  assert.deepEqual(restored.getSnapshot(), engine.getSnapshot());
});

test("structured catalog filters do not fall back to unrelated products", () => {
  const items = [
    makeItem({ id: "black-m", brand: "Acme", size: "M", color: "ブラック", sellerType: "shop", isCouponEligible: true, isTimeSale: true, discountRate: 10 }),
    makeItem({ id: "white-l", brand: "Other", size: "L", color: "ホワイト", sellerType: "individual" }),
  ];
  const matches = filterCatalogItems(items, {
    category: "ファッション",
    size: "M",
    brand: "Acme",
    color: "ブラック",
    sellerType: "ショップ",
    discountOption: "クーポン対象",
    timeSale: "10%以上",
    salesStatus: "available",
  });
  assert.deepEqual(matches.map((item) => item.id), ["black-m"]);
  assert.deepEqual(filterCatalogItems(items, { brand: "存在しないブランド" }), []);
});
test("a new buyer can reuse stock after an expired reservation even when the clock was restored from storage", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  const state = JSON.parse(engine.exportState());
  state.now = "2026-01-01T00:20:00.000Z";
  const restored = createEngine();
   assert.equal(restored.importState(JSON.stringify(state), controlOptions).ok, true);
  assert.equal(restored.switchActor("buyer_02", controlOptions).ok, true);
  const next = restored.startPurchase("item-basic");
  assert.equal(next.ok, true);
  assert.equal(restored.getSnapshot().purchaseIntents[0]?.status, "EXPIRED");
  assert.equal(restored.getItem("item-basic")?.reservedQuantity, 1);
  assert.deepEqual(restored.assertInvariants(), []);
});

test("presentation updates cannot overwrite reserved inventory state", () => {
  const engine = createEngine();
  assert.equal(engine.startPurchase("item-basic", { actorId: "buyer_01" }).ok, true);
  engine.replaceItems([makeItem({ id: "item-basic", inventoryQuantity: 0, reservedQuantity: 0, isSold: true, listingStatus: "SOLD", isLiked: true, likesCount: 9 })]);
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 1);
  assert.equal(engine.getItem("item-basic")?.reservedQuantity, 1);
  assert.equal(engine.getItem("item-basic")?.isSold, false);
  assert.equal(engine.getItem("item-basic")?.isLiked, true);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("listing drafts are owned by their creating actor", () => {
  const engine = createEngine();
  const draft = engine.createListingDraft({
    title: "Draft item",
    description: "A valid sandbox listing",
    price: 1000,
    category: ["Category"],
    condition: "New",
    shippingMethod: "Sandbox shipping",
    images: ["/images/products/knit.jpg"],
  }, { actorId: "seller_01" });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
   assert.equal(engine.submitListing(draft.data.draftId, { actorId: "buyer_01" }).error, "FORBIDDEN");
   assert.equal(engine.submitListing(draft.data.draftId, { actorId: "seller_01" }).ok, true);
   assert.deepEqual(engine.assertInvariants(), []);
});

test("state import rejects malformed or inconsistent sandbox payloads", () => {
  const engine = createEngine();
   assert.equal(engine.importState(JSON.stringify({ version: "1", items: [], transactions: [], events: [] }), controlOptions).error, "INVALID_INPUT");
  const valid = JSON.parse(engine.exportState());
  valid.items[0].reservedQuantity = 1;
   assert.equal(engine.importState(JSON.stringify(valid), controlOptions).error, "INVALID_INPUT");
  assert.equal(engine.getStateVersion(), 0);
});

test("scenario loading honors optimistic concurrency", () => {
  const engine = createEngine();
  const stale = engine.loadScenario("multi_inventory", { ...controlOptions, expectedStateVersion: 99 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, "STATE_CONFLICT");
  assert.equal(engine.getSnapshot().scenarioId, "catalog_default");
});

test("public search and sold filters do not expose held listings as sold", () => {
  const held = makeItem({ id: "held", listingStatus: "HELD", title: "Held listing" });
  const sold = makeItem({ id: "sold", listingStatus: "SOLD", isSold: true, inventoryQuantity: 0, title: "Sold listing" });
  const active = makeItem({ id: "active", title: "Active listing" });
  assert.deepEqual(filterCatalogItems([held, sold, active], { salesStatus: "sold" }).map((item) => item.id), ["sold"]);
  assert.deepEqual(searchCatalogItems([held, active], "listing").map((item) => item.id), ["active"]);
});

test("auction bids are capped by the buyer wallet", () => {
  const expensiveAuction = { ...auction, price: 250000, currentBid: 250000 };
  const engine = createEngine([expensiveAuction]);
  const result = engine.placeBid("item-auction", 250100, { actorId: "buyer_01" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "PAYMENT_FAILED");
  assert.equal(engine.getSnapshot().bids.length, 0);
});

test("review comments are subject to the same contact policy as listings", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  assert.equal(engine.shipOrder(confirmed.data.transactionId).ok, true);
  assert.equal(engine.switchActor("buyer_01", controlOptions).ok, true);
  assert.equal(engine.markDelivered(confirmed.data.transactionId).ok, true);
  const blocked = engine.reviewOrder(confirmed.data.transactionId, 5, "連絡先 https://example.invalid");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "POLICY_BLOCKED");
});

test("listing policy rejects external and oversized image payloads", () => {
  const engine = createEngine();
  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  const external = engine.listItem({
    title: "External image listing",
    description: "Valid listing text",
    price: 1000,
    category: ["Category"],
    condition: "New",
    shippingMethod: "Sandbox shipping",
    images: ["https://example.invalid/image.jpg"],
  });
  assert.equal(external.ok, false);
  assert.equal(external.error, "POLICY_BLOCKED");
  const oversized = engine.evaluateListingPolicy({
    title: "Large image listing",
    description: "Valid listing text",
    price: 1000,
    category: ["Category"],
    condition: "New",
    shippingMethod: "Sandbox shipping",
    images: Array.from({ length: 21 }, () => "/images/products/knit.jpg"),
  });
  assert.equal(oversized.allowed, false);
  assert.equal(oversized.signals.some((signal) => signal.code === "IMAGE_INPUT_SIZE" && signal.status === "blocked"), true);
});

test("admin cancellation resolution either restores the transaction or refunds and restores stock", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(engine.switchActor("seller_01", controlOptions).ok, true);
  assert.equal(engine.shipOrder(confirmed.data.transactionId).ok, true);
  assert.equal(engine.switchActor("buyer_01", controlOptions).ok, true);
  assert.equal(engine.cancelOrder(confirmed.data.transactionId, "Return request", { actorId: "buyer_01" }).ok, true);
  assert.equal(engine.switchActor("admin_01", controlOptions).ok, true);
  const declined = engine.resolveCancellation(confirmed.data.transactionId, false);
  assert.equal(declined.ok, true);
  assert.equal(engine.getSnapshot().transactions[0]?.status, "SHIPPED");
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 0);
  assert.equal(engine.switchActor("buyer_01", controlOptions).ok, true);
  assert.equal(engine.cancelOrder(confirmed.data.transactionId, "Return request", { actorId: "buyer_01" }).ok, true);
  assert.equal(engine.switchActor("admin_01", controlOptions).ok, true);
  const approved = engine.resolveCancellation(confirmed.data.transactionId, true);
  assert.equal(approved.ok, true);
  assert.equal(engine.getSnapshot().transactions[0]?.status, "REFUNDED");
  assert.equal(engine.getSnapshot().payments[0]?.status, "REFUNDED");
  assert.equal(engine.getItem("item-basic")?.inventoryQuantity, 1);
  assert.equal(engine.assertInvariants().length, 0);
});

test("sandbox control commands reject ordinary actors", () => {
  const engine = createEngine();
  assert.equal(engine.switchActor("seller_01", { actorId: "buyer_01" }).error, "FORBIDDEN");
  assert.equal(engine.advanceClock(1, { actorId: "buyer_01" }).error, "FORBIDDEN");
  assert.equal(engine.loadScenario("multi_inventory", { actorId: "buyer_01" }).error, "FORBIDDEN");
});

test("a cancellation request cannot be converted into a second automatic refund", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(engine.shipOrder(confirmed.data.transactionId, { actorId: "seller_01" }).ok, true);
  assert.equal(engine.cancelOrder(confirmed.data.transactionId, "配送後の返送相談", { actorId: "buyer_01" }).ok, true);
  const repeated = engine.cancelOrder(confirmed.data.transactionId, "二重申請", { actorId: "buyer_01" });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error, "INVALID_TRANSITION");
  assert.equal(engine.getSnapshot().payments[0]?.status, "CAPTURED");
  assert.equal(engine.getSnapshot().transactions[0]?.status, "CANCEL_REQUESTED");
});

test("approved cancellation restores only its committed unit and preserves other reservations", () => {
  const engine = createEngine();
  assert.equal(engine.loadScenario("multi_inventory", controlOptions).ok, true);
  const itemId = engine.getItems().find((item) => !item.isAuction)?.id;
  assert.ok(itemId);
  const first = engine.startPurchase(itemId, { actorId: "buyer_01" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(engine.confirmPurchase(first.data.purchaseIntentId, { actorId: "buyer_01" }).ok, true);
  const second = engine.startPurchase(itemId, { actorId: "buyer_02" });
  assert.equal(second.ok, true);
  assert.equal(engine.shipOrder(first.data.transactionId, { actorId: "seller_01" }).ok, true);
  assert.equal(engine.cancelOrder(first.data.transactionId, "返送相談", { actorId: "buyer_01" }).ok, true);
  assert.equal(engine.resolveCancellation(first.data.transactionId, true, { actorId: "admin_01" }).ok, true);
  assert.equal(engine.getItem(itemId)?.inventoryQuantity, 5);
  assert.equal(engine.getItem(itemId)?.reservedQuantity, 1);
  assert.equal(second.ok && engine.getSnapshot().purchaseIntents.find((intent) => intent.id === second.data.purchaseIntentId)?.status, "ACTIVE");
  assert.deepEqual(engine.assertInvariants(), []);
});

test("auction bids reserve bid plus shipping exposure across auctions", () => {
  const first = { ...auction, id: "auction-one", sku: "AUCTION-ONE", shippingFee: "着払い" };
  const second = { ...auction, id: "auction-two", sku: "AUCTION-TWO", shippingFee: "着払い" };
  const engine = createEngine([first, second]);
  assert.equal(engine.placeBid(first.id, 190000, { actorId: "buyer_01" }).ok, true);
  const secondBid = engine.placeBid(second.id, 190000, { actorId: "buyer_01" });
  assert.equal(secondBid.ok, false);
  assert.equal(secondBid.error, "PAYMENT_FAILED");
  const wallet = engine.getSnapshot().wallets.find((candidate) => candidate.actorId === "buyer_01");
  assert.equal(wallet?.heldBalance, 190800);
  assert.equal(wallet?.availableBalance, 9200);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("state import rejects orphaned aggregate references", () => {
  const engine = createEngine();
  const candidate = JSON.parse(engine.exportState());
  candidate.transactions.push({
    id: "orphan-transaction",
    orderId: "ORPHAN-ORDER",
    itemId: "missing-item",
    buyerId: "buyer_01",
    sellerId: "seller_01",
    titleSnapshot: "orphan",
    priceSnapshot: 1000,
    shippingCost: 800,
    total: 1800,
    status: "PAYMENT_PENDING",
    paymentId: "missing-payment",
    shipmentId: "missing-shipment",
    reservationId: "missing-intent",
    createdAt: candidate.now,
    updatedAt: candidate.now,
  });
   const imported = engine.importState(JSON.stringify(candidate), controlOptions);
  assert.equal(imported.ok, false);
  assert.equal(imported.error, "INVALID_INPUT");
  assert.equal(engine.getSnapshot().transactions.length, 0);
});

test("held listings require operator moderation and buyers cannot publish as seller_01", () => {
  const engine = createEngine();
  const buyerListing = engine.listItem({ title: "Buyer listing", description: "商品説明", price: 1000, category: ["その他"], condition: "新品", shippingMethod: "配送" }, { actorId: "buyer_01" });
  assert.equal(buyerListing.error, "FORBIDDEN");
  const held = engine.listItem({ title: "審査待ち", description: "商品説明", price: 1000, category: ["その他"], condition: "新品", shippingMethod: "配送" }, { actorId: "seller_01" });
  assert.equal(held.ok, true);
  if (!held.ok) return;
  assert.equal(held.data.listingStatus, "HELD");
  const approved = engine.reviewListing(held.data.id, true, { actorId: "admin_01" });
  assert.equal(approved.ok, true);
  assert.equal(approved.ok && approved.data.listingStatus, "ACTIVE");
  assert.deepEqual(engine.assertInvariants(), []);
});

test("ordinary agent snapshots do not expose other wallets and transactions", () => {
  const engine = createEngine();
  const full = engine.getSnapshot();
  const scoped = engine.getScopedSnapshot("buyer_01");
  assert.equal(full.wallets.length > scoped.wallets.length, true);
  assert.equal(scoped.wallets.every((wallet) => wallet.actorId === "buyer_01"), true);
  assert.deepEqual(scoped.transactions, []);
});

test("ordinary inventory reads hide another actor's reservation references", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(engine.getInventoryMovements().some((movement) => movement.referenceId === started.data.purchaseIntentId), true);
  assert.equal(engine.getVisibleInventoryMovements("buyer_01").some((movement) => movement.referenceId === started.data.purchaseIntentId), true);
  assert.equal(engine.getVisibleInventoryMovements("buyer_02").some((movement) => movement.referenceId === started.data.purchaseIntentId), false);
});

test("returns, return receipt, messages, and support tickets follow actor permissions", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(engine.shipOrder(confirmed.data.transactionId, { actorId: "seller_01" }).ok, true);
  assert.equal(engine.markDelivered(confirmed.data.transactionId, { actorId: "buyer_01" }).ok, true);
  const message = engine.sendTransactionMessage(confirmed.data.transactionId, "返品について相談したいです", { actorId: "buyer_01" });
  assert.equal(message.ok, true);
  const returned = engine.requestReturn(confirmed.data.transactionId, "商品説明と状態が異なりました", { actorId: "buyer_01" });
  assert.equal(returned.ok, true);
  assert.equal(engine.resolveCancellation(confirmed.data.transactionId, true, { actorId: "admin_01" }).ok, true);
  const received = engine.confirmReturnReceived(confirmed.data.transactionId, { actorId: "seller_01" });
  assert.equal(received.ok, true);
  if (!received.ok) return;
  assert.equal(received.data.status, "REFUND_COMPLETED");
  const ticket = engine.createSupportTicket({ transactionId: confirmed.data.transactionId, category: "TRANSACTION", subject: "返品の確認", body: "返品処理の確認をお願いします", evidence: [] }, { actorId: "buyer_01" });
  assert.equal(ticket.ok, true);
  assert.deepEqual(engine.assertInvariants(), []);
});

test("listing lifecycle supports edit, pause, resume, and relist without changing ownership", () => {
  const engine = createEngine();
  const listing = engine.listItem({ title: "Lifecycle listing", description: "Valid description", price: 1200, category: ["その他"], condition: "新品", shippingMethod: "配送", images: ["/images/products/knit.jpg"], sku: "LIFECYCLE-1" }, { actorId: "seller_01" });
  assert.equal(listing.ok, true);
  if (!listing.ok) return;
  assert.equal(engine.updateListing(listing.data.id, { title: "Lifecycle listing edited" }, { actorId: "seller_01" }).ok, true);
  assert.equal(engine.pauseListing(listing.data.id, { actorId: "seller_01" }).ok, true);
  assert.equal(engine.resumeListing(listing.data.id, { actorId: "seller_01" }).ok, true);
  const started = engine.startPurchase(listing.data.id, { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" }).ok, true);
  const relisted = engine.relistItem(listing.data.id, { actorId: "seller_01" });
  assert.equal(relisted.ok, true);
  assert.equal(relisted.ok && relisted.data.sellerId, "seller_01");
  assert.deepEqual(engine.assertInvariants(), []);
});

test("seller ledger records gross sale and explicit fee while preserving net balance", () => {
  const engine = createEngine();
  const started = engine.startPurchase("item-basic", { actorId: "buyer_01" });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const confirmed = engine.confirmPurchase(started.data.purchaseIntentId, { actorId: "buyer_01" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(engine.shipOrder(confirmed.data.transactionId, { actorId: "seller_01" }).ok, true);
  assert.equal(engine.markDelivered(confirmed.data.transactionId, { actorId: "buyer_01" }).ok, true);
  assert.equal(engine.reviewOrder(confirmed.data.transactionId, 5, "受取評価", { actorId: "buyer_01" }).ok, true);
  assert.equal(engine.reviewOrder(confirmed.data.transactionId, 5, "ありがとうございました", { actorId: "seller_01" }).ok, true);
  const wallet = engine.getSnapshot().wallets.find((candidate) => candidate.actorId === "seller_01");
  assert.equal(wallet?.ledger.some((entry) => entry.type === "SALE" && entry.amount === 1200), true);
  assert.equal(wallet?.ledger.some((entry) => entry.type === "FEE" && entry.amount === 120), true);
  assert.equal(wallet?.availableBalance, 1080);
  assert.deepEqual(engine.assertInvariants(), []);
});
