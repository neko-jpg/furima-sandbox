import type { components } from "./openapi";

export interface Seller {
  name: string;
  avatar: string;
  avatarRef?: string;
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

export type ListingMediaStatus = 'processing' | 'ready' | 'error';

/**
 * Metadata kept in listing/domain state. The binary image is stored by the
 * local media adapter (IndexedDB) or by the future R2 adapter, never in the
 * sandbox state payload.
 */
export interface ListingMediaRef {
  id: string;
  source: 'camera' | 'album' | 'legacy';
  status: ListingMediaStatus;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif';
  width?: number;
  height?: number;
  byteSize?: number;
  thumbnailRef?: string;
  createdAt: string;
  errorCode?: string;
}

export interface ListingImageOrder {
  mediaId: string;
  order: number;
  isCover: boolean;
}

export interface ListingDraft {
  draftId: string;
  name?: string;
  fields: Partial<MercariItem>;
  media: ListingMediaRef[];
  imageOrder: ListingImageOrder[];
  updatedAt: string;
}

export type MercariItem = Omit<components["schemas"]["MercariItem"], "condition" | "images"> & {
  condition: string;
  images: string[];
  sellerId?: string;
  isLiked?: boolean;
  likesCount: number;
  seller: Seller;
  comments: CommentItem[];
  viewsCount?: number;
  viewedAt?: string;
  isSold?: boolean;
  isAuction?: boolean;
  currentBid?: number;
  bidsCount?: number;
  timeLeft?: string;
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
  auctionEndsAt?: string;
  inventoryUpdatedAt?: string;
  qualityTier?: string;
  isCouponEligible?: boolean;
  discountRate?: number;
  isTimeSale?: boolean;
  isGuaranteeEligible?: boolean;
  soldAt?: string;
  inventoryInitialQuantity?: number;
};

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
  avatarRef?: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  salesBalance: number;
  points: number;
  hasDPointLinked: boolean;
}

export type MainTab = 'home' | 'category' | 'notifications' | 'sell' | 'mypage';
export type HomeTab = 'recommend' | 'mylist' | 'auction';
export type MyPagePanel = 'listings' | 'purchases' | 'drafts' | 'followers' | 'settings' | 'help' | 'wallet' | 'profile';

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
  /** IndexedDB/R2 media reference. Binary data never belongs in Sandbox state. */
  avatarRef?: string;
  rating: number;
  ratingsCount: number;
  completedSales: number;
  completedPurchases: number;
  isVerified: boolean;
  updatedAt: string;
}

export type FollowDirection = 'following' | 'followers';

export interface FollowRelation {
  id: string;
  followerId: string;
  followeeId: string;
  createdAt: string;
}

export interface FollowSummary {
  actorId: string;
  followingCount: number;
  followerCount: number;
  isFollowing: boolean;
}

export interface FollowListResult {
  actorId: string;
  direction: FollowDirection;
  users: ActorProfile[];
  summary: FollowSummary;
}

export interface FollowMutationResult {
  actorId: string;
  targetActorId: string;
  following: boolean;
  relation?: FollowRelation;
  summary: FollowSummary;
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
  /** Starting balance used when replaying the ledger, including migrated state. */
  openingBalance: number;
  availableBalance: number;
  heldBalance: number;
  points: number;
  ledger: Array<{ id: string; type: WalletLedgerType; amount: number; referenceId: string; at: string }>;
}

export type WalletLedgerType = 'DEPOSIT' | 'WITHDRAWAL' | 'HOLD' | 'CAPTURE' | 'REFUND' | 'SALE' | 'FEE';

