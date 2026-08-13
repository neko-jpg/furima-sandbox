export interface Seller {
  name: string;
  avatar: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  level?: number;
  completedSales?: number;
  responseRate?: number;
}

export interface CommentItem {
  id: string;
  userId?: string;
  userName: string;
  userAvatar: string;
  text: string;
  date: string;
}

export interface ProductFamily {
  id: string;
  name: string;
  productType: string;
  category: string;
}

export interface ProductVariant {
  id: string;
  familyId: string;
  name: string;
  attributes: Record<string, string>;
  searchTags: string[];
}

export interface MercariItem {
  id: string;
  title: string;
  price: number;
  images: string[];
  isSold?: boolean;
  isAuction?: boolean;
  currentBid?: number;
  bidsCount?: number;
  timeLeft?: string;
  description: string;
  category: string[];
  condition: string;
  shippingFee: string;
  shippingMethod: string;
  origin: string;
  shippingDays: string;
  likesCount: number;
  isLiked?: boolean;
  seller: Seller;
  comments: CommentItem[];
  viewsCount?: number;
  brand?: string;
  size?: string;
  color?: string;
  shippingSize?: string;
  isAnonymousShipping?: boolean;
  isAuthenticityEligible?: boolean;
  sellerType?: 'individual' | 'shop';
  sku?: string;
  productFamilyId?: string;
  productFamilyName?: string;
  variantId?: string;
  variantName?: string;
  productType?: string;
  searchTags?: string[];
  attributes?: Record<string, string>;
  inventoryPolicy?: 'SINGLE' | 'MULTI';
  inventoryInitialQuantity?: number;
  inventoryQuantity?: number;
  reservedQuantity?: number;
  listingStatus?: 'DRAFT' | 'ACTIVE' | 'HELD' | 'RESERVED' | 'SOLD' | 'ARCHIVED';
  moderationStatus?: ModerationStatus;
  isDemo?: boolean;
  sourceUrl?: string;
  sourcePhotographer?: string;
  sourceAttribution?: string;
  sourceChecksum?: string;
  createdAt?: string;
  updatedAt?: string;
  soldAt?: string;
  viewedAt?: string;
  sellerId?: string;
  isCouponEligible?: boolean;
  discountRate?: number;
  isTimeSale?: boolean;
  isGuaranteeEligible?: boolean;
  qualityTier?: 'gold' | 'synthetic';
  auctionEndsAt?: string;
}

export type InventoryMovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'RESERVE' | 'RELEASE';

export interface InventoryMovement {
  id: string;
  itemId: string;
  sku?: string;
  type: InventoryMovementType;
  quantity: number;
  reason: string;
  referenceId?: string;
  at: string;
}

export interface NotificationItem {
  id: string;
  type: 'all' | 'you' | 'campaign';
  title: string;
  date: string;
  isRead: boolean;
  content: string;
  actorId?: string;
  eventId?: string;
}

export interface UserProfile {
  name: string;
  avatar: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  salesBalance: number;
  points: number;
  hasDPointLinked: boolean;
}

export type MainTab = 'home' | 'category' | 'notifications' | 'sell' | 'mypage';
export type HomeTab = 'recommend' | 'mylist' | 'auction';

export type ActorRole = 'guest' | 'buyer' | 'seller' | 'admin' | 'platform';

export interface SandboxActor {
  id: string;
  role: ActorRole;
  name: string;
  authenticated: boolean;
}

export interface ActorProfile {
  actorId: string;
  displayName: string;
  bio: string;
  avatar: string;
  rating: number;
  ratingsCount: number;
  completedSales: number;
  completedPurchases: number;
  isVerified: boolean;
  updatedAt: string;
}

export type ScenarioId =
  | 'catalog_default'
  | 'purchase_happy_path'
  | 'already_sold'
  | 'multi_inventory'
  | 'auction_outbid'
  | 'listing_policy_blocked'
  | 'zero_search_results'
  | 'payment_timeout'
  | 'delivery_delay';

export type TransactionStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'AWAITING_SHIPMENT'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'BUYER_REVIEWED'
  | 'SELLER_REVIEWED'
  | 'COMPLETED'
  | 'CANCEL_REQUESTED'
  | 'CANCELED'
  | 'REFUNDED';

