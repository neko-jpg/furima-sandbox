import assert from 'node:assert/strict';
import test from 'node:test';

import { SandboxEngine } from '../app/domain/sandboxEngine.ts';

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve));

test('domain event subscribers receive committed events and can unsubscribe', async () => {
  const engine = new SandboxEngine([]);
  const received = [];
  const unsubscribe = engine.subscribe((event) => received.push(event));

  const deposit = engine.depositWallet(100, { actorId: 'buyer_01' });
  assert.equal(deposit.ok, true);
  await flushMicrotasks();
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'WALLET_DEPOSITED');
  assert.equal(received[0].stateVersion, deposit.stateVersion);

  unsubscribe();
  const withdrawal = engine.withdrawWallet(50, { actorId: 'buyer_01' });
  assert.equal(withdrawal.ok, true);
  await flushMicrotasks();
  assert.equal(received.length, 1);
});
