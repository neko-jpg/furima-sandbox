import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_ITEMS } from '../app/data/initialData.ts';
import { SandboxCommandExecutor } from '../app/domain/commandExecutor.ts';
import { SandboxEngine, createTrustedPrincipal } from '../app/domain/sandboxEngine.ts';
import { IndexedDbSandboxStateStore } from '../app/domain/sandboxIdbStore.ts';
import { FakeD1SandboxStateStore, MemorySandboxStateStore } from '../app/domain/sandboxStore.ts';

const optionsFor = (actorId, options = {}) => ({
  principal: createTrustedPrincipal({
    subjectId: `executor-test:${actorId}:${options.idempotencyKey ?? options.operationId ?? 'request'}`,
    actorId,
    roles: [actorId.startsWith('seller') ? 'seller' : actorId === 'platform' ? 'platform' : 'buyer'],
    scopes: actorId === 'platform' ? ['sandbox-control', 'operator'] : ['user'],
  }),
  actorId,
  ...options,
});

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
  const preview = await first.preview('wallet.deposit', { amount: 1000 }, optionsFor('buyer_01', { idempotencyKey: 'preview-wallet-1' }), (engine) => engine.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const commit = await first.commitPreview(preview.data.previewId, optionsFor('buyer_01', { idempotencyKey: 'commit-wallet-1' }), (engine, command, payload) => command === 'wallet.deposit' ? engine.depositWallet(payload.amount, { actorId: 'buyer_01' }) : { ok: false, error: 'INVALID_INPUT', stateVersion: engine.getStateVersion() });
  assert.equal(commit.ok, true);
  const wrongActor = await first.commitPreview(preview.data.previewId, optionsFor('buyer_02', { idempotencyKey: 'commit-wallet-1' }), () => ({ ok: false, error: 'INVALID_INPUT', stateVersion: firstEngine.getStateVersion() }));
  assert.equal(wrongActor.ok, false);
  if (!wrongActor.ok) assert.equal(wrongActor.error, 'FORBIDDEN');
  const secondEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'executor-test', seed: 'executor-seed' });
  const saved = await store.get('executor-test');
  assert.ok(saved);
  secondEngine.importState(saved.payload, { principal: createTrustedPrincipal({ subjectId: 'executor-test-1', actorId: 'platform', roles: ['platform'], scopes: ['sandbox-control', 'operator'] }) });
  const second = new SandboxCommandExecutor({ engine: secondEngine, store, now: () => new Date('2026-01-01T00:00:01.000Z') });
  const repeated = await second.commitPreview(preview.data.previewId, optionsFor('buyer_01', { idempotencyKey: 'commit-wallet-1' }), () => ({ ok: false, error: 'INVALID_INPUT', stateVersion: secondEngine.getStateVersion() }));
  assert.deepEqual(repeated, commit);
  assert.equal((await store.listPreviews('executor-test'))[0].status, 'COMMITTED');
  assert.equal((await store.listCommands('executor-test')).length >= 2, true);
});

test('preview persistence keeps the existing durable timestamp', async () => {
  const store = new MemorySandboxStateStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'preview-timestamp-test', seed: 'preview-timestamp-seed' });
  const persisted = stateRecord(engine);
  await store.put(persisted);
  const preview = {
    previewId: 'preview-timestamp-1', sandboxId: persisted.id, actorId: 'buyer_01', command: 'wallet.deposit',
    payload: JSON.stringify({ amount: 1 }), payloadHash: 'preview-hash-1', baseStateVersion: persisted.stateVersion,
    summary: '{}', status: 'PENDING', createdAt: '2026-01-01T00:00:01.000Z', virtualExpiresAt: '2026-01-01T00:05:00.000Z',
    retentionExpiresAt: '2026-01-02T00:00:00.000Z',
  };
  const command = {
    operationId: 'preview-timestamp-command-1', sandboxId: persisted.id, actorId: 'buyer_01', command: 'wallet.deposit', mode: 'preview',
    idempotencyKey: 'preview-timestamp-command-1', payloadHash: 'preview-hash-1', stateVersionBefore: persisted.stateVersion,
    stateVersionAfter: persisted.stateVersion, status: 'SUCCEEDED', result: '{}', createdAt: '2026-01-01T00:00:01.000Z', expiresAt: '2026-01-02T00:00:00.000Z',
  };
  const result = await store.putPreviewAndCommand(preview, command, { ...persisted, updatedAt: '2026-01-01T00:00:02.000Z' }, persisted.stateVersion);
  assert.equal(result.ok, true);
  assert.equal((await store.get(persisted.id))?.updatedAt, persisted.updatedAt);
});

test('two executors using the same state version cannot lose an update', async () => {
  const store = new MemorySandboxStateStore();
  const firstEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'cas-test', seed: 'cas-seed' });
  await store.put(stateRecord(firstEngine));
  const secondEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'cas-test', seed: 'cas-seed' });
  const first = new SandboxCommandExecutor({ engine: firstEngine, store });
  const second = new SandboxCommandExecutor({ engine: secondEngine, store });
  const [left, right] = await Promise.all([
    first.execute('wallet.deposit', { amount: 1000 }, optionsFor('buyer_01', { idempotencyKey: 'cas-left' }), (engine) => engine.depositWallet(1000, { actorId: 'buyer_01' })),
    second.execute('wallet.deposit', { amount: 1000 }, optionsFor('buyer_01', { idempotencyKey: 'cas-right' }), (engine) => engine.depositWallet(1000, { actorId: 'buyer_01' })),
  ]);
  assert.equal([left.ok, right.ok].filter(Boolean).length, 1);
  assert.equal([left, right].filter((result) => !result.ok && result.error === 'STATE_CONFLICT').length, 1);
  assert.equal((await store.get('cas-test')).stateVersion, 1);
});

