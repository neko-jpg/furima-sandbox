import type { CommentItem, MercariItem } from '../types/mercari';

/*
 * The UI still consumes MercariItem, but all business decisions live here.
 * A Listing is an offer for an Item; a Transaction is the lifecycle created
 * from a CheckoutSession. Keeping those records separate makes the demo safe
 * to extend without teaching every component marketplace rules.
 */

export type EntityId = string;
export type ItemCondition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'VERY_POOR';
export type UserStatus = 'ACTIVE' | 'RESTRICTED' | 'BANNED';
export type IdentityVerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED';
export type ListingStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'RESERVED' | 'TRANSACTION_STARTED' | 'SOLD' | 'DELETED' | 'REMOVED_BY_MODERATION';
export type ListingAvailability = 'AVAILABLE' | 'LOCKED_FOR_TRANSACTION';
export type SaleType = 'FIXED_PRICE' | 'AUCTION';
export type ShippingPayer = 'SELLER' | 'BUYER';
export type ShippingMethod = 'MERCARI_STANDARD' | 'MERCARI_COMPACT' | 'POST' | 'PICKUP' | 'OTHER';
export type PackageSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'OVERSIZE';
export type PaymentMethodType = 'CREDIT_CARD' | 'BALANCE' | 'POINTS' | 'CONVENIENCE_STORE' | 'ATM';
export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUND_PENDING' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type TransactionStatus = 'CREATED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
export type FulfillmentStatus = 'AWAITING_PAYMENT' | 'AWAITING_SHIPMENT' | 'SHIPPED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURNING' | 'RETURNED';
export type ShipmentStatus = 'NOT_SHIPPED' | 'SHIPPED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'AT_PICKUP_LOCATION' | 'RETURNED_TO_SELLER' | 'LOST' | 'DELIVERY_FAILED';
export type RatingStatus = 'PENDING' | 'COMPLETED';
export type DisputeStatus = 'NONE' | 'OPEN' | 'RESOLVED';
export type CheckoutStatus = 'OPEN' | 'CONFIRMED' | 'CANCELED' | 'EXPIRED';

export interface User {
  id: EntityId;
  displayName: string;
  avatar: string;
  bio: string;
  createdAt: string;
  status: UserStatus;
  identityVerificationStatus: IdentityVerificationStatus;
  phoneVerified: boolean;
  ratingSummary: { average: number; count: number; positiveCount: number };
  sellerLevel: number;
  salesBalance: number;
  points: number;
}

export interface Address {
  id: EntityId;
  userId: EntityId;
  label: string;
  postalCode: string;
  prefecture: string;
  city: string;
  line1: string;
  isDefault: boolean;
}

export interface PaymentMethod {
  id: EntityId;
  userId: EntityId;
  type: PaymentMethodType;
  label: string;
  isDefault: boolean;
}

export interface UserPreference {
  userId: EntityId;
  notificationEnabled: boolean;
  language: 'ja' | 'en';
}

export interface Item {
  id: EntityId;
  title: string;
  description: string;
  condition: ItemCondition;
  defectDescription: string;
}

export interface ListingImage {
  id: EntityId;
  listingId: EntityId;
  url: string;
  sortOrder: number;
  width?: number;
  height?: number;
}

export interface Listing {
  id: EntityId;
  itemId: EntityId;
  sellerId: EntityId;
  categoryId: string;
  brandId?: string;
  attributes: Record<string, string>;
  price: number;
  saleType: SaleType;
  shippingPayer: ShippingPayer;
  shippingMethod: ShippingMethod;
  shippingOrigin: string;
  shippingDays: number;
  packageSize: PackageSize;
  isAnonymous: boolean;
  status: ListingStatus;
  availability: ListingAvailability;
  quantity: 1;
  createdAt: string;
  publishedAt?: string;
  updatedAt: string;
  version: number;
  viewsCount: number;
  searchCount: number;
  likesCount: number;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
}

export interface CategoryAttributeDefinition {
  id: string;
  categoryId: string;
  key: string;
  label: string;
  required: boolean;
  options?: string[];
}

export interface ListingAttributeValue {
  listingId: string;
  definitionId: string;
  value: string;
}

export interface ShippingAddressSnapshot {
  postalCode: string;
  prefecture: string;
  city: string;
  line1: string;
  maskedForSeller: boolean;
}

export interface CheckoutSession {
  id: EntityId;
  buyerId: EntityId;
  listingId: EntityId;
  paymentMethodId: EntityId;
  shippingAddressId: EntityId;
  deliveryPreference?: string;
  couponId?: string;
  pointsUsed: number;
  itemPrice: number;
  paymentFee: number;
  shippingCharge: number;
  discount: number;
  total: number;
  listingVersion: number;
  status: CheckoutStatus;
  createdAt: string;
  expiresAt: string;
}

export interface Payment {
  id: EntityId;
  transactionId: EntityId;
  method: PaymentMethodType;
  amount: number;
  fee: number;
  pointsUsed: number;
  balanceUsed: number;
  status: PaymentStatus;
  paidAt?: string;
}

export interface Shipment {
  id: EntityId;
  transactionId: EntityId;
  carrier: string;
  service: string;
  trackingNumber?: string;
  packageSize: PackageSize;
  shippingFee: number;
  senderPays: boolean;
  anonymous: boolean;
  origin: string;
  destination: ShippingAddressSnapshot;
  status: ShipmentStatus;
  shippedAt?: string;
  deliveredAt?: string;
}

export interface Transaction {
  id: EntityId;
  listingId: EntityId;
  sellerId: EntityId;
  buyerId: EntityId;
  transactionStatus: TransactionStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  buyerRatingStatus: RatingStatus;
  sellerRatingStatus: RatingStatus;
  disputeStatus: DisputeStatus;
  paymentId: EntityId;
  shipmentId: EntityId;
  checkoutId: EntityId;
  shippingAddressSnapshot: ShippingAddressSnapshot;
  expectedListingVersion: number;
  itemPrice: number;
  platformFee: number;
  shippingFee: number;
  total: number;
  shippingDeadline: string;
  createdAt: string;
  completedAt?: string;
  canceledAt?: string;
}

