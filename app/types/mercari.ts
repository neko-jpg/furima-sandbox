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
  listingStatus?: 'DRAFT' | 'ACTIVE' | 'RESERVED' | 'SOLD' | 'ARCHIVED';
  isDemo?: boolean;
  sourceUrl?: string;
  sourcePhotographer?: string;
  sourceAttribution?: string;
  sourceChecksum?: string;
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
  | 'POLICY_REVIEW_REQUIRED';

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
}

export interface ActionTraceEntry {
  action: string;
  requestId?: string;
  idempotencyKey?: string;
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
  buyItem: (itemId: string, options?: AgentActionOptions) => ActionResult<undefined>;
  getSnapshot: () => MercariAgentSnapshot;
  getItems: () => MercariItem[];
  getItem: (itemId: string) => ActionResult<MercariItem>;
  searchItems: (query: string) => MercariItem[];
  getState: () => MercariAgentSnapshot;
  getActionTrace: () => ActionTraceEntry[];
  getInventoryMovements: (itemId?: string, options?: AgentActionOptions) => InventoryMovement[];
  resetScenario: (options?: AgentActionOptions) => ActionResult<undefined>;
}

declare global {
  interface Window {
    __MERCARI_API__?: MercariAgentAPI;
    __SHOP_API__?: MercariAgentAPI;
  }
}