test('live readers cannot observe a successful transition until the durable commit completes', async () => {
  let releaseCommit;
  let markCommitEntered;
  const commitEntered = new Promise((resolve) => { markCommitEntered = resolve; });
  const commitReleased = new Promise((resolve) => { releaseCommit = resolve; });
  class BarrierStore extends MemorySandboxStateStore {
    async commitCommand(...args) {
      markCommitEntered();
      await commitReleased;
      return super.commitCommand(...args);
    }
  }

  const store = new BarrierStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'publish-after-commit', seed: 'publish-after-commit-seed' });
  await store.put(stateRecord(engine));
  const executor = new SandboxCommandExecutor({ engine, store });
  const beforeState = engine.exportState();
  const beforeVersion = engine.getStateVersion();
  const pending = executor.execute('wallet.deposit', { amount: 1000 }, optionsFor('buyer_01', { idempotencyKey: 'publish-after-commit-1' }), (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));

  await commitEntered;
  assert.equal(engine.getStateVersion(), beforeVersion);
  assert.equal(engine.exportState(), beforeState);
  assert.equal((await store.get('publish-after-commit'))?.stateVersion, beforeVersion);

  releaseCommit();
  const committed = await pending;
  assert.equal(committed.ok, true);
  assert.equal(engine.getStateVersion(), beforeVersion + 1);
  assert.equal((await store.get('publish-after-commit'))?.stateVersion, beforeVersion + 1);
});

test('a failed command never mutates the live aggregate or durable state payload', async () => {
  const store = new MemorySandboxStateStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'failed-command-test', seed: 'failed-command-seed' });
  await store.put(stateRecord(engine));
  const before = engine.exportState();
  const executor = new SandboxCommandExecutor({ engine, store });
  const result = await executor.execute('wallet.deposit', { amount: 1000 }, optionsFor('buyer_01', { idempotencyKey: 'failed-command-1' }), (working) => {
    working.depositWallet(1000, { actorId: 'buyer_01' });
    return { ok: false, error: 'PAYMENT_FAILED', stateVersion: working.getStateVersion() };
  });
  assert.equal(result.ok, false);
  assert.equal(engine.exportState(), before);
  const persisted = await store.get('failed-command-test');
  assert.ok(persisted);
  assert.equal(persisted.payload, before);
  assert.equal((await store.listCommands('failed-command-test'))[0]?.status, 'FAILED');
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

test('persistent browser commands stay unpublished when IndexedDB falls back to volatile memory', async () => {
  const store = new IndexedDbSandboxStateStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'persistent-browser-fallback', seed: 'persistent-browser-fallback-seed' });
  await store.put(stateRecord(engine));
  const before = engine.exportState();
  const executor = new SandboxCommandExecutor({ engine, store, requirePersistentCommit: true });
  const options = optionsFor('buyer_01', { idempotencyKey: 'persistent-browser-fallback-1' });
  const first = await executor.execute('wallet.deposit', { amount: 1000 }, options, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  const repeated = await executor.execute('wallet.deposit', { amount: 1000 }, options, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(first.ok, false);
  if (!first.ok) assert.equal(first.error, 'D1_UNAVAILABLE');
  assert.equal(repeated.ok, false);
  if (!repeated.ok) assert.equal(repeated.error, 'D1_UNAVAILABLE');
  assert.equal(engine.exportState(), before);
});

test('fault injection: a lost response after commit is replayed without a duplicate mutation', async () => {
  const store = new FakeD1SandboxStateStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'fault-test', seed: 'fault-seed' });
  await store.put(stateRecord(engine));
  store.injectFailure('state-after-response-before-client');
  const first = new SandboxCommandExecutor({ engine, store });
  const lostResponse = await first.execute('wallet.deposit', { amount: 1000 }, optionsFor('buyer_01', { idempotencyKey: 'fault-deposit-1' }), (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(lostResponse.ok, false);
  assert.equal(lostResponse.error, 'D1_UNAVAILABLE');
  const persisted = await store.get('fault-test');
  assert.ok(persisted);
  const restartedEngine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'fault-test', seed: 'fault-seed' });
  assert.equal(restartedEngine.importState(persisted.payload, { principal: createTrustedPrincipal({ subjectId: 'executor-test-2', actorId: 'platform', roles: ['platform'], scopes: ['sandbox-control', 'operator'] }) }).ok, true);
  const restarted = new SandboxCommandExecutor({ engine: restartedEngine, store });
  const replayed = await restarted.execute('wallet.deposit', { amount: 1000 }, optionsFor('buyer_01', { idempotencyKey: 'fault-deposit-1' }), (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(replayed.ok, true);
  assert.equal(restartedEngine.getSnapshot().wallets.find((wallet) => wallet.actorId === 'buyer_01')?.availableBalance, 201000);
  assert.equal((await store.listCommands('fault-test')).filter((command) => command.idempotencyKey === 'fault-deposit-1').length, 1);
});