export interface Rating {
  id: EntityId;
  transactionId: EntityId;
  fromUserId: EntityId;
  toUserId: EntityId;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface SellerProceeds {
  id: EntityId;
  transactionId: EntityId;
  sellerId: EntityId;
  gross: number;
  platformFee: number;
  shippingFee: number;
  adjustments: number;
  net: number;
  status: 'PENDING' | 'CONFIRMED' | 'PAID_OUT';
  createdAt: string;
}

export interface ListingComment extends CommentItem {
  listingId: string;
  authorId: string;
  body: string;
  createdAt: string;
  status: 'ACTIVE' | 'DELETED' | 'REPORTED';
}

export interface TransactionMessage {
  id: string;
  transactionId: string;
  senderId: string;
  body: string;
  attachments: string[];
  createdAt: string;
}

export interface UserBlock { blockerId: string; blockedId: string; createdAt: string }
export interface Follow { followerId: string; followedUserId: string; createdAt: string }
export interface Like { userId: string; listingId: string; createdAt: string }
export interface SavedItem { userId: string; listingId: string; createdAt: string }
export interface Collection { id: string; userId: string; name: string; createdAt: string }
export interface CollectionItem { collectionId: string; listingId: string; createdAt: string }

export type CancellationStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'COMPLETED';
export interface CancellationRequest {
  id: string; transactionId: string; requestedBy: string; reason: string; reasonDetail: string;
  returnRequired: boolean; status: CancellationStatus; createdAt: string; respondedAt?: string;
}

export type ReturnStatus = 'REQUESTED' | 'AGREED' | 'AWAITING_RETURN_SHIPMENT' | 'RETURN_SHIPPED' | 'RETURN_DELIVERED' | 'SELLER_CONFIRMED' | 'COMPLETED';
export interface ReturnRequest {
  id: string; transactionId: string; reason: string; shippingMethod?: string; trackingNumber?: string; status: ReturnStatus;
}

export type RefundType = 'FULL' | 'PARTIAL';
export type RefundStatus = 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export interface Refund { id: string; transactionId: string; paymentId: string; amount: number; type: RefundType; reason: string; status: RefundStatus }

export type DisputeCategory = 'ITEM_NOT_RECEIVED' | 'ITEM_NOT_AS_DESCRIBED' | 'DAMAGED' | 'COUNTERFEIT_SUSPECTED' | 'WRONG_ITEM' | 'OTHER';
export interface Dispute { id: string; transactionId: string; openedBy: string; category: DisputeCategory; description: string; attachments: string[]; status: DisputeStatus }

export type PriceRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELED_BY_LISTING_CHANGE';
export interface PriceRequest { id: string; listingId: string; buyerId: string; requestedPrice: number; status: PriceRequestStatus; expiresAt: string }
export type BundleRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'INVALIDATED';
export interface BundleRequest { id: string; buyerId: string; sellerId: string; listingIds: string[]; requestedTotalPrice: number; status: BundleRequestStatus; expiresAt: string; bundleListingId?: string }

export type AuctionStatus = 'SCHEDULED' | 'OPEN' | 'ENDED' | 'AWAITING_WINNER_PURCHASE' | 'PURCHASED' | 'EXPIRED' | 'CANCELED';
export interface Auction { id: string; listingId: string; startPrice: number; startsAt: string; endsAt: string; status: AuctionStatus; highestBidId?: string; winnerId?: string; purchaseDeadline?: string }
export interface Bid { id: string; auctionId: string; bidderId: string; amount: number; createdAt: string }

export type NotificationType = 'LISTING_LIKED' | 'LISTING_COMMENTED' | 'PRICE_DROPPED' | 'PRICE_REQUEST_RECEIVED' | 'PRICE_REQUEST_ACCEPTED' | 'TRANSACTION_CREATED' | 'PAYMENT_COMPLETED' | 'SHIPMENT_REQUIRED' | 'ITEM_SHIPPED' | 'ITEM_DELIVERED' | 'RATING_REQUIRED' | 'TRANSACTION_COMPLETED' | 'AUCTION_OUTBID' | 'AUCTION_ENDING' | 'AUCTION_WON' | 'CANCELLATION_REQUESTED' | 'RETURN_REQUIRED' | 'REFUND_COMPLETED' | 'SAVED_SEARCH_MATCH' | 'SYSTEM';
export interface Notification { id: string; userId: string; type: NotificationType; entityType: string; entityId: string; payload: Record<string, unknown>; isRead: boolean; createdAt: string; title: string; content: string }
export type TaskType = 'PAYMENT_REQUIRED' | 'SHIPMENT_REQUIRED' | 'BUYER_RATING_REQUIRED' | 'SELLER_RATING_REQUIRED' | 'RETURN_REQUIRED' | 'DISPUTE_REQUIRED';
export interface Task { id: string; userId: string; type: TaskType; entityId: string; dueAt?: string; completedAt?: string }

export type ReportTargetType = 'LISTING' | 'COMMENT' | 'MESSAGE' | 'USER';
export interface Report { id: string; reporterId: string; targetType: ReportTargetType; targetId: string; category: string; detail: string; createdAt: string }
export type ModerationAction = 'WARN' | 'PAUSE_LISTING' | 'REMOVE_LISTING' | 'RESTRICT_USER' | 'BAN_USER';
export interface ModerationCase { id: string; entityType: ReportTargetType; entityId: string; reason: string; reportedBy: string; status: 'OPEN' | 'REVIEWING' | 'RESOLVED'; action?: ModerationAction }
export interface ListingRevision { listingId: string; version: number; changedFields: string[]; changedAt: string }
export interface TransactionEvent { id: string; transactionId: string; type: string; actorId: string; payload: Record<string, unknown>; createdAt: string }

export interface SavedSearch { id: string; userId: string; name: string; query: string; filters: SearchFilters; notificationEnabled: boolean; notificationFrequency: 'INSTANT' | 'DAILY' | 'WEEKLY'; createdAt: string }
export interface SearchFilters { category?: string; brand?: string; condition?: ItemCondition; priceMin?: number; priceMax?: number; shippingPayer?: ShippingPayer; shippingMethod?: ShippingMethod; shippingDays?: number; sellerType?: string; saleType?: SaleType; availability?: 'AVAILABLE' | 'SOLD' }

export interface MarketplaceState {
  version: '1'; stateVersion: number; currentUserId: string;
  users: User[]; addresses: Address[]; paymentMethods: PaymentMethod[]; preferences: UserPreference[];
  items: Item[]; listings: Listing[]; listingImages: ListingImage[]; categories: Category[]; categoryAttributeDefinitions: CategoryAttributeDefinition[]; listingAttributeValues: ListingAttributeValue[];
  listingComments: ListingComment[]; transactionMessages: TransactionMessage[]; likes: Like[]; savedItems: SavedItem[]; collections: Collection[]; collectionItems: CollectionItem[]; follows: Follow[]; blocks: UserBlock[];
  checkouts: CheckoutSession[]; transactions: Transaction[]; payments: Payment[]; shipments: Shipment[]; ratings: Rating[]; proceeds: SellerProceeds[];
  cancellations: CancellationRequest[]; returns: ReturnRequest[]; refunds: Refund[]; disputes: Dispute[]; priceRequests: PriceRequest[]; bundleRequests: BundleRequest[]; auctions: Auction[]; bids: Bid[];
  notifications: Notification[]; tasks: Task[]; reports: Report[]; moderationCases: ModerationCase[]; listingRevisions: ListingRevision[]; transactionEvents: TransactionEvent[]; savedSearches: SavedSearch[];
}

export type DomainErrorCode = 'AUTH_REQUIRED' | 'USER_NOT_FOUND' | 'LISTING_NOT_FOUND' | 'ITEM_NOT_FOUND' | 'TRANSACTION_NOT_FOUND' | 'CHECKOUT_NOT_FOUND' | 'PAYMENT_NOT_FOUND' | 'SHIPMENT_NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_LISTING' | 'LISTING_UNAVAILABLE' | 'LISTING_VERSION_CONFLICT' | 'CANNOT_PURCHASE_OWN_LISTING' | 'USER_BLOCKED' | 'PAYMENT_NOT_COMPLETED' | 'INVALID_TRANSITION' | 'RATING_NOT_ALLOWED' | 'TRANSACTION_COMPLETED' | 'AUCTION_NOT_FOUND' | 'NOT_AUCTION' | 'AUCTION_CLOSED' | 'BID_TOO_LOW' | 'PRICE_REQUEST_NOT_ALLOWED' | 'BUNDLE_NOT_ALLOWED' | 'REQUEST_NOT_FOUND' | 'DISPUTE_NOT_ALLOWED' | 'PERMISSION_DENIED';
export type DomainResult<T> = { ok: true; data: T; stateVersion: number } | { ok: false; error: DomainErrorCode; message: string; stateVersion: number };

const nowIso = (now = new Date()) => now.toISOString();
const id = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const ok = <T,>(data: T, stateVersion: number): DomainResult<T> => ({ ok: true, data, stateVersion });
const fail = <T,>(error: DomainErrorCode, stateVersion: number, message: string): DomainResult<T> => ({ ok: false, error, stateVersion, message });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ン一-龥]+/gu, '-').replace(/^-|-$/g, '') || 'user';
const conditionFromLegacy = (value: string): ItemCondition => ({ '新品、未使用': 'NEW', '未使用に近い': 'LIKE_NEW', '目立った傷や汚れなし': 'GOOD', 'やや傷や汚れあり': 'FAIR', '傷や汚れあり': 'POOR', '全体的に状態が悪い': 'VERY_POOR' }[value] as ItemCondition ?? 'GOOD');
const conditionToLegacy = (value: ItemCondition) => ({ NEW: '新品、未使用', LIKE_NEW: '未使用に近い', GOOD: '目立った傷や汚れなし', FAIR: 'やや傷や汚れあり', POOR: '傷や汚れあり', VERY_POOR: '全体的に状態が悪い' }[value]);
const shippingMethodFromLegacy = (value: string): ShippingMethod => value.includes('ゆう') || value.includes('らくらく') ? 'MERCARI_STANDARD' : value.includes('郵便') ? 'POST' : 'OTHER';
const shippingLabel = (value: ShippingMethod) => ({ MERCARI_STANDARD: 'メルカリ便', MERCARI_COMPACT: 'メルカリ便コンパクト', POST: '普通郵便', PICKUP: '手渡し', OTHER: 'その他' }[value]);
const shippingDaysFromLegacy = (value: string) => Number(value.match(/\d+/)?.[0] ?? 2);
const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
const immediatePayment = (method: PaymentMethodType) => method === 'CREDIT_CARD' || method === 'BALANCE' || method === 'POINTS';

export interface LegacyUserInput {
  id?: string;
  name: string;
  avatar: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  salesBalance: number;
  points: number;
  bio?: string;
  sellerLevel?: number;
}

const userFromLegacy = (input: LegacyUserInput): User => ({
  id: input.id ?? `user-${slug(input.name)}`,
  displayName: input.name,
  avatar: input.avatar,
  bio: input.bio ?? 'Furima Sandboxのデモユーザーです。',
  createdAt: nowIso(),
  status: 'ACTIVE',
  identityVerificationStatus: input.isVerified ? 'VERIFIED' : 'UNVERIFIED',
  phoneVerified: input.isVerified,
  ratingSummary: { average: input.rating, count: input.ratingsCount, positiveCount: input.ratingsCount },
  sellerLevel: input.sellerLevel ?? 3,
  salesBalance: input.salesBalance,
  points: input.points,
});

export const createMarketplaceState = (
  legacyItems: MercariItem[],
  currentUser: LegacyUserInput,
  participants: LegacyUserInput[] = [currentUser],
): MarketplaceState => {
  const currentUserId = currentUser.id ?? `user-${slug(currentUser.name)}`;
  const configuredParticipants = [currentUser, ...participants].filter(
    (participant, index, values) => values.findIndex((value) => (value.id ?? `user-${slug(value.name)}`) === (participant.id ?? `user-${slug(participant.name)}`)) === index,
  );
  const participantByName = new Map(configuredParticipants.map((participant) => [participant.name, participant]));
  const users: User[] = configuredParticipants.map(userFromLegacy);
  const items: Item[] = []; const listings: Listing[] = []; const listingImages: ListingImage[] = []; const auctions: Auction[] = []; const bids: Bid[] = [];
  for (const legacy of legacyItems) {
    const configuredSeller = participantByName.get(legacy.seller.name);
    const sellerId = configuredSeller?.id ?? (legacy.seller.name === currentUser.name ? currentUserId : `user-${slug(legacy.seller.name)}`);
    if (!users.some((user) => user.id === sellerId)) users.push({ id: sellerId, displayName: legacy.seller.name, avatar: legacy.seller.avatar, bio: `${legacy.seller.name}のプロフィール`, createdAt: nowIso(), status: 'ACTIVE', identityVerificationStatus: legacy.seller.isVerified ? 'VERIFIED' : 'UNVERIFIED', phoneVerified: legacy.seller.isVerified, ratingSummary: { average: legacy.seller.rating, count: legacy.seller.ratingsCount, positiveCount: legacy.seller.ratingsCount }, sellerLevel: legacy.seller.level ?? 2, salesBalance: 0, points: 0 });
    const listingId = `listing-${legacy.id}`; const createdAt = nowIso();
    items.push({ id: legacy.id, title: legacy.title, description: legacy.description, condition: conditionFromLegacy(legacy.condition), defectDescription: '' });
    listings.push({ id: listingId, itemId: legacy.id, sellerId, categoryId: legacy.category[0] ?? 'その他', attributes: {}, price: legacy.price, saleType: legacy.isAuction ? 'AUCTION' : 'FIXED_PRICE', shippingPayer: legacy.shippingFee.includes('出品者') ? 'SELLER' : 'BUYER', shippingMethod: shippingMethodFromLegacy(legacy.shippingMethod), shippingOrigin: legacy.origin, shippingDays: shippingDaysFromLegacy(legacy.shippingDays), packageSize: 'MEDIUM', isAnonymous: legacy.shippingMethod.includes('配送'), status: legacy.isSold ? 'SOLD' : 'PUBLISHED', availability: 'AVAILABLE', quantity: 1, createdAt, publishedAt: createdAt, updatedAt: createdAt, version: 1, viewsCount: legacy.viewsCount ?? 0, searchCount: 0, likesCount: legacy.likesCount });
    legacy.images.forEach((url, index) => listingImages.push({ id: id('image'), listingId, url, sortOrder: index }));
    if (legacy.isAuction) {
      const auctionId = `auction-${legacy.id}`;
      const auction: Auction = { id: auctionId, listingId, startPrice: legacy.price, startsAt: createdAt, endsAt: addDays(createdAt, 1), status: 'OPEN' };
      auctions.push(auction);
      if ((legacy.currentBid ?? legacy.price) > legacy.price) { const bid: Bid = { id: `bid-${legacy.id}`, auctionId, bidderId: currentUserId, amount: legacy.currentBid ?? legacy.price, createdAt }; bids.push(bid); auction.highestBidId = bid.id; }
    }
  }
  const prefectures = ['東京都', '神奈川県', '埼玉県', '千葉県', '大阪府'];
  const addresses: Address[] = users.map((user, index) => ({ id: `address-${user.id}`, userId: user.id, label: '自宅', postalCode: `150-${String(index + 1).padStart(4, '0')}`, prefecture: prefectures[index % prefectures.length], city: 'サンドボックス市', line1: `${index + 1}-1`, isDefault: true }));
  const paymentMethods: PaymentMethod[] = users.flatMap((user) => [
    { id: `payment-card-${user.id}`, userId: user.id, type: 'CREDIT_CARD', label: 'クレジットカード（VISA **** 1234）', isDefault: true },
    { id: `payment-balance-${user.id}`, userId: user.id, type: 'BALANCE', label: '残高払い', isDefault: false },
    { id: `payment-cash-${user.id}`, userId: user.id, type: 'CONVENIENCE_STORE', label: 'コンビニ/ATM払い', isDefault: false },
  ]);
  const preferences: UserPreference[] = users.map((user) => ({ userId: user.id, notificationEnabled: true, language: 'ja' }));
  return { version: '1', stateVersion: 0, currentUserId, users, addresses, paymentMethods, preferences, items, listings, listingImages, categories: [], categoryAttributeDefinitions: [], listingAttributeValues: [], listingComments: [], transactionMessages: [], likes: [], savedItems: [], collections: [], collectionItems: [], follows: [], blocks: [], checkouts: [], transactions: [], payments: [], shipments: [], ratings: [], proceeds: [], cancellations: [], returns: [], refunds: [], disputes: [], priceRequests: [], bundleRequests: [], auctions, bids, notifications: [], tasks: [], reports: [], moderationCases: [], listingRevisions: [], transactionEvents: [], savedSearches: [] };
};