export type PaymentStatus = 'INITIATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type ShipmentStatus = 'PENDING' | 'LABEL_READY' | 'HANDED_OVER' | 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION' | 'RETURNING';
export type ReservationStatus = 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
export type ModerationStatus = 'PENDING' | 'APPROVED' | 'HELD' | 'REJECTED' | 'APPEALED' | 'RESOLVED';

export interface PurchaseIntent {
  id: string;
  transactionId: string;
  itemId: string;
  buyerId: string;
  quantity: number;
  quote: number;
  createdAt: string;
  expiresAt: string;
  expectedStateVersion: number;
  status: ReservationStatus;
  couponDiscount?: number;
  pointsDiscount?: number;
}

export interface TransactionRecord {
  id: string;
  orderId: string;
  itemId: string;
  buyerId: string;
  sellerId: string;
  titleSnapshot: string;
  priceSnapshot: number;
  shippingCost: number;
  total: number;
  couponDiscount?: number;
  pointsUsed?: number;
  status: TransactionStatus;
  paymentId: string;
  shipmentId: string;
  reservationId: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  completedAt?: string;
  buyerReviewedAt?: string;
  sellerReviewedAt?: string;
  canceledAt?: string;
  cancelReason?: string;
  cancelPreviousStatus?: Extract<TransactionStatus, 'SHIPPED' | 'DELIVERED'>;
}

