import assert from "node:assert/strict";
import test from "node:test";

import { SandboxCommandBus } from "../app/domain/commandBus.ts";
import { D1SandboxStateStore, FakeD1SandboxStateStore, MemorySandboxStateStore } from "../app/domain/sandboxStore.ts";

const context = { sandboxId: "test-sandbox", actorId: "buyer_01", stateVersion: 4 };

test("Command Bus attaches sandbox, actor, operation, mode metadata", () => {
  const bus = new SandboxCommandBus({ getContext: () => context });
  const result = bus.execute("demo.read", { q: "x" }, { requestId: "req-1" }, () => ({ ok: true, data: { ok: true }, stateVersion: context.stateVersion }));
  assert.equal(result.ok, true);
  assert.equal(result.meta?.sandboxId, "test-sandbox");
  assert.equal(result.meta?.actorId, "buyer_01");
  assert.equal(result.meta?.operationId, "req-1");
  assert.equal(result.meta?.mode, "commit");
});

test("Command Bus makes a repeated idempotency key execute once", () => {
  const bus = new SandboxCommandBus({ getContext: () => context });
  let calls = 0;
  const first = bus.execute("wallet.deposit", { amount: 1000 }, { idempotencyKey: "deposit-1" }, () => {
    calls += 1;
    return { ok: true, data: { calls }, stateVersion: 5 };
  });
  const second = bus.execute("wallet.deposit", { amount: 1000 }, { idempotencyKey: "deposit-1" }, () => {
    calls += 1;
    return { ok: true, data: { calls }, stateVersion: 6 };
  });
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  const conflict = bus.execute("wallet.deposit", { amount: 2000 }, { idempotencyKey: "deposit-1" }, () => ({ ok: true, data: {}, stateVersion: 6 }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, "IDEMPOTENCY_CONFLICT");
});

test("memory and fake D1 stores share optimistic concurrency behavior", async () => {
  const stores = [new MemorySandboxStateStore(), new FakeD1SandboxStateStore()];
  for (const store of stores) {
    const first = await store.put({ id: "s1", scenarioId: "catalog_default", seed: "seed", stateVersion: 0, virtualNow: "2026-01-01T00:00:00.000Z", payload: "{}", updatedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(first.ok, true);
    const conflict = await store.put({ id: "s1", scenarioId: "catalog_default", seed: "seed", stateVersion: 1, virtualNow: "2026-01-01T00:00:00.000Z", payload: "{}", updatedAt: "2026-01-01T00:00:01.000Z" }, 9);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error, "CONFLICT");
    const forced = await store.put({ id: "s1", scenarioId: "catalog_default", seed: "seed-2", stateVersion: 0, virtualNow: "2026-01-01T00:00:00.000Z", payload: "{}", updatedAt: "2026-01-01T00:00:02.000Z" }, undefined, true);
    assert.equal(forced.ok, true);
  }
  const fake = stores[1];
  fake.unavailable = true;
  await assert.rejects(() => fake.get("s1"), /D1_UNAVAILABLE/);
});

test("the D1 adapter uses the same store contract", async () => {
  const records = new Map();
  const database = {
    prepare(query) {
      let values = [];
      return {
        bind(...bound) { values = bound; return this; },
        async first() {
          if (!query.startsWith("SELECT")) return null;
          return records.get(values[0]) ?? null;
        },
        async run() {
          records.set(values[0], {
            id: values[0], scenarioId: values[1], seed: values[2], stateVersion: values[3],
            virtualNow: values[4], payload: values[5], updatedAt: values[6],
          });
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
  const store = new D1SandboxStateStore(database);
  const record = { id: "d1", scenarioId: "catalog_default", seed: "seed", stateVersion: 0, virtualNow: "2026-01-01T00:00:00.000Z", payload: "{}", updatedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal((await store.put(record)).ok, true);
  assert.deepEqual(await store.get("d1"), record);
  assert.equal((await store.put({ ...record, stateVersion: 1 }, 2)).error, "CONFLICT");
});

test("Command Bus rejects sandbox, actor, and state-version mismatches before mutation", () => {
  const bus = new SandboxCommandBus({ getContext: () => context });
  let calls = 0;
  const operation = () => {
    calls += 1;
    return { ok: true, data: {}, stateVersion: 5 };
  };
  assert.equal(bus.execute("demo.write", {}, { sandboxId: "other-sandbox" }, operation).error, "INVALID_INPUT");
  assert.equal(bus.execute("demo.write", {}, { actorId: "seller_01" }, operation).error, "FORBIDDEN");
  assert.equal(bus.execute("demo.write", {}, { expectedStateVersion: 99 }, operation).error, "STATE_CONFLICT");
  assert.equal(calls, 0);
});

test("large image payloads are rejected before execution and never reach the operation", () => {
  const bus = new SandboxCommandBus({ getContext: () => context });
  const image = `data:image/jpeg;base64,${"A".repeat(200_000)}`;
  let received;
  const result = bus.execute("listing.create", { title: "image", images: [image] }, { idempotencyKey: "image-1" }, () => {
    received = image;
    return { ok: true, data: { accepted: true }, stateVersion: 5 };
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "INVALID_INPUT");
  assert.equal(received, undefined);
  assert.match(JSON.stringify(bus.getTrace()[0]?.payload), /\[image:/);
});