export const validateListingForPublish = (listing: Listing, item: Item, state?: MarketplaceState): string[] => {
  const errors: string[] = [];
  if (!item.title.trim() || item.title.trim().length > 40) errors.push('タイトルは1〜40文字で入力してください');
  const images = state?.listingImages.filter((image) => image.listingId === listing.id) ?? [];
  if (images.length < 1) errors.push('商品画像を1枚以上登録してください');
  if (images.length > 20) errors.push('商品画像は最大20枚です');
  if (!listing.categoryId.trim()) errors.push('カテゴリーを選択してください');
  if (!item.condition) errors.push('商品の状態を選択してください');
  if (!Number.isInteger(listing.price) || listing.price < 300 || listing.price > 9_999_999) errors.push('販売価格は300円〜9,999,999円で入力してください');
  if (!listing.shippingMethod) errors.push('配送方法を選択してください');
  if (!listing.shippingOrigin.trim()) errors.push('発送元の地域を入力してください');
  if (!Number.isInteger(listing.shippingDays) || listing.shippingDays < 1) errors.push('発送日数を入力してください');
  return errors;
};

export class MarketplaceDomain {
  private state: MarketplaceState;
  constructor(initialState: MarketplaceState) { this.state = clone(initialState); }
  getState() { return clone(this.state); }
  reset(initialState: MarketplaceState) { this.state = clone(initialState); }
  switchCurrentUser(userId: string): DomainResult<User> {
    const user = this.user(userId);
    if (!user) return fail('USER_NOT_FOUND', this.state.stateVersion, '切り替え先のユーザーが見つかりません');
    if (user.status !== 'ACTIVE') return fail('PERMISSION_DENIED', this.state.stateVersion, 'このユーザーではサンドボックスに入れません');
    if (this.state.currentUserId === userId) return ok(clone(user), this.state.stateVersion);
    this.state.currentUserId = userId;
    this.touch();
    return ok(clone(user), this.state.stateVersion);
  }
  private touch() { this.state.stateVersion += 1; return this.state.stateVersion; }
  private user(userId: string) { return this.state.users.find((value) => value.id === userId); }
  private item(itemId: string) { return this.state.items.find((value) => value.id === itemId); }
  private listing(listingId: string) { return this.state.listings.find((value) => value.id === listingId); }
  private transaction(transactionId: string) { return this.state.transactions.find((value) => value.id === transactionId); }
  private currentUser() { return this.user(this.state.currentUserId); }
  private event(transactionId: string, type: string, actorId: string, payload: Record<string, unknown> = {}) { this.state.transactionEvents.push({ id: id('event'), transactionId, type, actorId, payload, createdAt: nowIso() }); }
  private notify(userId: string, type: NotificationType, entityType: string, entityId: string, title: string, content: string, payload: Record<string, unknown> = {}) { this.state.notifications.unshift({ id: id('notification'), userId, type, entityType, entityId, payload, isRead: false, createdAt: nowIso(), title, content }); }
  private task(userId: string, type: TaskType, entityId: string, dueAt?: string) { if (!this.state.tasks.some((value) => value.userId === userId && value.type === type && value.entityId === entityId && !value.completedAt)) this.state.tasks.push({ id: id('task'), userId, type, entityId, dueAt }); }
  private completeTasks(userId: string, type: TaskType, entityId: string) { this.state.tasks.filter((value) => value.userId === userId && value.type === type && value.entityId === entityId && !value.completedAt).forEach((value) => { value.completedAt = nowIso(); }); }
  private blocked(a: string, b: string) { return this.state.blocks.some((value) => (value.blockerId === a && value.blockedId === b) || (value.blockerId === b && value.blockedId === a)); }
  private activeTransactionForListing(listingId: string) { return this.state.transactions.find((value) => value.listingId === listingId && value.transactionStatus !== 'CANCELED'); }

  addListingDraft(sellerId: string, input: Partial<Listing> & { item: Partial<Item>; images?: string[] }): DomainResult<Listing> {
    if (!this.user(sellerId)) return fail('USER_NOT_FOUND', this.state.stateVersion, '出品者が見つかりません');
    if (this.user(sellerId)?.status !== 'ACTIVE') return fail('PERMISSION_DENIED', this.state.stateVersion, '利用制限中のユーザーは出品できません');
    const itemId = id('item'); const listingId = id('listing'); const timestamp = nowIso();
    const item: Item = { id: itemId, title: input.item.title?.trim() ?? '', description: input.item.description?.trim() ?? '', condition: input.item.condition ?? 'GOOD', defectDescription: input.item.defectDescription ?? '' };
    const listing: Listing = { id: listingId, itemId, sellerId, categoryId: input.categoryId ?? '', brandId: input.brandId, attributes: input.attributes ?? {}, price: input.price ?? 0, saleType: input.saleType ?? 'FIXED_PRICE', shippingPayer: input.shippingPayer ?? 'SELLER', shippingMethod: input.shippingMethod ?? 'MERCARI_STANDARD', shippingOrigin: input.shippingOrigin ?? '', shippingDays: input.shippingDays ?? 2, packageSize: input.packageSize ?? 'MEDIUM', isAnonymous: input.isAnonymous ?? true, status: 'DRAFT', availability: 'AVAILABLE', quantity: 1, createdAt: timestamp, updatedAt: timestamp, version: 1, viewsCount: 0, searchCount: 0, likesCount: 0 };
    this.state.items.push(item); this.state.listings.push(listing); (input.images ?? []).forEach((url, index) => this.state.listingImages.push({ id: id('image'), listingId, url, sortOrder: index }));
    this.touch(); return ok(clone(listing), this.state.stateVersion);
  }

  publishListing(listingId: string): DomainResult<Listing> {
    const listing = this.listing(listingId); const item = listing && this.item(listing.itemId);
    if (!listing || !item) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません');
    if (!['DRAFT', 'PAUSED'].includes(listing.status)) return fail('INVALID_TRANSITION', this.state.stateVersion, 'この状態では公開できません');
    const errors = validateListingForPublish(listing, item, this.state); if (errors.length) return fail('INVALID_LISTING', this.state.stateVersion, errors.join('、'));
    listing.status = 'PUBLISHED'; listing.publishedAt ??= nowIso(); listing.updatedAt = nowIso(); listing.version += 1; this.touch(); return ok(clone(listing), this.state.stateVersion);
  }

