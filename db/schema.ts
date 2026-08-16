import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Durable mirror for the sandbox aggregates. The browser demo currently uses
 * the deterministic in-memory engine, while these tables provide the same
 * boundaries for a D1-backed adapter without changing the domain contract.
 */
export const sandboxUsers = sqliteTable('sandbox_users', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),
  name: text('name').notNull(),
  authenticated: integer('authenticated', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
}, (table) => [index('sandbox_users_role_idx').on(table.role)]);

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id').notNull(),
  sku: text('sku').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  price: integer('price').notNull(),
  quantity: integer('quantity').notNull().default(0),
  reservedQuantity: integer('reserved_quantity').notNull().default(0),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('listings_sku_unique_idx').on(table.sku),
  index('listings_status_idx').on(table.status),
  index('listings_seller_idx').on(table.sellerId),
]);

export const inventoryMovements = sqliteTable('inventory_movements', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull(),
  type: text('type').notNull(),
  quantity: integer('quantity').notNull(),
  reason: text('reason').notNull(),
  referenceId: text('reference_id'),
  at: text('at').notNull(),
}, (table) => [index('inventory_movements_listing_idx').on(table.listingId)]);

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  listingId: text('listing_id').notNull(),
  buyerId: text('buyer_id').notNull(),
  sellerId: text('seller_id').notNull(),
  status: text('status').notNull(),
  priceSnapshot: integer('price_snapshot').notNull(),
  total: integer('total').notNull(),
  reservationId: text('reservation_id').notNull(),
  paymentId: text('payment_id').notNull(),
  shipmentId: text('shipment_id').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('transactions_order_unique_idx').on(table.orderId),
  index('transactions_buyer_idx').on(table.buyerId),
  index('transactions_seller_idx').on(table.sellerId),
  index('transactions_status_idx').on(table.status),
]);

export const purchaseIntents = sqliteTable('purchase_intents', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  listingId: text('listing_id').notNull(),
  buyerId: text('buyer_id').notNull(),
  status: text('status').notNull(),
  quantity: integer('quantity').notNull(),
  quote: integer('quote').notNull(),
  expiresAt: text('expires_at').notNull(),
  expectedStateVersion: integer('expected_state_version').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('purchase_intents_buyer_idx').on(table.buyerId),
  index('purchase_intents_listing_idx').on(table.listingId),
  index('purchase_intents_status_idx').on(table.status),
]);

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  status: text('status').notNull(),
  method: text('method').notNull(),
  amount: integer('amount').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('payments_transaction_idx').on(table.transactionId)]);

export const shipments = sqliteTable('shipments', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  status: text('status').notNull(),
  trackingNumber: text('tracking_number'),
  method: text('method').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('shipments_transaction_idx').on(table.transactionId)]);

export const domainEvents = sqliteTable('domain_events', {
  id: text('id').primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  type: text('type').notNull(),
  actorId: text('actor_id').notNull(),
  correlationId: text('correlation_id').notNull(),
  stateVersion: integer('state_version').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  at: text('at').notNull(),
}, (table) => [
  index('domain_events_aggregate_idx').on(table.aggregateType, table.aggregateId),
  index('domain_events_correlation_idx').on(table.correlationId),
]);

export const auctionBids = sqliteTable('auction_bids', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull(),
  bidderId: text('bidder_id').notNull(),
  amount: integer('amount').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('auction_bids_listing_idx').on(table.listingId),
  index('auction_bids_bidder_idx').on(table.bidderId),
]);

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  reviewerId: text('reviewer_id').notNull(),
  revieweeId: text('reviewee_id').notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('reviews_transaction_idx').on(table.transactionId),
  index('reviews_reviewee_idx').on(table.revieweeId),
]);

export const wallets = sqliteTable('wallets', {
  actorId: text('actor_id').primaryKey(),
  availableBalance: integer('available_balance').notNull().default(0),
  heldBalance: integer('held_balance').notNull().default(0),
  points: integer('points').notNull().default(0),
  payload: text('payload', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sandboxStates = sqliteTable('sandbox_states', {
  id: text('id').primaryKey(),
  scenarioId: text('scenario_id').notNull(),
  seed: text('seed').notNull(),
  stateVersion: integer('state_version').notNull(),
  virtualNow: text('virtual_now').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('sandbox_states_scenario_idx').on(table.scenarioId)]);

export const sandboxCommandRecords = sqliteTable('sandbox_command_records', {
  operationId: text('operation_id').primaryKey(),
  sandboxId: text('sandbox_id').notNull(),
  actorId: text('actor_id').notNull(),
  command: text('command').notNull(),
  mode: text('mode').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestId: text('request_id'),
  commandId: text('command_id'),
  payloadHash: text('payload_hash').notNull(),
  stateVersionBefore: integer('state_version_before').notNull(),
  stateVersionAfter: integer('state_version_after').notNull(),
  status: text('status').notNull(),
  result: text('result_json', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, (table) => [
  uniqueIndex('sandbox_command_records_idempotency_idx').on(table.sandboxId, table.idempotencyKey),
  index('sandbox_command_records_sandbox_idx').on(table.sandboxId, table.createdAt),
]);

export const sandboxPreviewRecords = sqliteTable('sandbox_preview_records', {
  previewId: text('preview_id').primaryKey(),
  sandboxId: text('sandbox_id').notNull(),
  actorId: text('actor_id').notNull(),
  command: text('command').notNull(),
  payload: text('payload_json', { mode: 'json' }).notNull(),
  payloadHash: text('payload_hash').notNull(),
  baseStateVersion: integer('base_state_version').notNull(),
  summary: text('summary_json', { mode: 'json' }).notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  virtualExpiresAt: text('virtual_expires_at').notNull(),
  retentionExpiresAt: text('retention_expires_at').notNull(),
  committedOperationId: text('committed_operation_id'),
}, (table) => [
  index('sandbox_preview_records_sandbox_idx').on(table.sandboxId, table.status),
  index('sandbox_preview_records_retention_idx').on(table.retentionExpiresAt),
]);

export const sandboxNotifications = sqliteTable('sandbox_notifications', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  eventId: text('event_id'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (table) => [index('sandbox_notifications_actor_idx').on(table.actorId)]);

export const actorProfiles = sqliteTable('actor_profiles', {
  actorId: text('actor_id').primaryKey(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  avatar: text('avatar').notNull(),
  rating: integer('rating').notNull().default(0),
  ratingsCount: integer('ratings_count').notNull().default(0),
  completedSales: integer('completed_sales').notNull().default(0),
  completedPurchases: integer('completed_purchases').notNull().default(0),
  isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(false),
  payload: text('payload', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const returnCases = sqliteTable('return_cases', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  requesterId: text('requester_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  requestedAt: text('requested_at').notNull(),
  decidedAt: text('decided_at'),
  receivedAt: text('received_at'),
  refundedAt: text('refunded_at'),
}, (table) => [
  index('return_cases_transaction_idx').on(table.transactionId),
  index('return_cases_status_idx').on(table.status),
]);

export const transactionMessages = sqliteTable('transaction_messages', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  senderId: text('sender_id').notNull(),
  body: text('body').notNull(),
  readBy: text('read_by', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('transaction_messages_transaction_idx').on(table.transactionId)]);

export const supportTickets = sqliteTable('support_tickets', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id'),
  reporterId: text('reporter_id').notNull(),
  category: text('category').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  evidence: text('evidence', { mode: 'json' }).notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('support_tickets_reporter_idx').on(table.reporterId),
  index('support_tickets_status_idx').on(table.status),
]);
