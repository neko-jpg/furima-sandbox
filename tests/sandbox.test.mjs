import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketplaceDomain, createMarketplaceState } from '../app/domain/marketplace.ts';
import { MarketplaceSandbox } from '../app/domain/sandbox.ts';

const human = {
  id: 'user-human', name: 'Human', avatar: '/human.png', rating: 5, ratingsCount: 20,
  isVerified: true, salesBalance: 0, points: 0,
};
const npc = {
  id: 'user-npc', name: 'NPC', avatar: '/npc.png', rating: 4.9, ratingsCount: 30,
  isVerified: true, salesBalance: 0, points: 0,
};
const sellerA = {
  id: 'user-seller-a', name: 'Seller A', avatar: '/seller-a.png', rating: 4.8, ratingsCount: 40,
  isVerified: true, salesBalance: 0, points: 0,
};
const sellerB = {
  id: 'user-seller-b', name: 'Seller B', avatar: '/seller-b.png', rating: 4.7, ratingsCount: 50,
  isVerified: true, salesBalance: 0, points: 0,
};

const item = (id, title, price, seller, overrides = {}) => ({
  id,
  title,
  price,
  images: [`/${id}.png`],
  isSold: false,
  description: `${title}のテスト商品です`,
  category: ['家電・スマホ', 'カメラ'],
  condition: '目立った傷や汚れなし',
  shippingFee: '送料込み（出品者負担）',
  shippingMethod: 'らくらく配送',
  origin: '東京都',
  shippingDays: '1〜2日で発送',
  likesCount: 0,
  seller: {
    name: seller.name,
    avatar: seller.avatar,
    rating: seller.rating,
    ratingsCount: seller.ratingsCount,
    isVerified: seller.isVerified,
  },
  comments: [],
  ...overrides,
});

const makeRuntime = (seed = 12345, items = [
  item('camera-1', 'ミラーレス カメラ Alpha', 5_000, sellerA),
  item('camera-2', 'コンパクト カメラ Beta', 6_000, sellerB),
  item('camera-expensive', 'プロ用 カメラ Gamma', 500_000, sellerA),
]) => {
  const marketplace = createMarketplaceState(items, human, [human, npc, sellerA, sellerB]);
  const domain = new MarketplaceDomain(marketplace);
  const sandbox = new MarketplaceSandbox(domain, seed);
  return { domain, sandbox };
};

const listingIdFor = (domain, itemId) => {
  const listing = domain.getState().listings.find((candidate) => candidate.itemId === itemId);
  assert.ok(listing, `listing for ${itemId}`);
  return listing.id;
};

const sum = (values) => values.reduce((total, value) => total + value, 0);

test('the same seed creates the same world and the same fallback NPC decision', () => {
  const left = makeRuntime('repeatable-world');
  const right = makeRuntime('repeatable-world');

  assert.deepEqual(left.sandbox.getState(), right.sandbox.getState());
  const initialEventCount = left.sandbox.getState().events.length;
  left.sandbox.step();
  right.sandbox.step();

  const signature = (sandbox) => {
    const event = sandbox.getState().events.slice(initialEventCount).find((candidate) => candidate.actorType === 'npc');
    assert.ok(event, 'fallback generated an NPC event');
    return {
      eventType: event.eventType,
      actorId: event.actorId,
      targetId: event.targetId,
      correlationId: event.correlationId,
      command: event.metadata.command,
    };
  };
  assert.deepEqual(signature(left.sandbox), signature(right.sandbox));
});

test('events and ledger entries are scoped to the active world', () => {
  const { sandbox } = makeRuntime(17);
  sandbox.step();
  const state = sandbox.getState();
  assert.ok(state.events.length > 1);
  assert.ok(state.ledger.length > 0);
  assert.ok(state.events.every((event) => event.worldId === state.world.id));
  assert.ok(state.ledger.every((entry) => entry.worldId === state.world.id));
});

