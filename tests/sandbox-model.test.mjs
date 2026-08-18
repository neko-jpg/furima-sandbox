import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';

import { INITIAL_ITEMS } from '../app/data/initialData.ts';
import { SandboxEngine, createTrustedPrincipal } from '../app/domain/sandboxEngine.ts';

const control = { principal: createTrustedPrincipal({ subjectId: 'model-control', actorId: 'platform', roles: ['platform'], scopes: ['sandbox-control', 'operator'] }) };
const buyers = ['buyer_01', 'buyer_02'];
const scenarios = ['catalog_default', 'purchase_happy_path', 'multi_inventory', 'auction_outbid', 'zero_search_results', 'delivery_delay'];

const commandArbitrary = fc.oneof(
  fc.record({ type: fc.constant('deposit'), amount: fc.integer({ min: 1, max: 20_000 }) }),
  fc.record({ type: fc.constant('withdraw'), amount: fc.integer({ min: 1, max: 20_000 }) }),
  fc.record({ type: fc.constant('switch'), actorId: fc.constantFrom('buyer_01', 'buyer_02', 'seller_01') }),
  fc.record({ type: fc.constant('scenario'), scenarioId: fc.constantFrom(...scenarios) }),
  fc.record({ type: fc.constant('clock'), milliseconds: fc.integer({ min: 0, max: 86_400_000 }) }),
  fc.record({ type: fc.constant('draft'), title: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 12 }) }),
  fc.record({ type: fc.constant('bid'), amount: fc.integer({ min: 300, max: 20_000 }) }),
  fc.record({ type: fc.constant('purchase') }),
  fc.record({ type: fc.constant('profile'), suffix: fc.string({ unit: 'grapheme', maxLength: 12 }) }),
);

const firstAvailable = (engine) => engine.getItems().find((item) => !item.isAuction && item.listingStatus === 'ACTIVE' && (item.inventoryQuantity ?? 0) > (item.reservedQuantity ?? 0));
const firstAuction = (engine) => engine.getItems().find((item) => item.isAuction && item.listingStatus !== 'SOLD' && (item.inventoryQuantity ?? 0) > (item.reservedQuantity ?? 0));

function apply(engine, command, index) {
  const key = `model-${index}-${command.type}`;
  if (command.type === 'deposit') return engine.depositWallet(command.amount, { actorId: 'buyer_01', idempotencyKey: `${key}-deposit` });
  if (command.type === 'withdraw') return engine.withdrawWallet(command.amount, { actorId: 'buyer_01', idempotencyKey: `${key}-withdraw` });
  if (command.type === 'switch') return engine.switchActor(command.actorId, { ...control, idempotencyKey: `${key}-switch` });
  if (command.type === 'scenario') return engine.loadScenario(command.scenarioId, { ...control, seed: `${command.scenarioId}-model-seed`, idempotencyKey: `${key}-scenario` });
  if (command.type === 'clock') return engine.advanceClock(command.milliseconds, { ...control, idempotencyKey: `${key}-clock` });
  if (command.type === 'profile') return engine.updateProfile({ displayName: `Buyer ${command.suffix}`.slice(0, 60) }, { actorId: 'buyer_01', idempotencyKey: `${key}-profile` });
  if (command.type === 'bid') {
    const target = firstAuction(engine);
    return target ? engine.placeBid(target.id, command.amount, { actorId: 'buyer_01', idempotencyKey: `${key}-bid` }) : { ok: false, error: 'ITEM_NOT_FOUND', stateVersion: engine.getStateVersion() };
  }
  if (command.type === 'purchase') {
    const target = firstAvailable(engine);
    if (!target) return { ok: false, error: 'ITEM_NOT_FOUND', stateVersion: engine.getStateVersion() };
    const started = engine.startPurchase(target.id, { actorId: buyers[index % buyers.length], idempotencyKey: `${key}-start` });
    if (!started.ok) return started;
    return engine.confirmPurchase(started.data.purchaseIntentId, { actorId: buyers[index % buyers.length], idempotencyKey: `${key}-confirm` });
  }
  if (command.type === 'draft') {
    return engine.createListingDraft({ title: command.title, price: 1200, description: 'model draft', category: ['テスト'], condition: '新品・未使用', images: ['/favicon.svg'] }, { actorId: 'seller_01', idempotencyKey: `${key}-draft` });
  }
  return { ok: false, error: 'INVALID_INPUT', stateVersion: engine.getStateVersion() };
}

function assertStateSafety(engine, previousVersion) {
  const snapshot = engine.getSnapshot();
  assert.ok(snapshot.stateVersion >= previousVersion, `stateVersion rolled back: ${previousVersion} -> ${snapshot.stateVersion}`);
  assert.deepEqual(engine.assertInvariants(), []);
  for (const wallet of snapshot.wallets) {
    assert.ok(wallet.availableBalance >= 0);
    assert.ok(wallet.heldBalance >= 0);
    assert.ok(wallet.points >= 0);
    for (const entry of wallet.ledger) assert.ok(Number.isInteger(entry.amount) && entry.amount > 0);
  }
  for (const item of engine.getItems()) {
    assert.ok((item.inventoryQuantity ?? 0) >= 0);
    assert.ok((item.reservedQuantity ?? 0) >= 0);
    assert.ok((item.reservedQuantity ?? 0) <= (item.inventoryQuantity ?? 0));
  }
  const buyerView = engine.getScopedSnapshot('buyer_01');
  assert.ok(buyerView.wallets.every((wallet) => wallet.actorId === 'buyer_01'));
  assert.ok(buyerView.profiles?.every((profile) => profile.actorId === 'buyer_01'));
  assert.ok(buyerView.transactions.every((transaction) => transaction.buyerId === 'buyer_01' || transaction.sellerId === 'buyer_01'));
}

test('fast-check model: mixed sandbox commands preserve invariants, isolation, and determinism', () => {
  fc.assert(fc.property(fc.array(commandArbitrary, { maxLength: 40 }), (commands) => {
    const left = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'model-a', seed: 'model-seed' });
    const right = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'model-a', seed: 'model-seed' });
    let previousVersion = 0;
    commands.forEach((command, index) => {
      const leftResult = apply(left, command, index);
      const rightResult = apply(right, command, index);
      assert.deepEqual(rightResult, leftResult);
      assertStateSafety(left, previousVersion);
      assertStateSafety(right, previousVersion);
      previousVersion = left.getStateVersion();
    });
    assert.equal(left.exportState(), right.exportState());
  }), { numRuns: 80, endOnFailure: true });
});

test('sandbox isolation: commands in sandbox A cannot change sandbox B', () => {
  const first = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'isolation-a', seed: 'same' });
  const second = new SandboxEngine(INITIAL_ITEMS, { sandboxId: 'isolation-b', seed: 'same' });
  const before = second.exportState();
  first.depositWallet(5000, { actorId: 'buyer_01' });
  first.createListingDraft({ title: 'A only', price: 1200 }, { actorId: 'seller_01' });
  assert.equal(second.exportState(), before);
  assert.deepEqual(first.assertInvariants(), []);
  assert.deepEqual(second.assertInvariants(), []);
});