  pauseListing(listingId: string): DomainResult<Listing> {
    const listing = this.listing(listingId); if (!listing) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません');
    if (listing.saleType === 'AUCTION' && this.state.auctions.some((auction) => auction.listingId === listingId && ['OPEN', 'ENDED', 'AWAITING_WINNER_PURCHASE'].includes(auction.status))) return fail('INVALID_TRANSITION', this.state.stateVersion, '入札済みオークションは公開停止できません');
    if (listing.status !== 'PUBLISHED') return fail('INVALID_TRANSITION', this.state.stateVersion, '公開中の商品だけ停止できます');
    listing.status = 'PAUSED'; listing.updatedAt = nowIso(); listing.version += 1; this.touch(); return ok(clone(listing), this.state.stateVersion);
  }
  resumeListing(listingId: string) { const listing = this.listing(listingId); if (!listing) return fail<Listing>('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません'); if (listing.status !== 'PAUSED') return fail<Listing>('INVALID_TRANSITION', this.state.stateVersion, '公開停止中の商品だけ再開できます'); return this.publishListing(listingId); }
  deleteListing(listingId: string): DomainResult<Listing> { const listing = this.listing(listingId); if (!listing) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません'); if (this.activeTransactionForListing(listingId)) return fail('INVALID_TRANSITION', this.state.stateVersion, '取引中の商品は削除できません'); listing.status = 'DELETED'; listing.updatedAt = nowIso(); listing.version += 1; this.touch(); return ok(clone(listing), this.state.stateVersion); }
  removeListingByModeration(listingId: string) { const listing = this.listing(listingId); if (!listing) return fail<Listing>('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません'); listing.status = 'REMOVED_BY_MODERATION'; listing.updatedAt = nowIso(); listing.version += 1; this.touch(); return ok(clone(listing), this.state.stateVersion); }

  updateListing(listingId: string, patch: Partial<Listing> & { item?: Partial<Item> }, expectedVersion?: number): DomainResult<Listing> {
    const listing = this.listing(listingId); const item = listing && this.item(listing.itemId); if (!listing || !item) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません');
    if (expectedVersion !== undefined && listing.version !== expectedVersion) return fail('LISTING_VERSION_CONFLICT', this.state.stateVersion, '出品内容が更新されています。最新内容を確認してください');
    if (!['DRAFT', 'PUBLISHED', 'PAUSED'].includes(listing.status)) return fail('INVALID_TRANSITION', this.state.stateVersion, '取引開始後は出品内容を変更できません');
    const changedFields: string[] = []; Object.entries(patch).forEach(([key, value]) => { if (key === 'item' || value === undefined) return; if (key in listing && listing[key as keyof Listing] !== value) { (listing as unknown as Record<string, unknown>)[key] = value; changedFields.push(key); } });
    if (patch.item) Object.entries(patch.item).forEach(([key, value]) => { if (value !== undefined && item[key as keyof Item] !== value) { (item as unknown as Record<string, unknown>)[key] = value; changedFields.push(`item.${key}`); } });
    if (!changedFields.length) return ok(clone(listing), this.state.stateVersion);
    listing.version += 1; listing.updatedAt = nowIso(); this.state.listingRevisions.push({ listingId, version: listing.version, changedFields, changedAt: listing.updatedAt });
    this.state.priceRequests.filter((request) => request.listingId === listingId && request.status === 'PENDING').forEach((request) => { request.status = 'CANCELED_BY_LISTING_CHANGE'; }); this.touch(); return ok(clone(listing), this.state.stateVersion);
  }
  addListingImage(listingId: string, url: string) { const listing = this.listing(listingId); if (!listing || !url.trim()) return fail<ListingImage>('INVALID_INPUT', this.state.stateVersion, '画像を指定してください'); const images = this.state.listingImages.filter((image) => image.listingId === listingId); if (images.length >= 20) return fail<ListingImage>('INVALID_INPUT', this.state.stateVersion, '商品画像は最大20枚です'); const image: ListingImage = { id: id('image'), listingId, url, sortOrder: images.length }; this.state.listingImages.push(image); this.touch(); return ok(clone(image), this.state.stateVersion); }
  removeListingImage(listingId: string, imageId: string) { const images = this.state.listingImages.filter((image) => image.listingId === listingId); if (images.length <= 1) return fail<undefined>('INVALID_INPUT', this.state.stateVersion, '商品画像は1枚以上必要です'); this.state.listingImages = this.state.listingImages.filter((image) => image.id !== imageId); this.state.listingImages.filter((image) => image.listingId === listingId).forEach((image, index) => { image.sortOrder = index; }); this.touch(); return ok(undefined, this.state.stateVersion); }
  reorderListingImages(listingId: string, orderedImageIds: string[]) { const images = this.state.listingImages.filter((image) => image.listingId === listingId); if (images.length !== orderedImageIds.length || !orderedImageIds.every((imageId) => images.some((image) => image.id === imageId))) return fail<undefined>('INVALID_INPUT', this.state.stateVersion, '画像の並び順が不正です'); orderedImageIds.forEach((imageId, index) => { const image = images.find((value) => value.id === imageId); if (image) image.sortOrder = index; }); this.touch(); return ok(undefined, this.state.stateVersion); }

  createCheckout(input: { buyerId: string; listingId: string; paymentMethodId?: string; shippingAddressId?: string; pointsUsed?: number; couponId?: string }): DomainResult<CheckoutSession> {
    const buyer = this.user(input.buyerId); const listing = this.listing(input.listingId); if (!buyer) return fail('USER_NOT_FOUND', this.state.stateVersion, '購入者が見つかりません'); if (!listing) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません');
    if (input.buyerId !== this.state.currentUserId) return fail('PERMISSION_DENIED', this.state.stateVersion, '現在のユーザーとして購入してください');
    if (listing.sellerId === input.buyerId) return fail('CANNOT_PURCHASE_OWN_LISTING', this.state.stateVersion, '自分の商品は購入できません'); if (this.blocked(input.buyerId, listing.sellerId)) return fail('USER_BLOCKED', this.state.stateVersion, 'ブロック中のユーザーの商品は購入できません'); if (listing.status !== 'PUBLISHED' || listing.saleType === 'AUCTION' || this.activeTransactionForListing(listing.id)) return fail('LISTING_UNAVAILABLE', this.state.stateVersion, 'この商品は購入できません');
    const paymentMethod = this.state.paymentMethods.find((value) => value.id === input.paymentMethodId) ?? this.state.paymentMethods.find((value) => value.userId === input.buyerId && value.isDefault); const address = this.state.addresses.find((value) => value.id === input.shippingAddressId) ?? this.state.addresses.find((value) => value.userId === input.buyerId && value.isDefault); if (!paymentMethod || !address) return fail('INVALID_INPUT', this.state.stateVersion, '支払い方法と配送先を設定してください');
    const paymentFee = paymentMethod.type === 'CONVENIENCE_STORE' || paymentMethod.type === 'ATM' ? 100 : 0; const shippingCharge = listing.shippingPayer === 'BUYER' ? 750 : 0; const pointsUsed = Math.max(0, Math.min(input.pointsUsed ?? 0, buyer.points)); const total = Math.max(0, listing.price + paymentFee + shippingCharge - pointsUsed); const timestamp = nowIso(); const checkout: CheckoutSession = { id: id('checkout'), buyerId: input.buyerId, listingId: listing.id, paymentMethodId: paymentMethod.id, shippingAddressId: address.id, couponId: input.couponId, pointsUsed, itemPrice: listing.price, paymentFee, shippingCharge, discount: 0, total, listingVersion: listing.version, status: 'OPEN', createdAt: timestamp, expiresAt: addDays(timestamp, 1) }; this.state.checkouts.push(checkout); this.touch(); return ok(clone(checkout), this.state.stateVersion);
  }
  updateCheckout(checkoutId: string, patch: Partial<Pick<CheckoutSession, 'paymentMethodId' | 'shippingAddressId' | 'pointsUsed' | 'deliveryPreference'>>): DomainResult<CheckoutSession> {
    const checkout = this.state.checkouts.find((value) => value.id === checkoutId);
    if (!checkout) return fail('CHECKOUT_NOT_FOUND', this.state.stateVersion, '購入手続きが見つかりません');
    if (checkout.buyerId !== this.state.currentUserId) return fail('PERMISSION_DENIED', this.state.stateVersion, '購入手続きを開始したユーザーに切り替えてください');
    if (checkout.status !== 'OPEN') return fail('INVALID_TRANSITION', this.state.stateVersion, 'この購入手続きは変更できません');
    const method = patch.paymentMethodId ? this.state.paymentMethods.find((value) => value.id === patch.paymentMethodId && value.userId === checkout.buyerId) : undefined;
    const address = patch.shippingAddressId ? this.state.addresses.find((value) => value.id === patch.shippingAddressId && value.userId === checkout.buyerId) : undefined;
    if (patch.paymentMethodId && !method) return fail('INVALID_INPUT', this.state.stateVersion, '支払い方法が見つかりません');
    if (patch.shippingAddressId && !address) return fail('INVALID_INPUT', this.state.stateVersion, '配送先が見つかりません');
    Object.assign(checkout, patch);
    if (method) checkout.paymentFee = method.type === 'CONVENIENCE_STORE' || method.type === 'ATM' ? 100 : 0;
    checkout.pointsUsed = Math.max(0, Math.min(checkout.pointsUsed, this.user(checkout.buyerId)?.points ?? 0));
    checkout.total = Math.max(0, checkout.itemPrice + checkout.paymentFee + checkout.shippingCharge - checkout.discount - checkout.pointsUsed);
    this.touch();
    return ok(clone(checkout), this.state.stateVersion);
  }

  confirmPurchase(checkoutId: string): DomainResult<Transaction> {
    const checkout = this.state.checkouts.find((value) => value.id === checkoutId); if (!checkout) return fail('CHECKOUT_NOT_FOUND', this.state.stateVersion, '購入手続きが見つかりません'); const listing = this.listing(checkout.listingId); const buyer = this.user(checkout.buyerId); const seller = listing && this.user(listing.sellerId); if (!listing || !buyer || !seller) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '購入対象が見つかりません');
    if (checkout.buyerId !== this.state.currentUserId) return fail('PERMISSION_DENIED', this.state.stateVersion, '購入手続きを開始したユーザーに切り替えてください');
    if (checkout.status !== 'OPEN') return fail('INVALID_TRANSITION', this.state.stateVersion, 'この購入手続きは完了済みです'); if (listing.version !== checkout.listingVersion) return fail('LISTING_VERSION_CONFLICT', this.state.stateVersion, '価格または商品情報が変更されたため、再確認が必要です'); if (listing.status !== 'PUBLISHED' || listing.availability !== 'AVAILABLE' || this.activeTransactionForListing(listing.id)) return fail('LISTING_UNAVAILABLE', this.state.stateVersion, '他のユーザーが先に購入した可能性があります'); if (this.blocked(checkout.buyerId, listing.sellerId)) return fail('USER_BLOCKED', this.state.stateVersion, 'ブロック中のユーザーの商品は購入できません');
    listing.status = 'TRANSACTION_STARTED'; listing.availability = 'LOCKED_FOR_TRANSACTION'; listing.version += 1; listing.updatedAt = nowIso(); checkout.status = 'CONFIRMED'; const method = this.state.paymentMethods.find((value) => value.id === checkout.paymentMethodId)?.type ?? 'CREDIT_CARD'; const paymentId = id('payment'); const transactionId = id('transaction'); const shipmentId = id('shipment'); const timestamp = nowIso(); const address = this.state.addresses.find((value) => value.id === checkout.shippingAddressId)!; const snapshot: ShippingAddressSnapshot = { postalCode: address.postalCode, prefecture: address.prefecture, city: address.city, line1: address.line1, maskedForSeller: listing.isAnonymous };
    const paid = immediatePayment(method); const payment: Payment = { id: paymentId, transactionId, method, amount: checkout.total, fee: checkout.paymentFee, pointsUsed: checkout.pointsUsed, balanceUsed: method === 'BALANCE' ? checkout.total : 0, status: paid ? 'PAID' : 'PENDING', paidAt: paid ? timestamp : undefined }; const transaction: Transaction = { id: transactionId, listingId: listing.id, sellerId: listing.sellerId, buyerId: checkout.buyerId, transactionStatus: 'ACTIVE', paymentStatus: paid ? 'PAID' : 'PENDING', fulfillmentStatus: paid ? 'AWAITING_SHIPMENT' : 'AWAITING_PAYMENT', buyerRatingStatus: 'PENDING', sellerRatingStatus: 'PENDING', disputeStatus: 'NONE', paymentId, shipmentId, checkoutId, shippingAddressSnapshot: snapshot, expectedListingVersion: checkout.listingVersion, itemPrice: checkout.itemPrice, platformFee: Math.floor(checkout.itemPrice * 0.1), shippingFee: checkout.shippingCharge, total: checkout.total, shippingDeadline: addDays(timestamp, listing.shippingDays), createdAt: timestamp };
    const shipment: Shipment = { id: shipmentId, transactionId, carrier: listing.isAnonymous ? 'メルカリ便' : '指定配送', service: shippingLabel(listing.shippingMethod), packageSize: listing.packageSize, shippingFee: checkout.shippingCharge, senderPays: listing.shippingPayer === 'SELLER', anonymous: listing.isAnonymous, origin: listing.shippingOrigin, destination: snapshot, status: 'NOT_SHIPPED' }; this.state.payments.push(payment); this.state.transactions.push(transaction); this.state.shipments.push(shipment); this.event(transactionId, 'PURCHASED', checkout.buyerId, { listingId: listing.id, total: checkout.total }); this.notify(seller.id, 'TRANSACTION_CREATED', 'TRANSACTION', transactionId, '商品が購入されました', '支払い状況を確認してください。'); if (paid) { this.notify(seller.id, 'SHIPMENT_REQUIRED', 'TRANSACTION', transactionId, '発送してください', '支払いが完了しました。発送通知をお願いします。'); this.task(seller.id, 'SHIPMENT_REQUIRED', transactionId, transaction.shippingDeadline); } else this.task(checkout.buyerId, 'PAYMENT_REQUIRED', transactionId, addDays(timestamp, 3)); this.touch(); return ok(clone(transaction), this.state.stateVersion);
  }
  completePayment(transactionId: string): DomainResult<Payment> { const transaction = this.transaction(transactionId); const payment = transaction && this.state.payments.find((value) => value.id === transaction.paymentId); if (!transaction || !payment) return fail('PAYMENT_NOT_FOUND', this.state.stateVersion, '支払いが見つかりません'); if (transaction.buyerId !== this.state.currentUserId) return fail('PERMISSION_DENIED', this.state.stateVersion, '購入者に切り替えて支払ってください'); if (payment.status !== 'PENDING') return fail('INVALID_TRANSITION', this.state.stateVersion, 'この支払いは処理できません'); payment.status = 'PAID'; payment.paidAt = nowIso(); transaction.paymentStatus = 'PAID'; transaction.fulfillmentStatus = 'AWAITING_SHIPMENT'; this.completeTasks(transaction.buyerId, 'PAYMENT_REQUIRED', transactionId); this.event(transactionId, 'PAYMENT_COMPLETED', this.state.currentUserId); this.notify(transaction.sellerId, 'SHIPMENT_REQUIRED', 'TRANSACTION', transactionId, '発送してください', '支払いが完了しました。発送通知をお願いします。'); this.task(transaction.sellerId, 'SHIPMENT_REQUIRED', transactionId, transaction.shippingDeadline); this.touch(); return ok(clone(payment), this.state.stateVersion); }
  markAsShipped(transactionId: string, input?: { carrier?: string; trackingNumber?: string }): DomainResult<Shipment> { const transaction = this.transaction(transactionId); const shipment = transaction && this.state.shipments.find((value) => value.id === transaction.shipmentId); if (!transaction || !shipment) return fail('SHIPMENT_NOT_FOUND', this.state.stateVersion, '配送情報が見つかりません'); if (transaction.sellerId !== this.state.currentUserId) return fail('PERMISSION_DENIED', this.state.stateVersion, '出品者に切り替えて発送してください'); if (transaction.paymentStatus !== 'PAID') return fail('PAYMENT_NOT_COMPLETED', this.state.stateVersion, '支払い完了前は発送できません'); if (!['NOT_SHIPPED', 'DELIVERY_FAILED'].includes(shipment.status)) return fail('INVALID_TRANSITION', this.state.stateVersion, 'この取引は発送通知できません'); shipment.status = 'SHIPPED'; shipment.shippedAt = nowIso(); shipment.carrier = input?.carrier ?? shipment.carrier; shipment.trackingNumber = input?.trackingNumber; transaction.fulfillmentStatus = 'SHIPPED'; this.completeTasks(transaction.sellerId, 'SHIPMENT_REQUIRED', transactionId); this.event(transactionId, 'SHIPPED', transaction.sellerId); this.notify(transaction.buyerId, 'ITEM_SHIPPED', 'TRANSACTION', transactionId, '商品が発送されました', '配送状況を確認できます。'); this.touch(); return ok(clone(shipment), this.state.stateVersion); }
  updateShipmentStatus(transactionId: string, status: ShipmentStatus): DomainResult<Shipment> { const transaction = this.transaction(transactionId); const shipment = transaction && this.state.shipments.find((value) => value.id === transaction.shipmentId); if (!transaction || !shipment) return fail('SHIPMENT_NOT_FOUND', this.state.stateVersion, '配送情報が見つかりません'); const order: ShipmentStatus[] = ['NOT_SHIPPED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']; if (order.includes(status)) { const currentIndex = order.indexOf(shipment.status); const targetIndex = order.indexOf(status); if (targetIndex < currentIndex || (shipment.status === 'NOT_SHIPPED' && status !== 'SHIPPED')) return fail('INVALID_TRANSITION', this.state.stateVersion, '発送前に配送完了へ進めません'); } shipment.status = status; if (status === 'IN_TRANSIT') transaction.fulfillmentStatus = 'IN_TRANSIT'; if (status === 'OUT_FOR_DELIVERY') transaction.fulfillmentStatus = 'OUT_FOR_DELIVERY'; if (status === 'DELIVERED') { shipment.deliveredAt = nowIso(); transaction.fulfillmentStatus = 'DELIVERED'; this.task(transaction.buyerId, 'BUYER_RATING_REQUIRED', transactionId); this.notify(transaction.buyerId, 'RATING_REQUIRED', 'TRANSACTION', transactionId, '受取評価をお願いします', '商品を確認して受取評価をしてください。'); this.event(transactionId, 'DELIVERED', this.state.currentUserId); } this.touch(); return ok(clone(shipment), this.state.stateVersion); }
  changeShippingAddress(transactionId: string, addressId: string): DomainResult<Transaction> { const transaction = this.transaction(transactionId); const address = this.state.addresses.find((value) => value.id === addressId); const listing = transaction && this.listing(transaction.listingId); if (!transaction || !address || !listing) return fail('INVALID_INPUT', this.state.stateVersion, '配送先が見つかりません'); if (transaction.buyerId !== this.state.currentUserId || address.userId !== transaction.buyerId) return fail('PERMISSION_DENIED', this.state.stateVersion, '購入者の配送先だけ変更できます'); const shipment = this.state.shipments.find((value) => value.id === transaction.shipmentId); if (!shipment || shipment.shippedAt) return fail('INVALID_TRANSITION', this.state.stateVersion, '発送通知後は配送先を変更できません'); const snapshot = { postalCode: address.postalCode, prefecture: address.prefecture, city: address.city, line1: address.line1, maskedForSeller: listing.isAnonymous }; transaction.shippingAddressSnapshot = snapshot; shipment.destination = snapshot; this.event(transactionId, 'ADDRESS_CHANGED', transaction.buyerId); this.touch(); return ok(clone(transaction), this.state.stateVersion); }
  rateTransaction(transactionId: string, fromUserId: string, rating: number, comment = ''): DomainResult<Rating> { const transaction = this.transaction(transactionId); if (!transaction) return fail('TRANSACTION_NOT_FOUND', this.state.stateVersion, '取引が見つかりません'); if (fromUserId !== this.state.currentUserId) return fail('PERMISSION_DENIED', this.state.stateVersion, '評価するユーザーに切り替えてください'); if (transaction.fulfillmentStatus !== 'DELIVERED') return fail('RATING_NOT_ALLOWED', this.state.stateVersion, '配達前は評価できません'); if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail('INVALID_INPUT', this.state.stateVersion, '評価は1〜5で入力してください'); const isBuyer = fromUserId === transaction.buyerId; const isSeller = fromUserId === transaction.sellerId; if (!isBuyer && !isSeller) return fail('PERMISSION_DENIED', this.state.stateVersion, '取引参加者だけが評価できます'); if (isSeller && transaction.buyerRatingStatus !== 'COMPLETED') return fail('RATING_NOT_ALLOWED', this.state.stateVersion, '購入者の受取評価後に評価できます'); if (isBuyer && transaction.buyerRatingStatus === 'COMPLETED') return fail('RATING_NOT_ALLOWED', this.state.stateVersion, '受取評価は完了しています'); if (isSeller && transaction.sellerRatingStatus === 'COMPLETED') return fail('RATING_NOT_ALLOWED', this.state.stateVersion, '出品者評価は完了しています'); const toUserId = isBuyer ? transaction.sellerId : transaction.buyerId; const record: Rating = { id: id('rating'), transactionId, fromUserId, toUserId, rating, comment, createdAt: nowIso() }; this.state.ratings.push(record); if (isBuyer) { transaction.buyerRatingStatus = 'COMPLETED'; this.completeTasks(transaction.buyerId, 'BUYER_RATING_REQUIRED', transactionId); this.task(transaction.sellerId, 'SELLER_RATING_REQUIRED', transactionId); this.event(transactionId, 'BUYER_RATED', fromUserId, { rating }); } else { transaction.sellerRatingStatus = 'COMPLETED'; this.completeTasks(transaction.sellerId, 'SELLER_RATING_REQUIRED', transactionId); this.event(transactionId, 'SELLER_RATED', fromUserId, { rating }); } if (transaction.buyerRatingStatus === 'COMPLETED' && transaction.sellerRatingStatus === 'COMPLETED') { transaction.transactionStatus = 'COMPLETED'; transaction.completedAt = nowIso(); const listing = this.listing(transaction.listingId); if (listing) { listing.status = 'SOLD'; listing.availability = 'AVAILABLE'; listing.updatedAt = nowIso(); listing.version += 1; } const proceeds: SellerProceeds = { id: id('proceeds'), transactionId, sellerId: transaction.sellerId, gross: transaction.itemPrice, platformFee: transaction.platformFee, shippingFee: transaction.shippingFee, adjustments: 0, net: Math.max(0, transaction.itemPrice - transaction.platformFee - transaction.shippingFee), status: 'CONFIRMED', createdAt: nowIso() }; this.state.proceeds.push(proceeds); const seller = this.user(transaction.sellerId); if (seller) seller.salesBalance += proceeds.net; this.notify(transaction.sellerId, 'TRANSACTION_COMPLETED', 'TRANSACTION', transactionId, '取引が完了しました', '売上金が確定しました。'); this.event(transactionId, 'COMPLETED', fromUserId); } this.touch(); return ok(clone(record), this.state.stateVersion); }