test('purchase rejects insufficient funds before mutating MarketplaceDomain', () => {
  const { domain, sandbox } = makeRuntime();
  const listingId = listingIdFor(domain, 'camera-expensive');
  const before = domain.getState();
  const result = sandbox.executePurchase(human.id, listingId, 'human', 'purchase-too-expensive');

  assert.deepEqual(result, { ok: false, error: 'INSUFFICIENT_FUNDS' });
  assert.equal(domain.getState().transactions.length, before.transactions.length);
  assert.equal(sandbox.getState().ledger.some((entry) => entry.transactionId), false);
  const rejection = sandbox.getState().events.at(-1);
  assert.equal(rejection.eventType, 'command.rejected');
  assert.equal(rejection.correlationId, 'purchase-too-expensive');
  assert.equal(rejection.metadata.error, 'INSUFFICIENT_FUNDS');
});

test('human and NPC purchases use the same port and restore the active domain user', () => {
  const { domain, sandbox } = makeRuntime();
  const originalUserId = domain.getState().currentUserId;
  const humanPurchase = sandbox.executePurchase(human.id, listingIdFor(domain, 'camera-1'), 'human', 'human-buy');
  const npcPurchase = sandbox.executePurchase(npc.id, listingIdFor(domain, 'camera-2'), 'npc', 'npc-buy');

  assert.equal(humanPurchase.ok, true);
  assert.equal(npcPurchase.ok, true);
  assert.equal(domain.getState().currentUserId, originalUserId);
  const purchases = sandbox.getState().events.filter((event) => event.eventType === 'order.purchased');
  assert.deepEqual(purchases.map((event) => event.actorType), ['human', 'npc']);
  assert.deepEqual(purchases.map((event) => event.correlationId), ['human-buy', 'npc-buy']);
  assert.ok(purchases.every((event) => event.causedBy));
});

test('one listing cannot be purchased twice and failed retries do not debit a wallet', () => {
  const { domain, sandbox } = makeRuntime();
  const listingId = listingIdFor(domain, 'camera-1');
  const first = sandbox.executePurchase(human.id, listingId, 'human', 'first-buy');
  assert.equal(first.ok, true);
  const ledgerLength = sandbox.getState().ledger.length;
  const second = sandbox.executePurchase(npc.id, listingId, 'npc', 'duplicate-buy');

  assert.equal(second.ok, false);
  assert.equal(second.error, 'LISTING_UNAVAILABLE');
  assert.equal(domain.getState().transactions.length, 1);
  assert.equal(sandbox.getState().ledger.length, ledgerLength);
  assert.equal(sandbox.getState().ledger.filter((entry) => entry.type === 'debit' && entry.transactionId).length, 1);
});

test('ledger conserves credits through escrow hold and settlement', () => {
  const { domain, sandbox } = makeRuntime();
  const listingId = listingIdFor(domain, 'camera-1');
  const initial = sandbox.getState();
  const initialTotal = sum(initial.wallets.map((wallet) => wallet.balance));
  assert.equal(sum(initial.ledger.map((entry) => entry.amount)), initialTotal);
  const buyerBefore = initial.wallets.find((wallet) => wallet.ownerId === npc.id).balance;
  const result = sandbox.executePurchase(npc.id, listingId, 'npc', 'escrow-flow');
  assert.equal(result.ok, true);
  if (!result.ok) return;

  let state = sandbox.getState();
  assert.equal(state.wallets.find((wallet) => wallet.ownerId === npc.id).balance, buyerBefore - result.transaction.total);
  assert.equal(state.wallets.find((wallet) => wallet.ownerId === 'escrow').balance, result.transaction.total);
  assert.equal(sum(state.wallets.map((wallet) => wallet.balance)), initialTotal);
  assert.equal(sum(state.ledger.filter((entry) => entry.transactionId === result.transaction.id).map((entry) => entry.amount)), 0);

  for (let count = 0; count < 10 && domain.getState().transactions[0].transactionStatus !== 'COMPLETED'; count += 1) {
    sandbox.step();
  }
  const transaction = domain.getState().transactions[0];
  assert.equal(transaction.transactionStatus, 'COMPLETED');
  state = sandbox.getState();
  assert.equal(state.wallets.find((wallet) => wallet.ownerId === 'escrow').balance, 0);
  assert.ok(state.ledger.some((entry) => entry.transactionId === transaction.id && entry.type === 'escrow_release' && entry.amount < 0));
  assert.ok(state.ledger.some((entry) => entry.transactionId === transaction.id && entry.type === 'fee' && entry.amount > 0));
  assert.equal(sum(state.ledger.filter((entry) => entry.transactionId === transaction.id).map((entry) => entry.amount)), 0);
  assert.equal(sum(state.wallets.map((wallet) => wallet.balance)), initialTotal);
  assert.equal(sum(state.ledger.map((entry) => entry.amount)), initialTotal);
});