export interface SandboxSnapshot {
  version: '1';
  sandboxId: string;
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
  follows: FollowRelation[];
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
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_EXPIRED'
  | 'AUCTION_ENDED'
  | 'INVALID_AMOUNT'
  | 'INSUFFICIENT_FUNDS'
  | 'WALLET_NOT_FOUND'
  | 'FOLLOW_TARGET_NOT_FOUND'
  | 'ALREADY_FOLLOWING'
  | 'NOT_FOLLOWING'
  | 'CANNOT_FOLLOW_SELF'
  | 'NO_RESULTS'
  | 'UNSUPPORTED_CATEGORY'
  | 'SANDBOX_NOT_READY'
  | 'D1_UNAVAILABLE'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_STATE'
  | 'REPLAY_FAILED'
  | 'STATE_NOT_FOUND'
  | 'INVALID_STATE_ID'
  | 'AUTH_NOT_CONFIGURED'
  | 'FEATURE_NOT_AVAILABLE';

export type ActionResult<T = undefined> =
  | { ok: true; data: T; stateVersion: number; meta?: ActionMetadata; events?: DomainEvent[]; nextActions?: string[] }
  | {
      ok: false;
      error: AgentErrorCode;
      message?: string;
      stateVersion: number;
      meta?: ActionMetadata;
      details?: unknown;
    };

export interface ActionMetadata {
  sandboxId: string;
  actorId: string;
  stateVersion: number;
  operationId: string;
  commandId?: string;
  requestId?: string;
  idempotencyKey?: string;
  mode: 'preview' | 'commit';
}

export interface AgentActionOptions {
  requestId?: string;
  idempotencyKey?: string;
  actorId?: string;
  sandboxId?: string;
  operationId?: string;
  expectedStateVersion?: number;
  commandId?: string;
  seed?: string;
  mode?: 'preview' | 'commit';
  /** Explicitly separates operator controls from ordinary user commands. */
  scope?: 'user' | 'operator' | 'sandbox-control';
}

export interface PurchasePricing {
  couponDiscount?: number;
  pointsDiscount?: number;
}

export interface MercariAgentSnapshot {
  version: '1';
  sandboxId: string;
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

export type PreviewCommand = 'purchase' | 'listing.create' | 'wallet.deposit' | 'wallet.withdraw';

export interface ActionPreview {
  previewId: string;
  command: PreviewCommand;
  payload: unknown;
  createdAt: string;
  expiresAt: string;
  stateVersion: number;
  sandboxId: string;
  actorId: string;
  summary: Record<string, unknown>;
}

export interface ListingDraftSummary {
  draftId: string;
  fields: Partial<MercariItem>;
  updatedAt: string;
}

export interface CatalogListInput {
  offset?: number;
  limit?: number;
  query?: string;
  category?: string;
}

export interface CatalogListResult {
  items: MercariItem[];
  total: number;
  offset: number;
  limit: number;
  stateVersion: number;
}

export type SaveListingDraftInput = Partial<MercariItem> & { draftId?: string };

export interface MercariAgentAPI {
  waitForReady: () => Promise<ActionResult<{ sandboxId: string; stateVersion: number }>>;
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
  getListingDrafts: (options?: AgentActionOptions) => ActionResult<ListingDraftSummary[]>;
  saveListingDraft: (item: SaveListingDraftInput, options?: AgentActionOptions) => ActionResult<{ draftId: string }>;
  deleteListingDraft: (draftId: string, options?: AgentActionOptions) => ActionResult<{ draftId: string }>;
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
  listOwnListings: (options?: AgentActionOptions) => ActionResult<MercariItem[]>;
  catalog: {
    list: (input?: CatalogListInput, options?: AgentActionOptions) => ActionResult<CatalogListResult>;
    get: (itemId: string, options?: AgentActionOptions) => ActionResult<MercariItem>;
  };
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
  getFollowList: (direction: FollowDirection, options?: AgentActionOptions) => ActionResult<FollowListResult>;
  getFollowSummary: (actorId?: string, options?: AgentActionOptions) => ActionResult<FollowSummary>;
  followUser: (actorId: string, options?: AgentActionOptions) => ActionResult<FollowMutationResult>;
  unfollowUser: (actorId: string, options?: AgentActionOptions) => ActionResult<FollowMutationResult>;
  getWallet: (options?: AgentActionOptions) => ActionResult<WalletSnapshot>;
  depositWallet: (amount: number, options?: AgentActionOptions) => ActionResult<WalletSnapshot>;
  withdrawWallet: (amount: number, options?: AgentActionOptions) => ActionResult<WalletSnapshot>;
  resetScenario: (options?: AgentActionOptions & { scenarioId?: ScenarioId }) => ActionResult<undefined>;
  previewAction: (command: PreviewCommand, payload: unknown, options?: AgentActionOptions) => ActionResult<ActionPreview>;
  commitPreview: (previewId: string, options?: AgentActionOptions) => ActionResult<unknown>;
  subscribe: (handler: (event: DomainEvent) => void) => () => void;
}

declare global {
  interface Window {
    __MERCARI_API__?: MercariAgentAPI;
    __SHOP_API__?: MercariAgentAPI;
    __FURIMA_SANDBOX_DIAGNOSTICS__?: {
      backend: 'indexeddb' | 'memory';
      ready: boolean;
      fallbackReason?: 'UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'CORRUPTED' | 'VERSION_MISMATCH';
      migratedLegacyLocalStorage: boolean;
    };
  }
}
