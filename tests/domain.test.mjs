import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MarketplaceDomain,
  createMarketplaceState,
  deriveTransactionPhase,
} from '../app/domain/marketplace.ts';

const seller = {
  name: 'Seller', avatar: '/seller.png', rating: 4.8, ratingsCount: 20, isVerified: true, salesBalance: 0, points: 0,
};
const buyer = {
  id: 'user-buyer', name: 'Buyer', avatar: '/buyer.png', rating: 5, ratingsCount: 10, isVerified: true, salesBalance: 0, points: 500,
};
const item = (overrides = {}) => ({
  id: 'item-domain', title: 'Domain item', price: 5000, images: ['/item.png'], isSold: false, description: 'A test listing', category: ['本'], condition: '目立った傷や汚れなし', shippingFee: '送料込み（出品者負担）', shippingMethod: 'らくらく配送', origin: '東京都', shippingDays: '1〜2日で発送', likesCount: 0, seller, comments: [], ...overrides,
});
const makeDomain = (overrides = {}) => {
  const state = createMarketplaceState([item(overrides)], buyer);
  return { domain: new MarketplaceDomain(state), state };
};

test('checkout creates an active transaction and does not settle the listing', () => {
  const { domain, state } = makeDomain();
  const listing = state.listings[0];
  const checkout = domain.createCheckout({ buyerId: state.currentUserId, listingId: listing.id });
  assert.equal(checkout.ok, true);
  if (!checkout.ok) return;
  const confirmed = domain.confirmPurchase(checkout.data.id);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  const next = domain.getState();
  assert.equal(next.listings[0].status, 'TRANSACTION_STARTED');
  assert.equal(next.transactions.length, 1);
  assert.equal(next.proceeds.length, 0);
  assert.equal(deriveTransactionPhase(next.transactions[0]), '発送待ち');
});

test('payment, shipment, ratings, and proceeds follow the required order', () => {
  const { domain, state } = makeDomain();
  const checkout = domain.createCheckout({ buyerId: state.currentUserId, listingId: state.listings[0].id });
  assert.equal(checkout.ok, true);
  if (!checkout.ok) return;
  const confirmed = domain.confirmPurchase(checkout.data.id);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  const transactionId = confirmed.data.id;
  assert.equal(domain.rateTransaction(transactionId, state.currentUserId, 5).ok, false);
  const sellerId = domain.getState().transactions[0].sellerId;
  assert.equal(domain.markAsShipped(transactionId).ok, false);
  assert.equal(domain.switchCurrentUser(sellerId).ok, true);
  assert.equal(domain.markAsShipped(transactionId).ok, true);
  assert.equal(domain.switchCurrentUser(state.currentUserId).ok, true);
  assert.equal(domain.rateTransaction(transactionId, state.currentUserId, 5).ok, false);
  assert.equal(domain.updateShipmentStatus(transactionId, 'DELIVERED').ok, true);
  const buyerRating = domain.rateTransaction(transactionId, state.currentUserId, 5, 'Good');
  assert.equal(buyerRating.ok, true);
  assert.equal(domain.switchCurrentUser(sellerId).ok, true);
  assert.equal(domain.rateTransaction(transactionId, sellerId, 5, 'Thanks').ok, true);
  const completed = domain.getState();
  assert.equal(completed.transactions[0].transactionStatus, 'COMPLETED');
  assert.equal(completed.listings[0].status, 'SOLD');
  assert.equal(completed.proceeds[0].net, 4500);
  assert.equal(deriveTransactionPhase(completed.transactions[0]), '取引完了');
});

test('optimistic locking, self purchase, blocking, and duplicate transaction rules are enforced', () => {
  const { domain, state } = makeDomain();
  const listing = state.listings[0];
  const checkout = domain.createCheckout({ buyerId: state.currentUserId, listingId: listing.id });
  assert.equal(checkout.ok, true);
  assert.equal(domain.updateListing(listing.id, { price: 4900 }, listing.version).ok, true);
  if (!checkout.ok) return;
  assert.equal(domain.confirmPurchase(checkout.data.id).ok, false);

  const own = makeDomain();
  own.domain.getState();
  const ownState = own.domain.getState();
  ownState.listings[0].sellerId = ownState.currentUserId;
  own.domain.reset(ownState);
  assert.equal(own.domain.createCheckout({ buyerId: ownState.currentUserId, listingId: ownState.listings[0].id }).ok, false);

  const blocked = makeDomain();
  const blockedState = blocked.domain.getState();
  blocked.domain.blockUser(blockedState.currentUserId, blockedState.listings[0].sellerId);
  assert.equal(blocked.domain.createCheckout({ buyerId: blockedState.currentUserId, listingId: blockedState.listings[0].id }).ok, false);

  const duplicate = makeDomain();
  const duplicateState = duplicate.domain.getState();
  const first = duplicate.domain.createCheckout({ buyerId: duplicateState.currentUserId, listingId: duplicateState.listings[0].id });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(duplicate.domain.confirmPurchase(first.data.id).ok, true);
  assert.equal(duplicate.domain.createCheckout({ buyerId: duplicateState.currentUserId, listingId: duplicateState.listings[0].id }).ok, false);
});

