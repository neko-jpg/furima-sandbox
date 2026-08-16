import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_ITEMS } from '../app/data/initialData.ts';
import { SandboxCommandExecutor } from '../app/domain/commandExecutor.ts';
import { IndexedDbSandboxStateStore } from '../app/domain/sandboxIdbStore.ts';
import { SandboxEngine } from '../app/domain/sandboxEngine.ts';
import { FakeD1SandboxStateStore } from '../app/domain/sandboxStore.ts';

const recordFor = (engine) => {
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

test('D1 fault points never leave a partial wallet mutation', async () => {
  const points = ['d1-unavailable', 'd1-timeout', 'worker-restart', 'request-abort', 'command-before-record', 'command-after-record-before-state', 'cas-conflict'];
  for (const point of points) {
    const store = new FakeD1SandboxStateStore();
    const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: `fault-${point}`, seed: `fault-${point}` });
    await store.put(recordFor(engine));
    const before = await store.get(engine.getSandboxId());
    store.injectFailure(point);
    const executor = new SandboxCommandExecutor({ engine, store });
    const result = await executor.execute('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: `fault-${point}-deposit` }, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
    assert.equal(result.ok, false, point);
    assert.ok(['D1_UNAVAILABLE', 'STATE_CONFLICT'].includes(result.error), `${point}: ${result.error}`);
    const after = await store.get(engine.getSandboxId());
    assert.deepEqual(after, before, `${point} changed state`);
    assert.equal((await store.listCommands(engine.getSandboxId())).length, 0, `${point} left a command record`);
  }
});

test('IndexedDB quota and corruption diagnostics select the memory fallback explicitly', async () => {
  const quotaStore = new IndexedDbSandboxStateStore();
  quotaStore.injectFailure('indexeddb-quota-exceeded');
  const record = {
    id: 'idb-quota',
    scenarioId: 'catalog_default',
    seed: 'seed',
    stateVersion: 0,
    virtualNow: '2026-01-01T00:00:00.000Z',
    payload: '{}',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  assert.equal((await quotaStore.put(record)).ok, true);
  assert.equal((await quotaStore.ready()).fallbackReason, 'QUOTA_EXCEEDED');

  const corruptStore = new IndexedDbSandboxStateStore();
  corruptStore.recordFailure('CORRUPTED');
  assert.equal((await corruptStore.ready()).fallbackReason, 'CORRUPTED');
});