  requestCancellation(transactionId: string, requestedBy: string, reason: string, returnRequired = false): DomainResult<CancellationRequest> { const transaction = this.transaction(transactionId); if (!transaction) return fail('TRANSACTION_NOT_FOUND', this.state.stateVersion, '取引が見つかりません'); if (transaction.transactionStatus === 'COMPLETED') return fail('TRANSACTION_COMPLETED', this.state.stateVersion, '取引完了後はキャンセルできません'); if (![transaction.buyerId, transaction.sellerId].includes(requestedBy)) return fail('PERMISSION_DENIED', this.state.stateVersion, '取引参加者だけが申請できます'); const request: CancellationRequest = { id: id('cancel'), transactionId, requestedBy, reason, reasonDetail: '', returnRequired, status: 'REQUESTED', createdAt: nowIso() }; this.state.cancellations.push(request); this.notify(requestedBy === transaction.buyerId ? transaction.sellerId : transaction.buyerId, 'CANCELLATION_REQUESTED', 'TRANSACTION', transactionId, 'キャンセル申請が届きました', reason); this.touch(); return ok(clone(request), this.state.stateVersion); }
  respondCancellation(requestId: string, accepted: boolean): DomainResult<CancellationRequest> { const request = this.state.cancellations.find((value) => value.id === requestId); if (!request) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, 'キャンセル申請が見つかりません'); request.status = accepted ? 'ACCEPTED' : 'REJECTED'; request.respondedAt = nowIso(); if (accepted && !request.returnRequired) this.completeCancellation(request.id); this.touch(); return ok(clone(request), this.state.stateVersion); }
  completeCancellation(requestId: string): DomainResult<CancellationRequest> { const request = this.state.cancellations.find((value) => value.id === requestId); const transaction = request && this.transaction(request.transactionId); if (!request || !transaction) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, 'キャンセル申請が見つかりません'); if (!['ACCEPTED', 'REQUESTED'].includes(request.status)) return fail('INVALID_TRANSITION', this.state.stateVersion, 'この申請は完了できません'); if (request.returnRequired && !this.state.returns.some((value) => value.transactionId === transaction.id && value.status === 'COMPLETED')) return fail('INVALID_TRANSITION', this.state.stateVersion, '返品完了前はキャンセルを完了できません'); request.status = 'COMPLETED'; transaction.transactionStatus = 'CANCELED'; transaction.canceledAt = nowIso(); const payment = this.state.payments.find((value) => value.id === transaction.paymentId); if (payment?.status === 'PAID') payment.status = 'REFUNDED'; transaction.paymentStatus = payment?.status ?? 'CANCELED'; const listing = this.listing(transaction.listingId); if (listing) { listing.status = 'PUBLISHED'; listing.availability = 'AVAILABLE'; listing.version += 1; listing.updatedAt = nowIso(); } this.event(transaction.id, 'CANCELED', this.state.currentUserId); this.touch(); return ok(clone(request), this.state.stateVersion); }
  cancelOverduePayment(transactionId: string): DomainResult<Transaction> { const transaction = this.transaction(transactionId); if (!transaction) return fail('TRANSACTION_NOT_FOUND', this.state.stateVersion, '取引が見つかりません'); if (transaction.paymentStatus !== 'PENDING') return fail('INVALID_TRANSITION', this.state.stateVersion, '支払い待ちではありません'); const request = this.requestCancellation(transactionId, transaction.sellerId, '支払い期限超過', false); if (!request.ok) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, request.message); const completed = this.completeCancellation(request.data.id); if (!completed.ok) return fail('INVALID_TRANSITION', completed.stateVersion, completed.message); const canceled = this.transaction(transactionId); return canceled ? ok(clone(canceled), this.state.stateVersion) : fail('TRANSACTION_NOT_FOUND', this.state.stateVersion, '取引が見つかりません'); }
  requestReturn(transactionId: string, reason: string): DomainResult<ReturnRequest> { const transaction = this.transaction(transactionId); if (!transaction || transaction.transactionStatus === 'COMPLETED' || transaction.fulfillmentStatus !== 'DELIVERED' || transaction.buyerRatingStatus === 'COMPLETED') return fail('DISPUTE_NOT_ALLOWED', this.state.stateVersion, '受取評価前の取引だけ返品申請できます'); const record: ReturnRequest = { id: id('return'), transactionId, reason, status: 'REQUESTED' }; this.state.returns.push(record); transaction.fulfillmentStatus = 'RETURNING'; this.notify(transaction.sellerId, 'RETURN_REQUIRED', 'TRANSACTION', transactionId, '返品申請が届きました', reason); this.touch(); return ok(clone(record), this.state.stateVersion); }
  updateReturn(returnId: string, status: ReturnStatus, metadata?: { shippingMethod?: string; trackingNumber?: string }): DomainResult<ReturnRequest> { const record = this.state.returns.find((value) => value.id === returnId); if (!record) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, '返品申請が見つかりません'); Object.assign(record, metadata, { status }); const transaction = this.transaction(record.transactionId); if (transaction && status === 'COMPLETED') { transaction.fulfillmentStatus = 'RETURNED'; this.event(transaction.id, 'RETURN_COMPLETED', this.state.currentUserId); } this.touch(); return ok(clone(record), this.state.stateVersion); }
  requestRefund(transactionId: string, amount: number, type: RefundType, reason: string): DomainResult<Refund> { const transaction = this.transaction(transactionId); const payment = transaction && this.state.payments.find((value) => value.id === transaction.paymentId); if (!transaction || !payment) return fail('PAYMENT_NOT_FOUND', this.state.stateVersion, '支払いが見つかりません'); if (amount <= 0 || amount > payment.amount || (type === 'PARTIAL' && amount >= payment.amount)) return fail('INVALID_INPUT', this.state.stateVersion, '返金額が不正です'); const record: Refund = { id: id('refund'), transactionId, paymentId: payment.id, amount, type, reason, status: 'REQUESTED' }; this.state.refunds.push(record); payment.status = type === 'FULL' ? 'REFUND_PENDING' : 'PARTIALLY_REFUNDED'; this.touch(); return ok(clone(record), this.state.stateVersion); }
  completeRefund(refundId: string): DomainResult<Refund> { const refund = this.state.refunds.find((value) => value.id === refundId); if (!refund) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, '返金が見つかりません'); refund.status = 'COMPLETED'; const payment = this.state.payments.find((value) => value.id === refund.paymentId); if (payment) payment.status = refund.type === 'FULL' ? 'REFUNDED' : 'PARTIALLY_REFUNDED'; this.notify(this.transaction(refund.transactionId)?.buyerId ?? this.state.currentUserId, 'REFUND_COMPLETED', 'TRANSACTION', refund.transactionId, '返金が完了しました', `¥${refund.amount.toLocaleString()}を返金しました。`); this.touch(); return ok(clone(refund), this.state.stateVersion); }
  openDispute(input: { transactionId: string; openedBy: string; category: DisputeCategory; description: string; attachments?: string[] }): DomainResult<Dispute> { const transaction = this.transaction(input.transactionId); if (!transaction || transaction.transactionStatus === 'COMPLETED' || ![transaction.buyerId, transaction.sellerId].includes(input.openedBy)) return fail('DISPUTE_NOT_ALLOWED', this.state.stateVersion, 'この取引では問題報告できません'); const dispute: Dispute = { id: id('dispute'), transactionId: input.transactionId, openedBy: input.openedBy, category: input.category, description: input.description, attachments: input.attachments ?? [], status: 'OPEN' }; this.state.disputes.push(dispute); transaction.disputeStatus = 'OPEN'; this.touch(); return ok(clone(dispute), this.state.stateVersion); }
  report(targetType: ReportTargetType, targetId: string, reporterId: string, category: string, detail: string): DomainResult<Report> { if (!this.user(reporterId) || !targetId.trim() || !category.trim()) return fail('INVALID_INPUT', this.state.stateVersion, '通報内容を入力してください'); const report: Report = { id: id('report'), reporterId, targetType, targetId, category, detail, createdAt: nowIso() }; this.state.reports.push(report); this.state.moderationCases.push({ id: id('moderation'), entityType: targetType, entityId: targetId, reason: `${category}: ${detail}`, reportedBy: reporterId, status: 'OPEN' }); this.touch(); return ok(clone(report), this.state.stateVersion); }
  reportComment(commentId: string, reporterId: string, category: string, detail: string) { return this.report('COMMENT', commentId, reporterId, category, detail); }
  reportTransactionMessage(messageId: string, reporterId: string, category: string, detail: string) { return this.report('MESSAGE', messageId, reporterId, category, detail); }
  resolveModeration(caseId: string, action: ModerationAction): DomainResult<ModerationCase> { const moderation = this.state.moderationCases.find((value) => value.id === caseId); if (!moderation) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, 'モデレーション案件が見つかりません'); moderation.action = action; moderation.status = 'RESOLVED'; if (action === 'PAUSE_LISTING' && moderation.entityType === 'LISTING') this.pauseListing(moderation.entityId); if (action === 'REMOVE_LISTING' && moderation.entityType === 'LISTING') this.removeListingByModeration(moderation.entityId); if (action === 'RESTRICT_USER' || action === 'BAN_USER') { const user = moderation.entityType === 'USER' ? this.user(moderation.entityId) : undefined; if (user) user.status = action === 'BAN_USER' ? 'BANNED' : 'RESTRICTED'; } this.touch(); return ok(clone(moderation), this.state.stateVersion); }
  completeTask(taskId: string, userId: string): DomainResult<Task> { const task = this.state.tasks.find((value) => value.id === taskId && value.userId === userId); if (!task) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, 'タスクが見つかりません'); task.completedAt = nowIso(); this.touch(); return ok(clone(task), this.state.stateVersion); }
  createCollection(userId: string, name: string): DomainResult<Collection> { if (!name.trim()) return fail('INVALID_INPUT', this.state.stateVersion, 'コレクション名を入力してください'); const collection: Collection = { id: id('collection'), userId, name: name.trim(), createdAt: nowIso() }; this.state.collections.push(collection); this.touch(); return ok(clone(collection), this.state.stateVersion); }
  addToCollection(collectionId: string, listingId: string, userId: string): DomainResult<CollectionItem> { const collection = this.state.collections.find((value) => value.id === collectionId && value.userId === userId); if (!collection || !this.listing(listingId)) return fail('PERMISSION_DENIED', this.state.stateVersion, 'コレクションを更新できません'); const record: CollectionItem = { collectionId, listingId, createdAt: nowIso() }; if (!this.state.collectionItems.some((value) => value.collectionId === collectionId && value.listingId === listingId)) this.state.collectionItems.push(record); this.touch(); return ok(clone(record), this.state.stateVersion); }
  setCategoryAttribute(listingId: string, definitionId: string, value: string): DomainResult<ListingAttributeValue> { if (!this.listing(listingId)) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません'); const existing = this.state.listingAttributeValues.find((entry) => entry.listingId === listingId && entry.definitionId === definitionId); if (existing) existing.value = value; else this.state.listingAttributeValues.push({ listingId, definitionId, value }); this.touch(); return ok(clone(this.state.listingAttributeValues.find((entry) => entry.listingId === listingId && entry.definitionId === definitionId)!), this.state.stateVersion); }

  addListingComment(listingId: string, authorId: string, body: string): DomainResult<ListingComment> { const listing = this.listing(listingId); if (!listing) return fail('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません'); if (listing.status !== 'PUBLISHED' || this.activeTransactionForListing(listingId)) return fail('LISTING_UNAVAILABLE', this.state.stateVersion, '取引開始後はコメントできません'); if (this.blocked(authorId, listing.sellerId)) return fail('USER_BLOCKED', this.state.stateVersion, 'ブロック中のユーザーはコメントできません'); if (!body.trim()) return fail('INVALID_INPUT', this.state.stateVersion, 'コメントを入力してください'); const user = this.user(authorId); const comment: ListingComment = { id: id('comment'), listingId, authorId, userName: user?.displayName ?? 'ユーザー', userAvatar: user?.avatar ?? '', text: body.trim(), body: body.trim(), date: 'たった今', status: 'ACTIVE', createdAt: nowIso() }; this.state.listingComments.push(comment); this.notify(listing.sellerId, 'LISTING_COMMENTED', 'LISTING', listingId, '商品にコメントがつきました', body.trim()); this.touch(); return ok(clone(comment), this.state.stateVersion); }
  deleteListingComment(commentId: string, actorId: string) { const comment = this.state.listingComments.find((value) => value.id === commentId); const listing = comment && this.listing(comment.listingId); if (!comment || !listing) return fail<undefined>('REQUEST_NOT_FOUND', this.state.stateVersion, 'コメントが見つかりません'); if (actorId !== comment.authorId && actorId !== listing.sellerId) return fail<undefined>('PERMISSION_DENIED', this.state.stateVersion, 'コメントを削除する権限がありません'); comment.status = 'DELETED'; this.touch(); return ok(undefined, this.state.stateVersion); }
  deleteComment(commentId: string, actorId: string) { return this.deleteListingComment(commentId, actorId); }
  addTransactionMessage(transactionId: string, senderId: string, body: string, attachments: string[] = []): DomainResult<TransactionMessage> { const transaction = this.transaction(transactionId); if (!transaction || ![transaction.buyerId, transaction.sellerId].includes(senderId) || transaction.transactionStatus === 'CANCELED') return fail('PERMISSION_DENIED', this.state.stateVersion, '取引参加者だけがメッセージを送信できます'); const message: TransactionMessage = { id: id('message'), transactionId, senderId, body: body.trim(), attachments, createdAt: nowIso() }; if (!message.body && !attachments.length) return fail('INVALID_INPUT', this.state.stateVersion, 'メッセージを入力してください'); this.state.transactionMessages.push(message); this.touch(); return ok(clone(message), this.state.stateVersion); }
  blockUser(blockerId: string, blockedId: string) { if (!this.user(blockerId) || !this.user(blockedId) || blockerId === blockedId) return fail<undefined>('INVALID_INPUT', this.state.stateVersion, 'ユーザー指定が不正です'); if (!this.state.blocks.some((value) => value.blockerId === blockerId && value.blockedId === blockedId)) this.state.blocks.push({ blockerId, blockedId, createdAt: nowIso() }); this.touch(); return ok(undefined, this.state.stateVersion); }
  unblockUser(blockerId: string, blockedId: string) { this.state.blocks = this.state.blocks.filter((value) => !(value.blockerId === blockerId && value.blockedId === blockedId)); this.touch(); return ok(undefined, this.state.stateVersion); }
  followUser(followerId: string, followedUserId: string) { if (!this.user(followerId) || !this.user(followedUserId) || followerId === followedUserId || this.blocked(followerId, followedUserId)) return fail<undefined>('INVALID_INPUT', this.state.stateVersion, 'フォローできません'); if (!this.state.follows.some((value) => value.followerId === followerId && value.followedUserId === followedUserId)) this.state.follows.push({ followerId, followedUserId, createdAt: nowIso() }); this.touch(); return ok(undefined, this.state.stateVersion); }
  likeListing(listingId: string, userId: string, liked = true) { const listing = this.listing(listingId); if (!listing) return fail<undefined>('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません'); const existing = this.state.likes.findIndex((value) => value.listingId === listingId && value.userId === userId); if (liked && existing < 0) { this.state.likes.push({ userId, listingId, createdAt: nowIso() }); listing.likesCount += 1; this.notify(listing.sellerId, 'LISTING_LIKED', 'LISTING', listingId, '商品にいいねがつきました', '商品を気に入ったユーザーがいます。'); } if (!liked && existing >= 0) { this.state.likes.splice(existing, 1); listing.likesCount = Math.max(0, listing.likesCount - 1); } this.touch(); return ok(undefined, this.state.stateVersion); }
  saveListing(listingId: string, userId: string, saved = true) { if (!this.listing(listingId)) return fail<undefined>('LISTING_NOT_FOUND', this.state.stateVersion, '出品が見つかりません'); const existing = this.state.savedItems.findIndex((value) => value.listingId === listingId && value.userId === userId); if (saved && existing < 0) this.state.savedItems.push({ userId, listingId, createdAt: nowIso() }); if (!saved && existing >= 0) this.state.savedItems.splice(existing, 1); this.touch(); return ok(undefined, this.state.stateVersion); }

  requestPriceChange(listingId: string, buyerId: string, requestedPrice: number): DomainResult<PriceRequest> { const listing = this.listing(listingId); if (!listing || listing.status !== 'PUBLISHED' || listing.saleType === 'AUCTION' || listing.price <= 300 || requestedPrice < 300 || requestedPrice >= listing.price || this.activeTransactionForListing(listingId) || listing.sellerId === buyerId) return fail('PRICE_REQUEST_NOT_ALLOWED', this.state.stateVersion, 'この商品には値下げ依頼できません'); const request: PriceRequest = { id: id('price-request'), listingId, buyerId, requestedPrice, status: 'PENDING', expiresAt: addDays(nowIso(), 1) }; this.state.priceRequests.push(request); this.notify(listing.sellerId, 'PRICE_REQUEST_RECEIVED', 'LISTING', listingId, '値下げ依頼が届きました', `¥${requestedPrice.toLocaleString()}の依頼です。`); this.touch(); return ok(clone(request), this.state.stateVersion); }
  respondPriceRequest(requestId: string, accepted: boolean): DomainResult<PriceRequest> { const request = this.state.priceRequests.find((value) => value.id === requestId); const listing = request && this.listing(request.listingId); if (!request || !listing) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, '値下げ依頼が見つかりません'); request.status = accepted ? 'ACCEPTED' : 'REJECTED'; if (accepted) { listing.price = request.requestedPrice; listing.version += 1; listing.updatedAt = nowIso(); this.notify(request.buyerId, 'PRICE_REQUEST_ACCEPTED', 'LISTING', listing.id, '値下げ依頼が承認されました', `販売価格が¥${listing.price.toLocaleString()}になりました。`); } this.touch(); return ok(clone(request), this.state.stateVersion); }
  requestBundle(buyerId: string, listingIds: string[], requestedTotalPrice: number): DomainResult<BundleRequest> { if (listingIds.length < 2 || listingIds.length > 10 || requestedTotalPrice < 300) return fail('BUNDLE_NOT_ALLOWED', this.state.stateVersion, 'まとめ買いは2〜10商品で依頼してください'); const listings = listingIds.map((listingId) => this.listing(listingId)); if (listings.some((listing) => !listing || listing.status !== 'PUBLISHED')) return fail('BUNDLE_NOT_ALLOWED', this.state.stateVersion, '公開中の商品だけまとめ買いできます'); const sellerId = listings[0]!.sellerId; if (listings.some((listing) => listing!.sellerId !== sellerId) || listings.some((listing) => this.blocked(buyerId, listing!.sellerId))) return fail('BUNDLE_NOT_ALLOWED', this.state.stateVersion, '同じ出品者の商品だけまとめ買いできます'); const request: BundleRequest = { id: id('bundle'), buyerId, sellerId, listingIds, requestedTotalPrice, status: 'PENDING', expiresAt: addDays(nowIso(), 1) }; this.state.bundleRequests.push(request); this.touch(); return ok(clone(request), this.state.stateVersion); }
  approveBundle(requestId: string): DomainResult<Listing> { const request = this.state.bundleRequests.find((value) => value.id === requestId); if (!request) return fail('REQUEST_NOT_FOUND', this.state.stateVersion, 'まとめ買い依頼が見つかりません'); const listings = request.listingIds.map((listingId) => this.listing(listingId)); if (request.status !== 'PENDING' || listings.some((listing) => !listing || listing.status !== 'PUBLISHED')) { request.status = 'INVALIDATED'; return fail('BUNDLE_NOT_ALLOWED', this.state.stateVersion, '対象商品が売れたため依頼は無効です'); } const first = listings[0]!; const item = this.item(first.itemId)!; const result = this.addListingDraft(first.sellerId, { item: { title: `${item.title} まとめ買い`, description: listings.map((listing) => this.item(listing!.itemId)?.title ?? '').join('、'), condition: item.condition }, categoryId: first.categoryId, price: request.requestedTotalPrice, saleType: 'FIXED_PRICE', shippingPayer: first.shippingPayer, shippingMethod: first.shippingMethod, shippingOrigin: first.shippingOrigin, shippingDays: first.shippingDays, packageSize: first.packageSize, isAnonymous: first.isAnonymous, images: this.state.listingImages.filter((image) => image.listingId === first.id).map((image) => image.url) }); if (!result.ok) return result; request.status = 'ACCEPTED'; request.bundleListingId = result.data.id; listings.forEach((listing) => { listing!.status = 'PAUSED'; listing!.version += 1; }); this.touch(); return result; }

  createAuction(listingId: string, startPrice: number, startsAt: string, endsAt: string): DomainResult<Auction> { const listing = this.listing(listingId); if (!listing || listing.saleType !== 'AUCTION') return fail('NOT_AUCTION', this.state.stateVersion, 'オークション商品ではありません'); if (endsAt <= startsAt || startPrice < 300) return fail('INVALID_INPUT', this.state.stateVersion, 'オークション期間または開始価格が不正です'); const auction: Auction = { id: id('auction'), listingId, startPrice, startsAt, endsAt, status: startsAt > nowIso() ? 'SCHEDULED' : 'OPEN' }; this.state.auctions.push(auction); this.touch(); return ok(clone(auction), this.state.stateVersion); }
  placeBid(auctionId: string, bidderId: string, amount: number): DomainResult<Bid> { const auction = this.state.auctions.find((value) => value.id === auctionId); const listing = auction && this.listing(auction.listingId); if (!auction || !listing) return fail('AUCTION_NOT_FOUND', this.state.stateVersion, 'オークションが見つかりません'); if (listing.sellerId === bidderId) return fail('CANNOT_PURCHASE_OWN_LISTING', this.state.stateVersion, '自分の商品には入札できません'); if (!['SCHEDULED', 'OPEN'].includes(auction.status) || new Date() >= new Date(auction.endsAt)) return fail('AUCTION_CLOSED', this.state.stateVersion, '終了したオークションには入札できません'); const highest = this.state.bids.filter((bid) => bid.auctionId === auction.id).sort((a, b) => b.amount - a.amount)[0]; const minimum = Math.max(auction.startPrice, highest?.amount ?? 0) + 100; if (!Number.isInteger(amount) || amount < minimum) return fail('BID_TOO_LOW', this.state.stateVersion, `最低入札額は¥${minimum.toLocaleString()}です`); const previous = highest?.bidderId; const bid: Bid = { id: id('bid'), auctionId, bidderId, amount, createdAt: nowIso() }; this.state.bids.push(bid); auction.status = 'OPEN'; auction.highestBidId = bid.id; if (previous && previous !== bidderId) this.notify(previous, 'AUCTION_OUTBID', 'AUCTION', auction.id, '入札額が更新されました', '再入札できます。'); this.touch(); return ok(clone(bid), this.state.stateVersion); }

  search(query: string, filters: SearchFilters = {}): Listing[] { const tokens = query.toLowerCase().split(/[\s\u3000]+/u).filter(Boolean); return this.state.listings.filter((listing) => { const item = this.item(listing.itemId); if (!item) return false; const text = `${item.title} ${item.description} ${listing.categoryId} ${listing.brandId ?? ''} ${Object.values(listing.attributes).join(' ')}`.toLowerCase(); return tokens.every((token) => text.includes(token)) && (!filters.category || listing.categoryId === filters.category) && (!filters.brand || listing.brandId === filters.brand) && (!filters.condition || item.condition === filters.condition) && (filters.priceMin === undefined || listing.price >= filters.priceMin) && (filters.priceMax === undefined || listing.price <= filters.priceMax) && (!filters.saleType || listing.saleType === filters.saleType) && (!filters.availability || (filters.availability === 'AVAILABLE' ? listing.status === 'PUBLISHED' : listing.status === 'SOLD')); }).map(clone); }
  saveSearch(userId: string, input: Omit<SavedSearch, 'id' | 'userId' | 'createdAt'>): DomainResult<SavedSearch> { if (this.state.savedSearches.filter((value) => value.userId === userId).length >= 100) return fail('INVALID_INPUT', this.state.stateVersion, '保存できる検索条件は最大100件です'); const record: SavedSearch = { ...input, id: id('saved-search'), userId, createdAt: nowIso() }; this.state.savedSearches.push(record); this.touch(); return ok(clone(record), this.state.stateVersion); }
  getSellerManagement(userId: string) { return this.state.listings.filter((listing) => listing.sellerId === userId).map((listing) => ({ listing: clone(listing), item: clone(this.item(listing.itemId)), statusGroup: listing.status === 'PUBLISHED' ? '出品中' : listing.status === 'PAUSED' ? '公開停止中' : listing.status === 'TRANSACTION_STARTED' ? '取引中' : listing.status === 'SOLD' ? '売却済み' : '下書き' })); }
  getPurchaseHistory(userId: string) { return this.state.transactions.filter((transaction) => transaction.buyerId === userId).map((transaction) => ({ transaction: clone(transaction), listing: clone(this.listing(transaction.listingId)), item: clone(this.item(this.listing(transaction.listingId)?.itemId ?? '')) })); }
  getSalesHistory(userId: string) { return this.state.transactions.filter((transaction) => transaction.sellerId === userId).map((transaction) => ({ transaction: clone(transaction), listing: clone(this.listing(transaction.listingId)), item: clone(this.item(this.listing(transaction.listingId)?.itemId ?? '')) })); }
  getLegacyItems(): MercariItem[] { const currentUserId = this.state.currentUserId; return this.state.listings.filter((listing) => listing.status !== 'DELETED').map((listing) => { const item = this.item(listing.itemId)!; const seller = this.user(listing.sellerId); const comments = this.state.listingComments.filter((comment) => comment.listingId === listing.id && comment.status === 'ACTIVE').map((comment) => ({ id: comment.id, userName: comment.userName, userAvatar: comment.userAvatar, text: comment.text, date: comment.date })); const auction = this.state.auctions.find((value) => value.listingId === listing.id); const bid = auction?.highestBidId ? this.state.bids.find((value) => value.id === auction.highestBidId) : undefined; return { id: item.id, listingId: listing.id, sellerId: listing.sellerId, listingStatus: listing.status, listingVersion: listing.version, title: item.title, price: listing.price, images: this.state.listingImages.filter((image) => image.listingId === listing.id).sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.url), isSold: listing.status === 'SOLD', isAuction: listing.saleType === 'AUCTION', currentBid: bid?.amount, bidsCount: auction ? this.state.bids.filter((value) => value.auctionId === auction.id).length : undefined, timeLeft: auction ? `${Math.max(0, Math.ceil((new Date(auction.endsAt).getTime() - Date.now()) / 86_400_000))}日` : undefined, description: item.description, category: [listing.categoryId], condition: conditionToLegacy(item.condition), shippingFee: listing.shippingPayer === 'SELLER' ? '送料込み（出品者負担）' : '着払い（購入者負担）', shippingMethod: shippingLabel(listing.shippingMethod), origin: listing.shippingOrigin, shippingDays: `${listing.shippingDays}日で発送`, likesCount: listing.likesCount, isLiked: this.state.likes.some((like) => like.listingId === listing.id && like.userId === currentUserId), seller: { name: seller?.displayName ?? 'ユーザー', avatar: seller?.avatar ?? '', rating: seller?.ratingSummary.average ?? 0, ratingsCount: seller?.ratingSummary.count ?? 0, isVerified: seller?.identityVerificationStatus === 'VERIFIED', level: seller?.sellerLevel }, comments } satisfies MercariItem; }); }
  getTasks(userId = this.state.currentUserId) { return clone(this.state.tasks.filter((task) => task.userId === userId && !task.completedAt)); }
  getNotifications(userId = this.state.currentUserId) { return clone(this.state.notifications.filter((notification) => notification.userId === userId)); }
}

