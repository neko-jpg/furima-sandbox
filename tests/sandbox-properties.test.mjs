import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';

import { SandboxEngine } from '../app/domain/sandboxEngine.ts';

const seller = { name: 'Property Seller', avatar: '/favicon.svg', rating: 5, ratingsCount: 1, isVerified: true };
const item = {
  id: 'property-item',
  sku: 'PROPERTY-SKU',
  title: 'Property test item',
  price: 1200,
  images: ['/images/products/knit.webp'],
  isSold: false,
  description: 'A deterministic sandbox item.',
  category: ['テスト'],
  condition: '新品・未使用',
  shippingFee: '送料込み（出品者負担）',
  shippingMethod: 'らくらく配送',
  origin: '東京都',
  shippingDays: '1〜2日で発送',
  likesCount: 0,
  seller,
  sellerId: 'seller_01',
  inventoryPolicy: 'SINGLE',
  inventoryInitialQuantity: 1,
  inventoryQuantity: 1,
  reservedQuantity: 0,
  listingStatus: 'ACTIVE',
  comments: [],
};

const createEngine = (seed = 'property-seed-v1') => new SandboxEngine([item], { seed, sandboxId: 'property-sandbox' });

test('fast-check: arbitrary wallet command sequences never violate balance invariants', () => {
  fc.assert(fc.property(
    fc.array(fc.record({ type: fc.constantFrom('deposit', 'withdraw'), amount: fc.integer({ min: 1, max: 100_000 }) }), { maxLength: 25 }),
    (commands) => {
      const engine = createEngine();
      for (const command of commands) {
        const result = command.type === 'deposit'
          ? engine.depositWallet(command.amount, { actorId: 'buyer_01' })
          : engine.withdrawWallet(command.amount, { actorId: 'buyer_01' });
        assert.equal(typeof result.ok, 'boolean');
        const wallet = engine.getSnapshot().wallets.find((candidate) => candidate.actorId === 'buyer_01');
        assert.ok(wallet);
        assert.ok(wallet.availableBalance >= 0);
        assert.ok(wallet.heldBalance >= 0);
        assert.deepEqual(engine.assertInvariants(), []);
      }
    },
  ), { numRuns: 80 });
});

test('fast-check: same seed and command sequence produce the same replay state', () => {
  const seeds = fc.array(fc.constantFrom('a', 'b', 'c', '0', '1', '-'), { minLength: 1, maxLength: 24 }).map((parts) => parts.join(''));
  fc.assert(fc.property(seeds, fc.array(fc.integer({ min: 1, max: 20_000 }), { maxLength: 10 }), (seed, amounts) => {
    const left = createEngine(seed);
    const right = createEngine(seed);
    for (const amount of amounts) {
      left.depositWallet(amount, { actorId: 'buyer_01' });
      right.depositWallet(amount, { actorId: 'buyer_01' });
    }
    assert.equal(left.exportState(), right.exportState());
    assert.deepEqual(left.assertInvariants(), []);
    assert.deepEqual(right.assertInvariants(), []);
  }), { numRuns: 60 });
});