test('pending payment cannot ship until payment is completed', () => {
  const { domain, state } = makeDomain();
  const cash = state.paymentMethods.find((method) => method.type === 'CONVENIENCE_STORE');
  assert.ok(cash);
  const checkout = domain.createCheckout({ buyerId: state.currentUserId, listingId: state.listings[0].id, paymentMethodId: cash.id });
  assert.equal(checkout.ok, true);
  if (!checkout.ok) return;
  const confirmed = domain.confirmPurchase(checkout.data.id);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(deriveTransactionPhase(domain.getState().transactions[0]), '支払い待ち');
  assert.equal(domain.markAsShipped(confirmed.data.id).ok, false);
  assert.equal(domain.completePayment(confirmed.data.id).ok, true);
  assert.equal(domain.switchCurrentUser(domain.getState().transactions[0].sellerId).ok, true);
  assert.equal(domain.markAsShipped(confirmed.data.id).ok, true);
});

test('auction and marketplace side domains keep their own rules', () => {
  const { domain, state } = makeDomain({ id: 'auction-item', isAuction: true, price: 1000, currentBid: 1000 });
  const auction = domain.getState().auctions[0];
  assert.ok(auction);
  assert.equal(domain.placeBid(auction.id, state.currentUserId, 1000).ok, false);
  assert.equal(domain.placeBid(auction.id, state.currentUserId, 1200).ok, true);
  assert.equal(domain.requestPriceChange(state.listings[0].id, state.currentUserId, 800).ok, false);
  assert.equal(domain.addListingComment(state.listings[0].id, state.currentUserId, 'hello').ok, true);
  assert.equal(domain.saveSearch(state.currentUserId, { name: '本', query: '本', filters: {}, notificationEnabled: true, notificationFrequency: 'INSTANT' }).ok, true);
});

test('listing validation and sale proceeds are represented as domain records', () => {
  const { domain, state } = makeDomain();
  const draft = domain.addListingDraft(state.currentUserId, { item: { title: '' }, categoryId: '', price: 200, images: [] });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  const published = domain.publishListing(draft.data.id);
  assert.equal(published.ok, false);
  assert.equal(domain.getSellerManagement(state.currentUserId).length, 1);
});

test('cancellation, return, refund, dispute, moderation, and audit records stay separate', () => {
  const { domain, state } = makeDomain();
  const checkout = domain.createCheckout({ buyerId: state.currentUserId, listingId: state.listings[0].id });
  assert.equal(checkout.ok, true);
  if (!checkout.ok) return;
  const confirmed = domain.confirmPurchase(checkout.data.id);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  const transactionId = confirmed.data.id;
  assert.equal(domain.switchCurrentUser(domain.getState().transactions[0].sellerId).ok, true);
  assert.equal(domain.markAsShipped(transactionId).ok, true);
  assert.equal(domain.switchCurrentUser(state.currentUserId).ok, true);
  assert.equal(domain.updateShipmentStatus(transactionId, 'DELIVERED').ok, true);
  const dispute = domain.openDispute({ transactionId, openedBy: state.currentUserId, category: 'ITEM_NOT_AS_DESCRIBED', description: 'The demo item differs.' });
  assert.equal(dispute.ok, true);
  const returned = domain.requestReturn(transactionId, '商品説明と異なる');
  assert.equal(returned.ok, true);
  if (!returned.ok) return;
  assert.equal(domain.updateReturn(returned.data.id, 'COMPLETED').ok, true);
  const cancel = domain.requestCancellation(transactionId, state.currentUserId, '返品合意', true);
  assert.equal(cancel.ok, true);
  if (!cancel.ok) return;
  assert.equal(domain.respondCancellation(cancel.data.id, true).ok, true);
  assert.equal(domain.completeCancellation(cancel.data.id).ok, true);
  const report = domain.report('LISTING', state.listings[0].id, state.currentUserId, '禁止商品', 'demo report');
  assert.equal(report.ok, true);
  const next = domain.getState();
  assert.equal(next.disputes.length, 1);
  assert.equal(next.returns[0].status, 'COMPLETED');
  assert.equal(next.cancellations[0].status, 'COMPLETED');
  assert.ok(next.transactionEvents.some((event) => event.type === 'SHIPPED'));
  assert.equal(next.reports.length, 1);
  assert.equal(next.moderationCases.length, 1);
});

test('sandbox personas share one marketplace but keep role permissions separate', () => {
  const participantSeller = {
    id: 'user-seller', name: 'Seller', avatar: '/seller.png', rating: 4.8, ratingsCount: 20,
    isVerified: true, salesBalance: 1000, points: 100,
  };
  const state = createMarketplaceState([item()], buyer, [buyer, participantSeller]);
  const domain = new MarketplaceDomain(state);
  assert.ok(state.addresses.some((address) => address.userId === participantSeller.id));
  assert.ok(state.paymentMethods.some((method) => method.userId === participantSeller.id && method.isDefault));

  const checkout = domain.createCheckout({ buyerId: buyer.id, listingId: state.listings[0].id });
  assert.equal(checkout.ok, true);
  if (!checkout.ok) return;
  const confirmed = domain.confirmPurchase(checkout.data.id);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;

  assert.equal(domain.markAsShipped(confirmed.data.id).ok, false);
  assert.equal(domain.switchCurrentUser(participantSeller.id).ok, true);
  assert.equal(domain.markAsShipped(confirmed.data.id).ok, true);
  assert.equal(domain.getTasks(participantSeller.id).length, 0);
  assert.equal(domain.switchCurrentUser(buyer.id).ok, true);
  assert.equal(domain.updateShipmentStatus(confirmed.data.id, 'DELIVERED').ok, true);
  assert.equal(domain.rateTransaction(confirmed.data.id, buyer.id, 5).ok, true);
  assert.equal(domain.switchCurrentUser(participantSeller.id).ok, true);
  assert.equal(domain.rateTransaction(confirmed.data.id, participantSeller.id, 5).ok, true);
  assert.equal(domain.getState().transactions[0].transactionStatus, 'COMPLETED');
});
