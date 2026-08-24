import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { SandboxCommandBus } from "../app/domain/commandBus.ts";
import { D1SandboxStateStore, FakeD1SandboxStateStore, MemorySandboxStateStore } from "../app/domain/sandboxStore.ts";

const context = { sandboxId: "test-sandbox", actorId: "buyer_01", stateVersion: 4 };

const createSqliteD1 = () => {
  const database = new DatabaseSync(":memory:");
  for (let index = 0; index <= 4; index += 1) {
    const migrationUrl = new URL(`../drizzle/000${index}_${["late_thaddeus_ross", "volatile_kate_bishop", "unique_tana_nile", "nifty_madrox", "sandbox_scoped_command_keys"][index]}.sql`, import.meta.url);
    const statements = readFileSync(migrationUrl, "utf8").split(/--> statement-breakpoint/u).map((value) => value.trim()).filter(Boolean);
    statements.forEach((statement) => database.exec(statement));
  }
  class Statement {
    constructor(query) {
      this.statement = database.prepare(query);
      this.values = [];
      this.numberedParameters = [...query.matchAll(/\?(\d+)/gu)].map((match) => Number(match[1]));
    }
    bind(...values) { this.values = values; return this; }
    parameters() {
      if (!this.numberedParameters.length) return this.values;
      return [Object.fromEntries(this.numberedParameters.map((parameter) => [parameter, this.values[parameter - 1]]))];
    }
    async first() { return this.statement.get(...this.parameters()) ?? null; }
    async all() { return { results: this.statement.all(...this.parameters()) }; }
    async run() { const result = this.statement.run(...this.parameters()); return { success: true, meta: { changes: Number(result.changes) } }; }
  }
  const adapter = {
    beforeBatch: null,
    prepare(query) { return new Statement(query); },
    async batch(statements) {
      const hook = this.beforeBatch;
      this.beforeBatch = null;
      hook?.(database);
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { adapter, database, close: () => database.close() };
};

const d1State = (id, stateVersion, payload = `state-${stateVersion}`) => ({
  id, scenarioId: "catalog_default", seed: "seed", stateVersion,
  virtualNow: "2026-01-01T00:00:00.000Z", payload, updatedAt: `2026-01-01T00:00:0${stateVersion}.000Z`,
});

const d1Command = (sandboxId, key, stateVersionBefore, stateVersionAfter, payloadHash = `hash-${key}`) => ({
  operationId: key, sandboxId, actorId: "buyer_01", command: "wallet.deposit", mode: "commit",
  idempotencyKey: key, payloadHash, stateVersionBefore, stateVersionAfter, status: "SUCCEEDED",
  result: JSON.stringify({ ok: true, data: {}, stateVersion: stateVersionAfter }),
  createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z",
});

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

test("real SQLite D1 SQL commits replay command rows and state as one batch", async () => {
  const fixture = createSqliteD1();
  try {
    const store = new D1SandboxStateStore(fixture.adapter);
    await store.put(d1State("d1-replay", 0), 0);
    const commands = [
      d1Command("d1-replay", "replay-a", 0, 1),
      d1Command("d1-replay", "replay-b", 1, 2),
    ];
    const committed = await store.commitReplay(commands, d1State("d1-replay", 2), 0);
    assert.equal(committed.ok, true);
    assert.equal((await store.get("d1-replay")).stateVersion, 2);
    assert.deepEqual((await store.listCommands("d1-replay")).map((record) => record.idempotencyKey).sort(), ["replay-a", "replay-b"]);
  } finally {
    fixture.close();
  }
});

test("D1 CAS race leaves no command or preview row and preserves the winning state", async () => {
  const fixture = createSqliteD1();
  try {
    const store = new D1SandboxStateStore(fixture.adapter);
    await store.put(d1State("d1-cas-race", 0), 0);
    fixture.adapter.beforeBatch = (database) => database.prepare("UPDATE sandbox_states SET state_version = 1, payload = 'winner' WHERE id = 'd1-cas-race'").run();
    const preview = {
      previewId: "preview-race", sandboxId: "d1-cas-race", actorId: "buyer_01", command: "wallet.deposit",
      payload: "{\"amount\":1}", payloadHash: "preview-hash", baseStateVersion: 0, summary: "{}", status: "PENDING",
      createdAt: "2026-01-01T00:00:00.000Z", virtualExpiresAt: "2026-01-01T00:10:00.000Z", retentionExpiresAt: "2026-01-02T00:00:00.000Z",
    };
    const result = await store.putPreviewAndCommand(preview, d1Command("d1-cas-race", "preview-command", 0, 0), d1State("d1-cas-race", 0), 0);
    assert.equal(result.ok, false);
    assert.equal(result.error, "CONFLICT");
    assert.equal((await store.get("d1-cas-race")).payload, "winner");
    assert.equal((await store.listCommands("d1-cas-race")).length, 0);
    assert.equal((await store.listPreviews("d1-cas-race")).length, 0);
  } finally {
    fixture.close();
  }
});

test("D1 replay idempotency race cannot persist the non-conflicting half of a batch", async () => {
  const fixture = createSqliteD1();
  try {
    const store = new D1SandboxStateStore(fixture.adapter);
    await store.put(d1State("d1-replay-race", 0), 0);
    fixture.adapter.beforeBatch = (database) => {
      const winner = d1Command("d1-replay-race", "replay-race-b", 0, 1, "different-hash");
      database.prepare("INSERT INTO sandbox_command_records (operation_id, sandbox_id, actor_id, command, mode, idempotency_key, request_id, command_id, payload_hash, state_version_before, state_version_after, status, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)").run(winner.operationId, winner.sandboxId, winner.actorId, winner.command, winner.mode, winner.idempotencyKey, winner.payloadHash, winner.stateVersionBefore, winner.stateVersionAfter, winner.status, winner.result, winner.createdAt, winner.expiresAt);
      database.prepare("UPDATE sandbox_states SET state_version = 1, payload = 'winner' WHERE id = 'd1-replay-race'").run();
    };
    const commands = [
      d1Command("d1-replay-race", "replay-race-a", 0, 1),
      d1Command("d1-replay-race", "replay-race-b", 1, 2),
    ];
    const result = await store.commitReplay(commands, d1State("d1-replay-race", 2), 0);
    assert.equal(result.ok, false);
    assert.equal(result.error, "IDEMPOTENCY_CONFLICT");
    assert.equal(await store.getCommand("d1-replay-race", "replay-race-a"), null);
    assert.equal((await store.get("d1-replay-race")).payload, "winner");
  } finally {
    fixture.close();
  }
});

test("D1 idempotency race with a different payload cannot publish the losing state", async () => {
  const fixture = createSqliteD1();
  try {
    const store = new D1SandboxStateStore(fixture.adapter);
    await store.put(d1State("d1-idempotency-race", 0, "initial"), 0);
    fixture.adapter.beforeBatch = (database) => {
      const winner = { ...d1Command("d1-idempotency-race", "shared-key", 0, 0, "winner-hash"), status: "FAILED" };
      database.prepare("INSERT INTO sandbox_command_records (operation_id, sandbox_id, actor_id, command, mode, idempotency_key, request_id, command_id, payload_hash, state_version_before, state_version_after, status, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)").run(winner.operationId, winner.sandboxId, winner.actorId, winner.command, winner.mode, winner.idempotencyKey, winner.payloadHash, winner.stateVersionBefore, winner.stateVersionAfter, winner.status, winner.result, winner.createdAt, winner.expiresAt);
    };
    const loser = d1Command("d1-idempotency-race", "shared-key", 0, 1, "loser-hash");
    const result = await store.commitCommand(loser, d1State("d1-idempotency-race", 1, "loser"), 0);
    assert.equal(result.ok, false);
    assert.equal(result.error, "IDEMPOTENCY_CONFLICT");
    assert.equal((await store.get("d1-idempotency-race")).payload, "initial");
  } finally {
    fixture.close();
  }
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
