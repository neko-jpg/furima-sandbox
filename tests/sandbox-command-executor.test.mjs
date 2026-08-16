import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_ITEMS } from '../app/data/initialData.ts';
import { SandboxCommandExecutor } from '../app/domain/commandExecutor.ts';
import { SandboxEngine } from '../app/domain/sandboxEngine.ts';
import { IndexedDbSandboxStateStore } from '../app/domain/sandboxIdbStore.ts';
import { FakeD1SandboxStateStore, MemorySandboxStateStore } from '../app/domain/sandboxStore.ts';

const stateRecord = (engine) => {
  const snapshot = engine.getSnapshot();
  return {
    id: engine.getSandboxId(),
    scenarioId: snapshot.scenarioId,
    seed: snapshot.seed,
    stateVersion: snapshot.stateVersion,
    virtualNow: snapshot.now,
    payload: engine.exportState(),
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
};

test('durable preview and commit survive a new executor and replay the same result', async () => {
  const store = new MemorySandboxStateStore();
  const firstEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'executor-test', seed: 'executor-seed' });
  await store.put(stateRecord(firstEngine));
  const first = new SandboxCommandExecutor({ engine: firstEngine, store, now: () => new Date('2026-01-01T00:00:00.000Z') });
  const preview = await first.preview('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'preview-wallet-1' }, (engine) => engine.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const commit = await first.commitPreview(preview.data.previewId, { actorId: 'buyer_01', idempotencyKey: 'commit-wallet-1' }, (engine, command, payload) => command === 'wallet.deposit' ? engine.depositWallet(payload.amount, { actorId: 'buyer_01' }) : { ok: false, error: 'INVALID_INPUT', stateVersion: engine.getStateVersion() });
  assert.equal(commit.ok, true);
  const wrongActor = await first.commitPreview(preview.data.previewId, { actorId: 'buyer_02', idempotencyKey: 'commit-wallet-1' }, () => ({ ok: false, error: 'INVALID_INPUT', stateVersion: firstEngine.getStateVersion() }));
  assert.equal(wrongActor.ok, false);
  if (!wrongActor.ok) assert.equal(wrongActor.error, 'FORBIDDEN');
  const secondEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'executor-test', seed: 'executor-seed' });
  const saved = await store.get('executor-test');
  assert.ok(saved);
  secondEngine.importState(saved.payload, { actorId: 'platform', scope: 'sandbox-control' });
  const second = new SandboxCommandExecutor({ engine: secondEngine, store, now: () => new Date('2026-01-01T00:00:01.000Z') });
  const repeated = await second.commitPreview(preview.data.previewId, { actorId: 'buyer_01', idempotencyKey: 'commit-wallet-1' }, () => ({ ok: false, error: 'INVALID_INPUT', stateVersion: secondEngine.getStateVersion() }));
  assert.deepEqual(repeated, commit);
  assert.equal((await store.listPreviews('executor-test'))[0].status, 'COMMITTED');
  assert.equal((await store.listCommands('executor-test')).length >= 2, true);
});

test('two executors using the same state version cannot lose an update', async () => {
  const store = new MemorySandboxStateStore();
  const firstEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'cas-test', seed: 'cas-seed' });
  await store.put(stateRecord(firstEngine));
  const secondEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'cas-test', seed: 'cas-seed' });
  const first = new SandboxCommandExecutor({ engine: firstEngine, store });
  const second = new SandboxCommandExecutor({ engine: secondEngine, store });
  const [left, right] = await Promise.all([
    first.execute('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'cas-left' }, (engine) => engine.depositWallet(1000, { actorId: 'buyer_01' })),
    second.execute('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'cas-right' }, (engine) => engine.depositWallet(1000, { actorId: 'buyer_01' })),
  ]);
  assert.equal([left.ok, right.ok].filter(Boolean).length, 1);
  assert.equal([left, right].filter((result) => !result.ok && result.error === 'STATE_CONFLICT').length, 1);
  assert.equal((await store.get('cas-test')).stateVersion, 1);
});

test('browser store falls back with a diagnostic when IndexedDB is unavailable', async () => {
  const store = new IndexedDbSandboxStateStore();
  const diagnostics = await store.ready();
  assert.equal(diagnostics.backend, 'memory');
  assert.equal(diagnostics.ready, true);
  const record = { id: 'memory-only', scenarioId: 'catalog_default', seed: 'seed', stateVersion: 0, virtualNow: '2026-01-01T00:00:00.000Z', payload: '{}', updatedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal((await store.put(record)).ok, true);
  assert.deepEqual(await store.get(record.id), record);
});

test('fault injection: a lost response after commit is replayed without a duplicate mutation', async () => {
  const store = new FakeD1SandboxStateStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'fault-test', seed: 'fault-seed' });
  await store.put(stateRecord(engine));
  store.injectFailure('state-after-response-before-client');
  const first = new SandboxCommandExecutor({ engine, store });
  const lostResponse = await first.execute('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'fault-deposit-1' }, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(lostResponse.ok, false);
  assert.equal(lostResponse.error, 'D1_UNAVAILABLE');
  const persisted = await store.get('fault-test');
  assert.ok(persisted);
  const restartedEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'fault-test', seed: 'fault-seed' });
  assert.equal(restartedEngine.importState(persisted.payload, { actorId: 'platform', scope: 'sandbox-control' }).ok, true);
  const restarted = new SandboxCommandExecutor({ engine: restartedEngine, store });
  const replayed = await restarted.execute('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'fault-deposit-1' }, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(replayed.ok, true);
  assert.equal(restartedEngine.getSnapshot().wallets.find((wallet) => wallet.actorId === 'buyer_01')?.availableBalance, 201000);
  assert.equal((await store.listCommands('fault-test')).filter((command) => command.idempotencyKey === 'fault-deposit-1').length, 1);
});