test('Buyer Agent compares candidates, waits for Human confirmation, then purchases with one causal chain', () => {
  const { domain, sandbox } = makeRuntime();
  const run = sandbox.runBuyerAgent({
    goal: '予算内で状態の良いカメラを買う',
    query: 'カメラ',
    budget: 8_000,
    offerPrice: 4_500,
  });

  assert.equal(run.status, 'awaiting_confirmation');
  assert.ok(run.candidates.length >= 2);
  assert.ok(run.candidates.every((candidate) => candidate.itemId && candidate.title && candidate.price > 0 && candidate.score > 0 && candidate.reason));
  assert.deepEqual(run.steps.slice(0, 2).map((step) => step.type), ['search', 'compare']);
  assert.ok(run.steps.some((step) => step.type === 'offer'));
  assert.equal(run.steps.at(-1).type, 'confirmation');
  assert.equal(domain.getState().transactions.length, 0);

  const purchased = sandbox.confirmAgentPurchase(run.id);
  assert.equal(purchased.status, 'purchased');
  assert.ok(purchased.transactionId);
  assert.equal(domain.getState().transactions.length, 1);
  assert.equal(purchased.steps.at(-1).type, 'purchase');

  const chain = sandbox.getState().events.filter((event) => event.correlationId === run.id);
  const orderIndex = chain.findIndex((event) => event.eventType === 'order.purchased');
  assert.ok(orderIndex > 0, 'domain purchase participates in the Agent correlation');
  assert.equal(chain[orderIndex].causedBy, chain[orderIndex - 1].eventId);
  for (let index = 1; index < chain.length; index += 1) {
    assert.equal(chain[index].causedBy, chain[index - 1].eventId);
  }
});

test('restoreState survives JSON round trips and rebuilds idempotency indexes', () => {
  const { domain, sandbox } = makeRuntime();
  const result = sandbox.executePurchase(human.id, listingIdFor(domain, 'camera-1'), 'human', 'persisted-buy');
  assert.equal(result.ok, true);
  const snapshot = JSON.parse(JSON.stringify(sandbox.getState()));
  sandbox.setPlaying(true);
  sandbox.restoreState(snapshot);

  assert.deepEqual(sandbox.getState(), snapshot);
  snapshot.world.tick = 999;
  assert.notEqual(sandbox.getState().world.tick, 999, 'restore deep-clones caller state');
  const restored = sandbox.getState();
  sandbox.syncDomainEvents('human');
  assert.equal(sandbox.getState().events.length, restored.events.length);
  assert.equal(sandbox.getState().ledger.length, restored.ledger.length);
  assert.throws(() => sandbox.restoreState({}), /Invalid sandbox state/);
});

test('browser fallback never chooses the signed-in Human as an autonomous market actor', () => {
  const { domain, sandbox } = makeRuntime('fallback-actors');
  const eventCount = sandbox.getState().events.length;
  sandbox.step();

  const generated = sandbox.getState().events.slice(eventCount);
  assert.ok(generated.length > 0);
  assert.ok(generated.filter((event) => event.actorType === 'npc').every((event) => event.actorId !== human.id));
  assert.ok(domain.getState().transactions.every((transaction) => transaction.buyerId !== human.id));
});
