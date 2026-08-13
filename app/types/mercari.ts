export interface Seller {
  name: string;
  avatar: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  level?: number;
}

export interface CommentItem {
  id: string;
  userName: string;
  userAvatar: string;
  text: string;
  date: string;
}

export interface MercariItem {
  id: string;
  listingId?: string;
  sellerId?: string;
  listingStatus?: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'RESERVED' | 'TRANSACTION_STARTED' | 'SOLD' | 'DELETED' | 'REMOVED_BY_MODERATION';
  listingVersion?: number;
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
}

export interface NotificationItem {
  id: string;
  type: 'all' | 'you' | 'campaign';
  title: string;
  date: string;
  isRead: boolean;
  content: string;
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

export interface SandboxPersona {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  role: string;
  accent: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  salesBalance: number;
  points: number;
  listingsCount: number;
  activeTransactionsCount: number;
  pendingTasksCount: number;
}

export interface SandboxActivityEntry {
  id: string;
  type: string;
  title: string;
  description: string;
  actorId: string;
  actorName: string;
  transactionId?: string;
  at: string;
}

export type MainTab = 'home' | 'category' | 'notifications' | 'sell' | 'mypage';
export type HomeTab = 'recommend' | 'mylist' | 'auction';

export type AgentErrorCode =
  | 'ITEM_NOT_FOUND'
  | 'ALREADY_SOLD'
  | 'LISTING_UNAVAILABLE'
  | 'LISTING_VERSION_CONFLICT'
  | 'CANNOT_PURCHASE_OWN_LISTING'
  | 'USER_BLOCKED'
  | 'PAYMENT_NOT_COMPLETED'
  | 'CHECKOUT_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'RATING_NOT_ALLOWED'
  | 'BID_TOO_LOW'
  | 'NOT_AUCTION'
  | 'INVALID_INPUT'
  | 'DRAFT_NOT_FOUND'
  | 'INVALID_TAB'
  | 'USER_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'CONFIRMATION_REQUIRED'
  | 'INSUFFICIENT_FUNDS'
  | 'AUTH_REQUIRED';

export type ActionResult<T = undefined> =
  | { ok: true; data: T; stateVersion: number }
  | {
      ok: false;
      error: AgentErrorCode;
      message?: string;
      stateVersion: number;
    };

export interface AgentActionOptions {
  requestId?: string;
  idempotencyKey?: string;
}

export interface MercariAgentSnapshot {
  version: '1';
  stateVersion: number;
  currentUserId: string;
  personas: SandboxPersona[];
  activeTransactionsCount: number;
  openTasksCount: number;
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
}

export interface ActionTraceEntry {
  action: string;
  actorId?: string;
  requestId?: string;
  idempotencyKey?: string;
  payload: unknown;
  result: ActionResult<unknown>;
  at: string;
}

export interface MercariAgentAPI {
  switchPersona: (userId: string, options?: AgentActionOptions) => ActionResult<SandboxPersona>;
  getPersonas: () => SandboxPersona[];
  getWorldState: () => unknown;
  getActivity: (limit?: number) => SandboxActivityEntry[];
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
  listItem: (
    item: Partial<MercariItem>,
    options?: AgentActionOptions,
  ) => ActionResult<MercariItem>;
  createListingDraft: (
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
  ) => ActionResult<undefined>;
  confirmPurchase: (
    itemId: string,
    options?: AgentActionOptions,
  ) => ActionResult<undefined>;
  placeBid: (
    itemId: string,
    amount: number,
    options?: AgentActionOptions,
  ) => ActionResult<{ currentBid: number; bidsCount: number }>;
  completePayment: (transactionId: string, options?: AgentActionOptions) => ActionResult<undefined>;
  markAsShipped: (transactionId: string, options?: AgentActionOptions) => ActionResult<undefined>;
  advanceShipment: (transactionId: string, options?: AgentActionOptions) => ActionResult<undefined>;
  rateTransaction: (transactionId: string, rating: number, comment?: string, options?: AgentActionOptions) => ActionResult<undefined>;
  buyItem: (itemId: string, options?: AgentActionOptions) => ActionResult<undefined>;
  getSnapshot: () => MercariAgentSnapshot;
  getItems: () => MercariItem[];
  getItem: (itemId: string) => ActionResult<MercariItem>;
  searchItems: (query: string) => MercariItem[];
  getState: () => MercariAgentSnapshot;
  getActionTrace: () => ActionTraceEntry[];
  resetScenario: (options?: AgentActionOptions) => ActionResult<undefined>;
}

declare global {
  interface Window {
    __FURIMA_SANDBOX_API__?: MercariAgentAPI;
    __MERCARI_API__?: MercariAgentAPI;
    __SHOP_API__?: MercariAgentAPI;
  }
}