export const deriveTransactionPhase = (transaction: Pick<Transaction, 'transactionStatus' | 'paymentStatus' | 'fulfillmentStatus' | 'buyerRatingStatus' | 'sellerRatingStatus' | 'disputeStatus'>) => {
  if (transaction.disputeStatus === 'OPEN') return '返品・問題対応中';
  if (transaction.transactionStatus === 'CANCELED') return 'キャンセル済み';
  if (transaction.transactionStatus === 'COMPLETED') return '取引完了';
  if (transaction.paymentStatus === 'PENDING') return '支払い待ち';
  if (transaction.fulfillmentStatus === 'AWAITING_SHIPMENT') return '発送待ち';
  if (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(transaction.fulfillmentStatus)) return '配送中';
  if (transaction.fulfillmentStatus === 'DELIVERED' && transaction.buyerRatingStatus === 'PENDING') return '受取評価待ち';
  if (transaction.buyerRatingStatus === 'COMPLETED' && transaction.sellerRatingStatus === 'PENDING') return '出品者評価待ち';
  return '取引進行中';
};

export const domainInvariantNames = [
  '自分の商品を購入できない', '公開中以外の商品を購入できない', '1 Listingに同時成立Transactionは1件', '支払い前には発送できない', '発送前に配達済みにできない', '配達前に受取評価できない', '購入者評価前に出品者評価できない', '取引完了後はキャンセルできない', '問題がある場合は受取評価前にDisputeへ移れる', 'Transaction開始後は購入前コメントを追加できない', 'ブロックされたユーザーは新規購入できない', '価格変更後は古いCheckout価格で購入できない', '終了後Auctionへ入札できない', '最高額以下では入札できない', '入札済Auctionは公開停止できない', 'SOLD商品へ値下げ依頼できない', 'Auctionへ値下げ依頼できない', 'Bundle成立前に売れたらRequestを無効化', '返品完了前に返品済キャンセルを完了しない', '売上はTransaction完了時に確定する',
] as const;
