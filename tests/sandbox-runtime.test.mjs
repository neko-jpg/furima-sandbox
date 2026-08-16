import assert from "node:assert/strict";
import test from "node:test";

import { SandboxCommandBus } from "../app/domain/commandBus.ts";
import { dispatchSandboxCommand } from "../app/domain/sandboxCommandDispatcher.ts";
import { SandboxEngine } from "../app/domain/sandboxEngine.ts";

const item = {
  id: "runtime-item",
  sku: "RUNTIME-SKU",
  title: "Runtime item",
  price: 1200,
  images: ["/images/products/knit.jpg"],
  isSold: false,
  description: "runtime test",
  category: ["その他"],
  condition: "新品・未使用",
  shippingFee: "送料込み（出品者負担）",
  shippingMethod: "らくらくメルカリ便",
  origin: "東京都",
  shippingDays: "1〜2日で発送",
  likesCount: 0,
  seller: { name: "Sandbox Seller", avatar: "/favicon.svg", rating: 5, ratingsCount: 1, isVerified: true },
  comments: [],
};

function replay() {
  const engine = new SandboxEngine([item], { sandboxId: "replay-test", seed: "same-seed" });
  const bus = new SandboxCommandBus({ getContext: () => ({ sandboxId: engine.getSandboxId(), actorId: engine.getCurrentActor().id, stateVersion: engine.getStateVersion() }) });
  const start = bus.execute("startPurchase", { itemId: "runtime-item" }, { actorId: "buyer_01", idempotencyKey: "purchase-start-1", sandboxId: "replay-test" }, () => dispatchSandboxCommand(engine, "startPurchase", { itemId: "runtime-item" }, { actorId: "buyer_01" }));
  assert.equal(start.ok, true);
  if (!start.ok) return engine;
  const repeated = bus.execute("startPurchase", { itemId: "runtime-item" }, { actorId: "buyer_01", idempotencyKey: "purchase-start-1", sandboxId: "replay-test" }, () => dispatchSandboxCommand(engine, "startPurchase", { itemId: "runtime-item" }, { actorId: "buyer_01" }));
  assert.deepEqual(repeated, start);
  const intentId = start.data.purchaseIntentId;
  const confirm = bus.execute("confirmPurchase", { purchaseIntentId: intentId }, { actorId: "buyer_01", idempotencyKey: "purchase-confirm-1", sandboxId: "replay-test" }, () => dispatchSandboxCommand(engine, "confirmPurchase", { purchaseIntentId: intentId }, { actorId: "buyer_01" }));
  assert.equal(confirm.ok, true);
  return engine;
}

test("the same Sandbox seed and command sequence produces the same state", () => {
  const first = replay();
  const second = replay();
  assert.equal(first.getSandboxId(), "replay-test");
  assert.deepEqual(JSON.parse(first.exportState()), JSON.parse(second.exportState()));
  assert.deepEqual(first.assertInvariants(), []);
});
