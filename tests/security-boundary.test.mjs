import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_ITEMS } from '../app/data/initialData.ts';
import { SandboxCommandExecutor } from '../app/domain/commandExecutor.ts';
import { SandboxEngine, createTrustedPrincipal } from '../app/domain/sandboxEngine.ts';
import { MemorySandboxStateStore } from '../app/domain/sandboxStore.ts';

process.env.FURIMA_LOCAL_FIXTURE_MODE = 'true';
process.env.FURIMA_STORAGE_MODE = 'memory';
process.env.FURIMA_D1_CONTROL_TOKEN = 'security-control-token';

const controlOptions = {
  principal: createTrustedPrincipal({ subjectId: 'security-test-control', actorId: 'platform', roles: ['platform'], scopes: ['sandbox-control', 'operator'] }),
};

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

test('buyer cannot perform seller listing operations', () => {
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'security-buyer' });
  const result = engine.createListingDraft({
    title: 'buyer must not list',
    description: 'security test',
    price: 1000,
    category: ['その他'],
  }, { actorId: 'buyer_01' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'FORBIDDEN');
  assert.equal(engine.getSnapshot().drafts?.length, undefined);
  assert.equal(engine.getStateVersion(), 0);
});

test('untrusted agent options cannot reach control operations', () => {
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'security-controls' });
  assert.equal(engine.switchActor('seller_01', { actorId: 'buyer_01', scope: 'sandbox-control' }).error, 'FORBIDDEN');
  assert.equal(engine.advanceClock(1000, { actorId: 'buyer_01', scope: 'sandbox-control' }).error, 'FORBIDDEN');
  assert.equal(engine.injectFailure('payment', { actorId: 'buyer_01', scope: 'sandbox-control' }).error, 'FORBIDDEN');
  assert.equal(engine.resetScenario({ actorId: 'buyer_01', scope: 'sandbox-control' }).error, 'FORBIDDEN');
  assert.equal(engine.importState(engine.exportState(), { actorId: 'buyer_01', scope: 'sandbox-control' }).error, 'FORBIDDEN');
});

test('preview leaves live and durable state unchanged', async () => {
  const store = new MemorySandboxStateStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'security-preview' });
  await store.put(stateRecord(engine));
  const executor = new SandboxCommandExecutor({ engine, store });
  const beforePayload = engine.exportState();
  const beforeVersion = engine.getStateVersion();
  const beforeUpdatedAt = (await store.get('security-preview')).updatedAt;
  const preview = await executor.preview('wallet.deposit', { amount: 1000 }, { actorId: 'buyer_01', idempotencyKey: 'security-preview-1' }, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(preview.ok, true);
  assert.equal(engine.exportState(), beforePayload);
  assert.equal(engine.getStateVersion(), beforeVersion);
  assert.equal((await store.get('security-preview')).stateVersion, beforeVersion);
  assert.equal((await store.get('security-preview')).updatedAt, beforeUpdatedAt);
});

test('same idempotency key applies a side effect only once', async () => {
  const store = new MemorySandboxStateStore();
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'security-idempotency' });
  await store.put(stateRecord(engine));
  const executor = new SandboxCommandExecutor({ engine, store });
  const options = { actorId: 'buyer_01', idempotencyKey: 'security-deposit-1' };
  const first = await executor.execute('wallet.deposit', { amount: 1000 }, options, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  const second = await executor.execute('wallet.deposit', { amount: 1000 }, options, (working) => working.depositWallet(1000, { actorId: 'buyer_01' }));
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(engine.getSnapshot().wallets.find((wallet) => wallet.actorId === 'buyer_01')?.availableBalance, 201000);
  assert.equal((await store.listCommands('security-idempotency')).filter((command) => command.idempotencyKey === options.idempotencyKey).length, 1);
});

test('HTTP replay retry returns the durable result without restoring the base state', async () => {
  const { POST } = await import('../app/api/sandbox/replay/route.ts');
  const id = `security-http-replay-${Date.now()}`;
  const body = {
    id,
    seed: 'security-http-replay-seed',
    actions: [{ command: 'depositWallet', idempotencyKey: 'security-http-replay-1', payload: { amount: 1000 } }],
  };
  const request = () => new Request('http://localhost/api/sandbox/replay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer security-control-token' },
    body: JSON.stringify(body),
  });

  const firstResponse = await POST(request());
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  const secondResponse = await POST(request());
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();

  assert.deepEqual(second.results, first.results);
  assert.deepEqual(second.state, first.state);
  assert.equal(second.stateVersion, first.stateVersion);
  assert.equal(second.trace.filter((command) => command.idempotencyKey === 'security-http-replay-1').length, 1);
});

test('state import rejects unknown fields and actor identity injection', () => {
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'security-import' });
  const unknown = JSON.parse(engine.exportState());
  unknown.privilege = 'platform';
  const unknownResult = engine.importState(JSON.stringify(unknown), controlOptions);
  assert.equal(unknownResult.ok, false);
  if (!unknownResult.ok) assert.equal(unknownResult.error, 'INVALID_INPUT');

  const injected = JSON.parse(engine.exportState());
  injected.actors.find((actor) => actor.id === 'buyer_01').role = 'platform';
  const injectedResult = engine.importState(JSON.stringify(injected), controlOptions);
  assert.equal(injectedResult.ok, false);
  if (!injectedResult.ok) assert.equal(injectedResult.error, 'INVALID_INPUT');
});
