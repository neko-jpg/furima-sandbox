import assert from "node:assert/strict";
import test from "node:test";

import { SandboxCommandBus } from "../app/domain/commandBus.ts";
import { dispatchSandboxCommand } from "../app/domain/sandboxCommandDispatcher.ts";
import { SandboxEngine } from "../app/domain/sandboxEngine.ts";
import { configureSandboxRuntimeForTest } from "./helpers/sandbox-runtime-env.mjs";

const runtime = await import("../app/api/sandbox/runtime.ts");

const item = {
  id: "runtime-item",
  sku: "RUNTIME-SKU",
  title: "Runtime item",
  price: 1200,
  images: ["/images/products/knit.webp"],
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

test("fixture authorization requires the explicit flag and does not trust the hostname", async () => {
  const restore = configureSandboxRuntimeForTest();
  try {
    const externalRequest = new Request("https://localhost.example/api/sandbox/state");
    const externalDenied = await runtime.authorizationFailure(externalRequest);
    assert.equal(externalDenied?.status, 503);
    assert.equal((await externalDenied?.json())?.error, "AUTH_NOT_CONFIGURED");
    assert.equal(runtime.principalForRequest(externalRequest), undefined);

    const hostSpoofedRequest = new Request("http://localhost/api/sandbox/state");
    process.env.FURIMA_LOCAL_FIXTURE_MODE = "false";
    process.env.FURIMA_STORAGE_MODE = "d1";
    const denied = await runtime.authorizationFailure(hostSpoofedRequest);
    assert.equal(denied?.status, 503);
    assert.equal((await denied?.json())?.error, "AUTH_NOT_CONFIGURED");
    assert.equal(runtime.principalForRequest(hostSpoofedRequest), undefined);
  } finally {
    restore();
  }
});

test("fixture mode is rejected for deployed environments", async () => {
  const restore = configureSandboxRuntimeForTest();
  try {
    process.env.FURIMA_DEPLOYMENT_ENV = "production";
    const response = await runtime.authorizationFailure(new Request("http://127.0.0.1/api/sandbox/health"));
    assert.equal(response?.status, 503);
    assert.equal((await response?.json())?.error, "RUNTIME_MISCONFIGURED");
  } finally {
    restore();
  }
});

test("sandbox ID aliases must all be valid and agree across body and query", () => {
  assert.equal(runtime.sandboxIdFrom(new Request("https://example.test/api/sandbox/replay"), {}), "furima-demo");
  assert.equal(runtime.sandboxIdFrom(new Request("https://example.test/api/sandbox/replay?id=same"), { sandboxId: "same" }), "same");
  assert.equal(runtime.sandboxIdFrom(new Request("https://example.test/api/sandbox/replay"), { id: "invalid id", sandboxId: "valid" }), null);
  assert.equal(runtime.sandboxIdFrom(new Request("https://example.test/api/sandbox/replay"), { id: "same", sandboxId: "same" }), null);
  assert.equal(runtime.sandboxIdFrom(new Request("https://example.test/api/sandbox/replay"), { id: "left", sandboxId: "right" }), null);
  assert.equal(runtime.sandboxIdFrom(new Request("https://example.test/api/sandbox/replay?id=left"), { sandboxId: "right" }), null);
});

test("empty and whitespace bearer secrets are treated as unconfigured", async () => {
  const restore = configureSandboxRuntimeForTest({ fixtureMode: "false", storageMode: "d1" });
  try {
    process.env.FURIMA_D1_API_TOKEN = "   ";
    process.env.FURIMA_D1_CONTROL_TOKEN = "";
    const apiResponse = await runtime.authorizationFailure(new Request("https://api.example.test/api/sandbox/health"));
    const controlResponse = await runtime.authorizationFailure(new Request("https://api.example.test/api/sandbox/state"), { requireControl: true });
    assert.equal(apiResponse?.status, 503);
    assert.equal((await apiResponse?.json())?.error, "AUTH_NOT_CONFIGURED");
    assert.equal(controlResponse?.status, 503);
    assert.equal((await controlResponse?.json())?.error, "AUTH_NOT_CONFIGURED");
  } finally {
    restore();
  }
});

test("storage mode is explicit and missing D1 fails closed", async () => {
  const restore = configureSandboxRuntimeForTest();
  try {
    assert.equal(await runtime.isLocalFixtureEnabled(), true);
    assert.equal(await runtime.storageModeForRuntime(), "memory");
    assert.equal((await runtime.storeForRequest()).constructor.name, "MemorySandboxStateStore");

    process.env.FURIMA_LOCAL_FIXTURE_MODE = "false";
    await assert.rejects(runtime.storeForRequest(), /MEMORY_STORAGE_REQUIRES_LOCAL_FIXTURE_MODE/);

    process.env.FURIMA_STORAGE_MODE = "d1";
    await assert.rejects(runtime.storeForRequest(), /D1_UNAVAILABLE/);

    delete process.env.FURIMA_STORAGE_MODE;
    await assert.rejects(runtime.storageModeForRuntime(), /FURIMA_STORAGE_MODE/);
  } finally {
    restore();
  }
});