export interface PaymentRecord {
  id: string;
  transactionId: string;
  method: string;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentRecord {
  id: string;
  transactionId: string;
  method: string;
  trackingNumber?: string;
  status: ShipmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuctionBidRecord {
  id: string;
  itemId: string;
  bidderId: string;
  amount: number;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  transactionId: string;
  reviewerId: string;
  revieweeId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  createdAt: string;
}

export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'DECLINED' | 'IN_TRANSIT' | 'RECEIVED' | 'REFUND_COMPLETED';

export interface ReturnCase {
  id: string;
  transactionId: string;
  requesterId: string;
  reason: string;
  status: ReturnStatus;
  requestedAt: string;
  decidedAt?: string;
  receivedAt?: string;
  refundedAt?: string;
}

export interface TransactionMessage {
  id: string;
  transactionId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readBy: string[];
}

export type SupportTicketStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

export interface SupportTicket {
  id: string;
  transactionId?: string;
  reporterId: string;
  category: 'TRANSACTION' | 'LISTING' | 'PAYMENT' | 'DELIVERY' | 'SAFETY';
  subject: string;
  body: string;
  evidence: string[];
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PolicySignal {
  code: string;
  label: string;
  status: 'pass' | 'warning' | 'blocked';
  detail: string;
}

export interface PolicyDecision {
  allowed: boolean;
  status: ModerationStatus;
  ruleVersion: string;
  signals: PolicySignal[];
  decidedAt: string;
}

export interface DomainEvent {
  id: string;
  type: string;
  actorId: string;
  aggregateType: 'listing' | 'inventory' | 'transaction' | 'payment' | 'shipment' | 'auction' | 'moderation' | 'notification' | 'system';
  aggregateId: string;
  at: string;
  stateVersion: number;
  payload: Record<string, unknown>;
  correlationId: string;
}

export interface WalletSnapshot {
  actorId: string;
  availableBalance: number;
  heldBalance: number;
  points: number;
  ledger: Array<{ id: string; type: 'HOLD' | 'CAPTURE' | 'REFUND' | 'SALE' | 'FEE'; amount: number; referenceId: string; at: string }>;
}

export interface SandboxSnapshot {
  version: '1';
  scenarioId: ScenarioId;
  seed: string;
  now: string;
  stateVersion: number;
  currentActor: SandboxActor;
  actors: SandboxActor[];
  purchaseIntents: PurchaseIntent[];
  transactions: TransactionRecord[];
  payments: PaymentRecord[];
  shipments: ShipmentRecord[];
  bids: AuctionBidRecord[];
  reviews: ReviewRecord[];
  returns?: ReturnCase[];
  messages?: TransactionMessage[];
  supportTickets?: SupportTicket[];
  profiles?: ActorProfile[];
  events: DomainEvent[];
  notifications: NotificationItem[];
  wallets: WalletSnapshot[];
  invariantViolations: string[];
  pendingFailures: string[];
}

export type AgentErrorCode =
  | 'ITEM_NOT_FOUND'
  | 'ALREADY_SOLD'
  | 'BID_TOO_LOW'
  | 'NOT_AUCTION'
  | 'INVALID_INPUT'
  | 'DRAFT_NOT_FOUND'
  | 'INVALID_TAB'
  | 'CONFIRMATION_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'POLICY_REVIEW_REQUIRED'
  | 'POLICY_BLOCKED'
  | 'INVALID_ACTOR'
  | 'FORBIDDEN'
  | 'STATE_CONFLICT'
  | 'PURCHASE_INTENT_EXPIRED'
  | 'PAYMENT_FAILED'
  | 'TRANSACTION_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'UNKNOWN_SCENARIO'
  | 'AUCTION_ENDED'
  | 'INVALID_AMOUNT'
  | 'NO_RESULTS'
  | 'UNSUPPORTED_CATEGORY';

export type ActionResult<T = undefined> =
  | { ok: true; data: T; stateVersion: number; events?: DomainEvent[]; nextActions?: string[] }
  | {
      ok: false;
      error: AgentErrorCode;
      message?: string;
      stateVersion: number;
      details?: unknown;
    };

export interface AgentActionOptions {
  requestId?: string;
  idempotencyKey?: string;
  actorId?: string;
  expectedStateVersion?: number;
  commandId?: string;
  seed?: string;
  /** Explicitly separates operator controls from ordinary user commands. */
  scope?: 'user' | 'operator' | 'sandbox-control';
}

export interface PurchasePricing {
  couponDiscount?: number;
  pointsDiscount?: number;
}

export interface MercariAgentSnapshot {
  version: '1';
  stateVersion: number;
  currentMainTab: MainTab;
  currentHomeTab: HomeTab;
  currentCategory: string | null;
  searchQuery: string;
  selectedItemId: string | null;
  buyingItemId: string | null;
  searchHistory: string[];
  recentlyViewedIds: string[];
  savedItemIds: string[];
  itemsCount: number;
  items: MercariItem[];
  inventoryMovements?: InventoryMovement[];
  sandbox?: SandboxSnapshot;
}

export interface ActionTraceEntry {
  action: string;
  requestId?: string;
  idempotencyKey?: string;
  commandId?: string;
  payload: unknown;
  result: ActionResult<unknown>;
  at: string;
}

export interface MercariAgentAPI {
  navigateTab: (tab: MainTab, options?: AgentActionOptions) => ActionResult<undefined>;
  navigateHomeSubTab: (tab: HomeTab, options?: AgentActionOptions) => ActionResult<undefined>;
  navigateCategory: (category: string, options?: AgentActionOptions) => ActionResult<undefined>;
  search: (query: string, options?: AgentActionOptions) => ActionResult<undefined>;
  openItem: (itemId: string, options?: AgentActionOptions) => ActionResult<undefined>;
  closeItem: (options?: AgentActionOptions) => ActionResult<undefined>;
  setLiked: (
    itemId: string,
    liked: boolean,
    options?: AgentActionOptions,
  ) => ActionResult<undefined>;
  setSaved: (itemId: string, saved: boolean, options?: AgentActionOptions) => ActionResult<undefined>;
  likeItem: (itemId: string, options?: AgentActionOptions) => ActionResult<undefined>;
  addComment: (itemId: string, text: string, options?: AgentActionOptions) => ActionResult<undefined>;
  listItem: (
    item: Partial<MercariItem>,
    options?: AgentActionOptions,
  ) => ActionResult<MercariItem>;
  createListingDraft: (
    item: Partial<MercariItem>,
    options?: AgentActionOptions,
  ) => ActionResult<{ draftId: string }>;
  updateListingDraft: (
    draftId: string,
    item: Partial<MercariItem>,
    options?: AgentActionOptions,
  ) => ActionResult<{ draftId: string }>;
  submitListing: (
    draftId: string,
    options?: AgentActionOptions,
  ) => ActionResult<{ itemId: string }>;
  startPurchase: (
    itemId: string,
    options?: AgentActionOptions,
  ) => ActionResult<{ purchaseIntentId: string; transactionId: string; expiresAt: string; quote: number }>;
  confirmPurchase: (
    purchaseIntentId: string,
    options?: AgentActionOptions,
  ) => ActionResult<{ transactionId: string; orderId: string; status: TransactionStatus; total: number }>;
  placeBid: (
    itemId: string,
    amount: number,
    options?: AgentActionOptions,
  ) => ActionResult<{ currentBid: number; bidsCount: number }>;
  closeAuction: (itemId: string, options?: AgentActionOptions) => ActionResult<{ itemId: string; transactionId?: string; status: 'SETTLED' | 'NO_BIDS' | 'PAYMENT_FAILED' }>;
  buyItem: (itemId: string, options?: AgentActionOptions) => ActionResult<{ purchaseIntentId: string; transactionId: string; expiresAt: string; quote: number }>;
  shipOrder: (transactionId: string, options?: AgentActionOptions) => ActionResult<{ transactionId: string; status: TransactionStatus }>;
  markDelivered: (transactionId: string, options?: AgentActionOptions) => ActionResult<{ transactionId: string; status: TransactionStatus }>;
  reviewOrder: (transactionId: string, rating: 1 | 2 | 3 | 4 | 5, comment?: string, options?: AgentActionOptions) => ActionResult<{ transactionId: string; status: TransactionStatus }>;
  cancelOrder: (transactionId: string, reason: string, options?: AgentActionOptions) => ActionResult<{ transactionId: string; status: TransactionStatus }>;
  resolveCancellation: (transactionId: string, approve: boolean, options?: AgentActionOptions) => ActionResult<{ transactionId: string; status: TransactionStatus }>;
  reviewListing: (itemId: string, approve: boolean, options?: AgentActionOptions) => ActionResult<MercariItem>;
  requestReturn: (transactionId: string, reason: string, options?: AgentActionOptions) => ActionResult<{ returnCaseId: string; status: ReturnStatus }>;
  confirmReturnReceived: (transactionId: string, options?: AgentActionOptions) => ActionResult<{ returnCaseId: string; status: ReturnStatus }>;
  sendTransactionMessage: (transactionId: string, body: string, options?: AgentActionOptions) => ActionResult<TransactionMessage>;
  createSupportTicket: (input: Partial<SupportTicket>, options?: AgentActionOptions) => ActionResult<SupportTicket>;
  reportTransaction: (transactionId: string, body: string, options?: AgentActionOptions) => ActionResult<SupportTicket>;
  updateListing: (itemId: string, input: Partial<MercariItem>, options?: AgentActionOptions) => ActionResult<MercariItem>;
  pauseListing: (itemId: string, options?: AgentActionOptions) => ActionResult<MercariItem>;
  resumeListing: (itemId: string, options?: AgentActionOptions) => ActionResult<MercariItem>;
  relistItem: (itemId: string, options?: AgentActionOptions) => ActionResult<MercariItem>;
  switchActor: (actorId: string, options?: AgentActionOptions) => ActionResult<SandboxActor>;
  loadScenario: (scenarioId: ScenarioId, options?: AgentActionOptions) => ActionResult<{ scenarioId: ScenarioId; seed: string; now: string }>;
  advanceClock: (milliseconds: number, options?: AgentActionOptions) => ActionResult<{ now: string; expiredPurchaseIntentIds: string[] }>;
  injectFailure: (failure: string, options?: AgentActionOptions) => ActionResult<{ pendingFailures: string[] }>;
  getCapabilities: () => { apiVersion: '1'; scenarios: ScenarioId[]; actors: SandboxActor[]; commands: string[]; errorCodes: AgentErrorCode[] };
  getSandboxSnapshot: () => SandboxSnapshot;
  getTransactions: (actorId?: string) => TransactionRecord[];
  getDomainEvents: () => DomainEvent[];
  exportState: (options?: AgentActionOptions) => ActionResult<string>;
  importState: (serialized: string, options?: AgentActionOptions) => ActionResult<{ stateVersion: number }>;
  getSnapshot: () => MercariAgentSnapshot;
  getItems: () => MercariItem[];
  getItem: (itemId: string) => ActionResult<MercariItem>;
  searchItems: (query: string) => MercariItem[];
  getState: () => MercariAgentSnapshot;
  getActionTrace: () => ActionTraceEntry[];
  getInventoryMovements: (itemId?: string, options?: AgentActionOptions) => InventoryMovement[];
  getProfile: (actorId?: string) => ActorProfile | undefined;
  updateProfile: (input: Partial<ActorProfile>, options?: AgentActionOptions) => ActionResult<ActorProfile>;
  resetScenario: (options?: AgentActionOptions & { scenarioId?: ScenarioId }) => ActionResult<undefined>;
}

declare global {
  interface Window {
    __MERCARI_API__?: MercariAgentAPI;
    __SHOP_API__?: MercariAgentAPI;
  }
}
