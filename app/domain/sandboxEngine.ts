import type {
  ActionResult,
  AgentActionOptions,
  AgentErrorCode,
  AuctionBidRecord,
  DomainEvent,
  ActorProfile,
  FollowDirection,
  FollowListResult,
  FollowMutationResult,
  FollowRelation,
  FollowSummary,
  InventoryMovement,
  MercariItem,
  NotificationItem,
  PaymentRecord,
  PolicyDecision,
  PolicySignal,
  PurchaseIntent,
  PurchasePricing,
  ReturnCase,
  SupportTicket,
  TransactionMessage,
  ReservationStatus,
  ReviewRecord,
  SandboxActor,
  SandboxSnapshot,
  ScenarioId,
  ShipmentRecord,
  TransactionRecord,
  TransactionStatus,
  WalletSnapshot,
} from '../types/mercari.ts';

const BASE_NOW = '2026-01-01T00:00:00.000Z';
const PURCHASE_INTENT_TTL_MS = 15 * 60 * 1000;
const POLICY_RULE_VERSION = 'furima-policy-2026-08-13';

const SCENARIOS: ScenarioId[] = [
  'catalog_default',
  'purchase_happy_path',
  'already_sold',
  'multi_inventory',
  'auction_outbid',
  'listing_policy_blocked',
  'zero_search_results',
  'payment_timeout',
  'delivery_delay',
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const resultOk = <T,>(data: T, stateVersion: number, events?: DomainEvent[], nextActions?: string[]): ActionResult<T> => ({
  ok: true,
  data,
  stateVersion,
  ...(events?.length ? { events } : {}),
  ...(nextActions?.length ? { nextActions } : {}),
});

const resultError = <T,>(error: AgentErrorCode, stateVersion: number, message?: string, details?: unknown): ActionResult<T> => ({
  ok: false,
  error,
  stateVersion,
  ...(message ? { message } : {}),
  ...(details === undefined ? {} : { details }),
});

const addMilliseconds = (iso: string, milliseconds: number): string => new Date(Date.parse(iso) + milliseconds).toISOString();

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIsoDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim();

const sellerIdForItem = (item: MercariItem): string => item.sellerId ?? 'seller_01';

const shippingCostFor = (item: MercariItem): number => item.shippingFee.includes('送料込み') ? 0 : 800;

const publicListingStatuses = new Set(['ACTIVE', 'RESERVED', 'SOLD']);
const sandboxControlScope = 'sandbox-control' as const;
const MAX_IMPORTED_STATE_BYTES = 8 * 1024 * 1024;
const MAX_LISTING_IMAGES = 20;
const MAX_SINGLE_IMAGE_BYTES = 2_000_000;
const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_LISTING_PRICE = 9_999_999;
const MIN_WALLET_AMOUNT = 1;
const MAX_WALLET_AMOUNT = 1_000_000;
const LISTING_CONDITIONS = new Set([
  '新品・未使用',
  '未使用に近い',
  '目立った傷や汚れなし',
  'やや傷や汚れあり',
  '傷や汚れあり',
  '全体的に状態が悪い',
]);
const LEGACY_LISTING_CONDITION_ALIASES = new Map([
  ['新品', '新品・未使用'],
  ['New', '新品・未使用'],
  ['Used - Like New', '未使用に近い'],
  ['Used - Good', '目立った傷や汚れなし'],
  ['Used - Fair', 'やや傷や汚れあり'],
]);

const canonicalListingCondition = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return LEGACY_LISTING_CONDITION_ALIASES.get(normalized) ?? normalized;
};

const unsafeContactText = (value: string): boolean => /https?:\/\/|www\.|(?:\d{2,4}-\d{2,4}-\d{3,4})|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(value);

const imagePayloadError = (images: unknown): string | null => {
  if (images === undefined) return null;
  if (!Array.isArray(images)) return 'images must be an array';
  if (images.length > MAX_LISTING_IMAGES) return `images must contain at most ${MAX_LISTING_IMAGES} entries`;
  let totalBytes = 0;
  for (const image of images) {
    if (typeof image !== 'string' || image.length > MAX_SINGLE_IMAGE_BYTES) return 'an image exceeds the per-file limit';
    totalBytes += image.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) return 'images exceed the total payload limit';
  }
  return null;
};

const imageReferenceError = (imageRefs: unknown): string | null => {
  if (imageRefs === undefined) return null;
  if (!Array.isArray(imageRefs)) return 'imageRefs must be an array';
  if (imageRefs.length > MAX_LISTING_IMAGES) return `imageRefs must contain at most ${MAX_LISTING_IMAGES} entries`;
  if (imageRefs.some((ref) => typeof ref !== 'string' || !/^media_[A-Za-z0-9_-]+$/u.test(ref))) return 'imageRefs must contain local media references';
  return null;
};

interface EventSpec {
  type: string;
  aggregateType: DomainEvent['aggregateType'];
  aggregateId: string;
  actorId: string;
  payload: Record<string, unknown>;
}

export interface SandboxEngineState {
  version: '1';
  sandboxId: string;
  scenarioId: ScenarioId;
  seed: string;
  now: string;
  stateVersion: number;
  idCounter: number;
  currentActorId: string;
  actors: SandboxActor[];
  items: MercariItem[];
  purchaseIntents: PurchaseIntent[];
  transactions: TransactionRecord[];
  payments: PaymentRecord[];
  shipments: ShipmentRecord[];
  bids: AuctionBidRecord[];
  reviews: ReviewRecord[];
  returns: ReturnCase[];
  messages: TransactionMessage[];
  supportTickets: SupportTicket[];
  profiles: ActorProfile[];
  inventoryMovements: InventoryMovement[];
  events: DomainEvent[];
  notifications: NotificationItem[];
  wallets: WalletSnapshot[];
  follows: FollowRelation[];
  drafts: Record<string, Partial<MercariItem>>;
  draftOwners: Record<string, string>;
  pendingFailures: string[];
}

export interface SandboxEngineOptions {
  sandboxId?: string;
  now?: string;
  seed?: string;
  notifications?: NotificationItem[];
}

export interface CreateDraftResult {
  draftId: string;
}

export interface StartPurchaseResult {
  purchaseIntentId: string;
  transactionId: string;
  expiresAt: string;
  quote: number;
}

export interface ConfirmPurchaseResult {
  transactionId: string;
  orderId: string;
  status: TransactionStatus;
  total: number;
}

export interface CloseAuctionResult {
  itemId: string;
  transactionId?: string;
  status: 'SETTLED' | 'NO_BIDS' | 'PAYMENT_FAILED';
}

export class SandboxEngine {
  private eventSubscribers: Set<(event: DomainEvent) => void> = new Set();
  private initialItems: MercariItem[];
  private readonly initialNotifications: NotificationItem[];
  private readonly sandboxId: string;
  private state: SandboxEngineState;

  public constructor(items: MercariItem[], options: SandboxEngineOptions = {}) {
    this.initialItems = clone(items);
    this.initialNotifications = clone(options.notifications ?? []);
    this.sandboxId = options.sandboxId ?? 'furima-demo';
    this.state = this.createState(this.initialItems, 'catalog_default', options.seed ?? 'catalog-seed-v1', options.now ?? BASE_NOW);
  }

  private normalizeCatalogItem(item: MercariItem, index: number, total: number, now: string): MercariItem {
    const quantity = item.isSold ? 0 : Math.max(0, Math.floor(item.inventoryQuantity ?? item.inventoryInitialQuantity ?? 1));
    const createdAt = item.createdAt ?? addMilliseconds(now, -(total - index) * 60 * 60 * 1000);
    const isSold = quantity === 0;
    return {
      ...item,
      sellerId: sellerIdForItem(item),
      createdAt,
      updatedAt: item.updatedAt ?? createdAt,
      isSold,
      inventoryPolicy: item.inventoryPolicy ?? 'SINGLE',
      inventoryInitialQuantity: item.inventoryInitialQuantity ?? Math.max(quantity, 1),
      inventoryQuantity: quantity,
      reservedQuantity: 0,
      listingStatus: isSold ? 'SOLD' : item.listingStatus ?? 'ACTIVE',
      auctionEndsAt: item.isAuction ? item.auctionEndsAt ?? addMilliseconds(now, 24 * 60 * 60 * 1000) : undefined,
      moderationStatus: item.moderationStatus ?? (item.listingStatus === 'HELD' ? 'HELD' : 'APPROVED'),
      qualityTier: item.qualityTier ?? (item.isDemo ? 'gold' : 'synthetic'),
    };
  }

  private createState(items: MercariItem[], scenarioId: ScenarioId, seed: string, now: string): SandboxEngineState {
    const normalizedItems = clone(items).map((item, index) => this.normalizeCatalogItem(item, index, items.length, now));
    const actors: SandboxActor[] = [
      { id: 'guest', role: 'guest', name: 'Guest', authenticated: false },
      { id: 'buyer_01', role: 'buyer', name: 'Sandbox Buyer A', authenticated: true },
      { id: 'buyer_02', role: 'buyer', name: 'Sandbox Buyer B', authenticated: true },
      { id: 'seller_01', role: 'seller', name: 'Sandbox Seller', authenticated: true },
      { id: 'admin_01', role: 'admin', name: 'Sandbox Moderator', authenticated: true },
      { id: 'platform', role: 'platform', name: 'Sandbox Platform', authenticated: true },
    ];
    const wallets = actors.filter((actor) => actor.authenticated).map<WalletSnapshot>((actor) => ({
      actorId: actor.id,
      openingBalance: actor.role === 'buyer' ? 200000 : 0,
      availableBalance: actor.role === 'buyer' ? 200000 : 0,
      heldBalance: 0,
      points: actor.role === 'buyer' ? 1000 : 0,
      ledger: [],
    }));
    const profiles = actors.map<ActorProfile>((actor) => ({
      actorId: actor.id,
      displayName: actor.name,
      bio: actor.role === 'admin' || actor.role === 'platform' ? 'Sandbox運営プロフィール' : 'Furima Sandboxのデモactorプロフィール',
      avatar: '/favicon.svg',
      rating: actor.role === 'guest' ? 0 : 5,
      ratingsCount: 0,
      completedSales: 0,
      completedPurchases: 0,
      isVerified: actor.role !== 'guest',
      updatedAt: now,
    }));
    return {
      version: '1',
      sandboxId: this.sandboxId,
      scenarioId,
      seed,
      now,
      stateVersion: 0,
      idCounter: 0,
      currentActorId: 'buyer_01',
      actors,
      items: normalizedItems,
      purchaseIntents: [],
      transactions: [],
      payments: [],
      shipments: [],
      bids: [],
      reviews: [],
      returns: [],
      messages: [],
      supportTickets: [],
      profiles,
      inventoryMovements: this.createInitialInventoryMovements(normalizedItems, now),
      events: [],
      notifications: clone(this.initialNotifications),
      wallets,
      follows: [],
      drafts: {},
      draftOwners: {},
      pendingFailures: scenarioId === 'payment_timeout' ? ['payment'] : scenarioId === 'delivery_delay' ? ['delivery'] : [],
    };
  }

  private createInitialInventoryMovements(items: MercariItem[], at: string): InventoryMovement[] {
    return items.flatMap((item) => {
      const initialQuantity = Math.max(1, item.inventoryInitialQuantity ?? item.inventoryQuantity ?? 1);
      const initialIn: InventoryMovement = {
        id: `seed-in-${item.id}`,
        itemId: item.id,
        sku: item.sku,
        type: 'IN',
        quantity: initialQuantity,
        reason: item.isDemo ? 'デモカタログ初期インポート' : '初期在庫',
        at,
      };
      if (!item.isSold) return [initialIn];
      return [initialIn, {
        id: `seed-out-${item.id}`,
        itemId: item.id,
        sku: item.sku,
        type: 'OUT',
        quantity: initialQuantity,
        reason: '初期SOLD状態',
        at,
      }];
    });
  }

  private nextId(prefix: string): string {
    this.state.idCounter += 1;
    return `${prefix}-${this.state.seed}-${this.state.idCounter.toString(36).padStart(5, '0')}`;
  }

  private currentActor(actorId?: string): SandboxActor | undefined {
    return this.state.actors.find((actor) => actor.id === (actorId ?? this.state.currentActorId));
  }

  private validateOptions(options?: AgentActionOptions): ActionResult<undefined> | null {
    if (options?.expectedStateVersion !== undefined && options.expectedStateVersion !== this.state.stateVersion) {
      return resultError('STATE_CONFLICT', this.state.stateVersion, '状態が更新されています。最新スナップショットを取得してください。', {
        expectedStateVersion: options.expectedStateVersion,
        actualStateVersion: this.state.stateVersion,
      });
    }
    if (options?.actorId && !this.currentActor(options.actorId)) return resultError('INVALID_ACTOR', this.state.stateVersion, '指定されたactorは存在しません');
    return null;
  }

  private validateControlOptions(options?: AgentActionOptions): ActionResult<undefined> | null {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid;
    if (options?.scope !== sandboxControlScope) {
      return resultError('FORBIDDEN', this.state.stateVersion, 'この操作はsandbox-control scopeからのみ実行できます');
    }
    const actor = this.actorFor(options);
    if (!actor?.authenticated || (actor.role !== 'admin' && actor.role !== 'platform')) {
      return resultError('FORBIDDEN', this.state.stateVersion, 'Sandbox制御はadmin/platformだけが実行できます');
    }
    return null;
  }

  private actorFor(options?: AgentActionOptions): SandboxActor | undefined {
    return this.currentActor(options?.actorId);
  }

  private commit(specs: EventSpec[]): DomainEvent[] {
    this.state.stateVersion += 1;
    const correlationId = this.nextId('correlation');
    const events = specs.map((spec) => ({
      id: this.nextId('event'),
      type: spec.type,
      actorId: spec.actorId,
      aggregateType: spec.aggregateType,
      aggregateId: spec.aggregateId,
      at: this.state.now,
      stateVersion: this.state.stateVersion,
      payload: clone(spec.payload),
      correlationId,
    } satisfies DomainEvent));
    this.state.events = [...this.state.events.slice(-499), ...events];
    if (events.length && this.eventSubscribers.size) {
      const subscribers = [...this.eventSubscribers];
      for (const event of events) {
        const eventSnapshot = clone(event);
        queueMicrotask(() => {
          for (const subscriber of subscribers) {
            try {
              subscriber(clone(eventSnapshot));
            } catch {
              // A subscriber must never roll back or corrupt committed domain state.
            }
          }
        });
      }
    }
    return events;
  }

  private addNotification(actorId: string, title: string, content: string, eventId?: string): void {
    if (this.state.pendingFailures.includes('notification')) {
      this.state.pendingFailures = this.state.pendingFailures.filter((failure) => failure !== 'notification');
      return;
    }
    this.state.notifications = [{
      id: this.nextId('notification'),
      type: 'you' as const,
      title,
      content,
      date: this.state.now,
      isRead: false,
      actorId,
      eventId,
    }, ...this.state.notifications].slice(0, 200);
  }

  private recordInventoryMovement(item: MercariItem, type: InventoryMovement['type'], quantity: number, reason: string, referenceId?: string): void {
    this.state.inventoryMovements = [...this.state.inventoryMovements.slice(-1999), {
      id: this.nextId('inventory-movement'),
      itemId: item.id,
      sku: item.sku,
      type,
      quantity,
      reason,
      referenceId,
      at: this.state.now,
    }];
  }

  private item(itemId: string): MercariItem | undefined {
    return this.state.items.find((candidate) => candidate.id === itemId);
  }

  private updateItem(itemId: string, update: Partial<MercariItem>): MercariItem | undefined {
    const target = this.item(itemId);
    if (!target) return undefined;
    const next = { ...target, ...update, updatedAt: this.state.now };
    this.state.items = this.state.items.map((candidate) => candidate.id === itemId ? next : candidate);
    return next;
  }

  private wallet(actorId: string): WalletSnapshot | undefined {
    return this.state.wallets.find((wallet) => wallet.actorId === actorId);
  }

  private addLedger(actorId: string, type: WalletSnapshot['ledger'][number]['type'], amount: number, referenceId: string): void {
    const wallet = this.wallet(actorId);
    if (!wallet) return;
    wallet.ledger = [...wallet.ledger, { id: this.nextId('ledger'), type, amount, referenceId, at: this.state.now }];
    if (type === 'DEPOSIT') {
      wallet.availableBalance += amount;
    } else if (type === 'WITHDRAWAL') {
      wallet.availableBalance -= amount;
    } else if (type === 'HOLD') {
      wallet.availableBalance -= amount;
      wallet.heldBalance += amount;
    } else if (type === 'CAPTURE') {
      wallet.heldBalance = Math.max(0, wallet.heldBalance - amount);
    } else if (type === 'REFUND') {
      wallet.availableBalance += amount;
    } else if (type === 'SALE') {
      wallet.availableBalance += amount;
    } else if (type === 'FEE') {
      wallet.availableBalance -= amount;
    }
  }

  private releaseWalletHold(actorId: string, amount: number, referenceId: string): number {
    const wallet = this.wallet(actorId);
    if (!wallet || amount <= 0) return 0;
    const heldForReference = wallet.ledger
      .filter((entry) => entry.referenceId === referenceId)
      .reduce((balance, entry) => entry.type === 'HOLD' ? balance + entry.amount : entry.type === 'CAPTURE' || entry.type === 'REFUND' ? balance - entry.amount : balance, 0);
    const releaseAmount = Math.min(amount, Math.max(0, heldForReference), wallet.heldBalance);
    if (releaseAmount <= 0) return 0;
    wallet.ledger = [...wallet.ledger, { id: this.nextId('ledger'), type: 'REFUND', amount: releaseAmount, referenceId, at: this.state.now }];
    wallet.heldBalance -= releaseAmount;
    wallet.availableBalance += releaseAmount;
    return releaseAmount;
  }

  private activeReservationQuantity(itemId: string): number {
    return this.state.purchaseIntents
      .filter((intent) => intent.itemId === itemId && intent.status === 'ACTIVE')
      .reduce((sum, intent) => sum + intent.quantity, 0);
  }

  private auctionHoldReference(itemId: string, bidderId: string): string {
    return `auction:${itemId}:${bidderId}`;
  }

  private heldAmountForReference(actorId: string, referenceId: string): number {
    return this.wallet(actorId)?.ledger
      .filter((entry) => entry.referenceId === referenceId)
      .reduce((balance, entry) => entry.type === 'HOLD' ? balance + entry.amount : entry.type === 'CAPTURE' || entry.type === 'REFUND' ? balance - entry.amount : balance, 0) ?? 0;
  }

  private releaseExpiredPurchaseIntents(actorId: string): { ids: string[]; specs: EventSpec[] } {
    const ids: string[] = [];
    const specs: EventSpec[] = [];
    this.state.purchaseIntents.forEach((intent) => {
      if (intent.status !== 'ACTIVE' || Date.parse(intent.expiresAt) > Date.parse(this.state.now)) return;
      ids.push(intent.id);
      specs.push(...this.releaseIntent(intent, 'EXPIRED', actorId));
    });
    return { ids, specs };
  }

  private activeIntentFor(itemId: string, buyerId: string): PurchaseIntent | undefined {
    return this.state.purchaseIntents.find((intent) => intent.itemId === itemId && intent.buyerId === buyerId && intent.status === 'ACTIVE');
  }

  private releaseIntent(intent: PurchaseIntent, status: Extract<ReservationStatus, 'RELEASED' | 'EXPIRED'>, actorId: string): EventSpec[] {
    if (intent.status !== 'ACTIVE') return [];
    intent.status = status;
    const transaction = this.state.transactions.find((candidate) => candidate.id === intent.transactionId);
    const item = this.item(intent.itemId);
    if (transaction && (transaction.status === 'PAYMENT_PENDING' || transaction.status === 'CREATED')) {
      transaction.status = status === 'EXPIRED' ? 'CANCELED' : 'CANCELED';
      transaction.canceledAt = this.state.now;
      transaction.cancelReason = status === 'EXPIRED' ? '購入手続きの期限切れ' : '購入手続きの取消';
      transaction.updatedAt = this.state.now;
      this.releaseWalletHold(intent.buyerId, transaction.total, transaction.id);
    }
    if (item) {
      const nextReserved = this.activeReservationQuantity(item.id);
      this.updateItem(item.id, {
        reservedQuantity: nextReserved,
        listingStatus: (item.inventoryQuantity ?? 0) <= 0 ? 'SOLD' : nextReserved > 0 ? 'RESERVED' : 'ACTIVE',
        isSold: (item.inventoryQuantity ?? 0) <= 0,
      });
      this.recordInventoryMovement(item, 'RELEASE', intent.quantity, status === 'EXPIRED' ? '購入予約期限切れ' : '購入予約解放', intent.id);
    }
    return [{
      type: status === 'EXPIRED' ? 'PURCHASE_INTENT_EXPIRED' : 'PURCHASE_INTENT_RELEASED',
      aggregateType: 'inventory',
      aggregateId: intent.itemId,
      actorId,
      payload: { purchaseIntentId: intent.id, transactionId: intent.transactionId, reason: transaction?.cancelReason },
    }];
  }

  public getItems(): MercariItem[] {
    return clone(this.state.items);
  }

  public getItem(itemId: string): MercariItem | undefined {
    return clone(this.item(itemId));
  }

  public mergeCatalogItems(items: MercariItem[]): void {
    const existingInitialIds = new Set(this.initialItems.map((item) => item.id));
    const additions = clone(items).filter((item) => !existingInitialIds.has(item.id));
    if (!additions.length) return;
    this.initialItems = [...this.initialItems, ...additions];
    const existingStateIds = new Set(this.state.items.map((item) => item.id));
    const stateAdditions = additions
      .filter((item) => !existingStateIds.has(item.id))
      .map((item, index) => this.normalizeCatalogItem(item, this.state.items.length + index, this.state.items.length + additions.length, this.state.now));
    if (!stateAdditions.length) return;
    this.state.items = [...this.state.items, ...stateAdditions];
    this.state.inventoryMovements = [...this.state.inventoryMovements, ...this.createInitialInventoryMovements(stateAdditions, this.state.now)];
  }

  public getInventoryMovements(itemId?: string): InventoryMovement[] {
    return clone(this.state.inventoryMovements.filter((movement) => !itemId || movement.itemId === itemId));
  }

  public getVisibleInventoryMovements(actorId = this.state.currentActorId, itemId?: string): InventoryMovement[] {
    const actor = this.state.actors.find((candidate) => candidate.id === actorId) ?? this.getCurrentActor();
    if (actor.role === 'admin' || actor.role === 'platform') return this.getInventoryMovements(itemId);
    const visibleTransactionIds = new Set(this.state.transactions
      .filter((transaction) => transaction.buyerId === actor.id || transaction.sellerId === actor.id)
      .map((transaction) => transaction.id));
    const visibleIntentIds = new Set(this.state.purchaseIntents
      .filter((intent) => intent.buyerId === actor.id)
      .map((intent) => intent.id));
    return clone(this.state.inventoryMovements.filter((movement) => {
      if (itemId && movement.itemId !== itemId) return false;
      if (!movement.referenceId) return true;
      return visibleTransactionIds.has(movement.referenceId) || visibleIntentIds.has(movement.referenceId);
    }));
  }

  public getTransactions(actorId?: string): TransactionRecord[] {
    return clone(this.state.transactions.filter((transaction) => !actorId || transaction.buyerId === actorId || transaction.sellerId === actorId));
  }

  public subscribe(handler: (event: DomainEvent) => void): () => void {
    this.eventSubscribers.add(handler);
    return () => this.eventSubscribers.delete(handler);
  }

  public getDomainEvents(): DomainEvent[] {
    return clone(this.state.events);
  }

  public getNotifications(): NotificationItem[] {
    return clone(this.state.notifications);
  }

  public getNow(): string {
    return this.state.now;
  }

  public getStateVersion(): number {
    return this.state.stateVersion;
  }

  public getSandboxId(): string {
    return this.state.sandboxId;
  }

  public getCurrentActor(): SandboxActor {
    return clone(this.currentActor() ?? this.state.actors[0]);
  }

  public getSnapshot(): SandboxSnapshot {
    const violations = this.assertInvariants();
    return {
      version: '1',
      sandboxId: this.state.sandboxId,
      scenarioId: this.state.scenarioId,
      seed: this.state.seed,
      now: this.state.now,
      stateVersion: this.state.stateVersion,
      currentActor: this.getCurrentActor(),
      actors: clone(this.state.actors),
      purchaseIntents: clone(this.state.purchaseIntents),
      transactions: clone(this.state.transactions),
      payments: clone(this.state.payments),
      shipments: clone(this.state.shipments),
      bids: clone(this.state.bids),
      reviews: clone(this.state.reviews),
      returns: clone(this.state.returns),
      messages: clone(this.state.messages),
      supportTickets: clone(this.state.supportTickets),
      profiles: clone(this.state.profiles),
      events: clone(this.state.events),
      notifications: clone(this.state.notifications),
      wallets: clone(this.state.wallets),
      follows: clone(this.state.follows),
      invariantViolations: violations,
      pendingFailures: [...this.state.pendingFailures],
    };
  }

  /**
   * Agent-facing snapshot. The local inspector can still use getSnapshot(),
   * while ordinary actors receive only their own financial and transaction
   * records. This keeps sandbox-control telemetry separate from user data.
   */
  public getScopedSnapshot(actorId = this.state.currentActorId): SandboxSnapshot {
    const snapshot = this.getSnapshot();
    const actor = this.state.actors.find((candidate) => candidate.id === actorId) ?? this.getCurrentActor();
    if (actor.role === 'admin' || actor.role === 'platform') return snapshot;
    const visibleTransactionIds = new Set(snapshot.transactions
      .filter((transaction) => transaction.buyerId === actor.id || transaction.sellerId === actor.id)
      .map((transaction) => transaction.id));
    return {
      ...snapshot,
      currentActor: clone(actor),
      purchaseIntents: snapshot.purchaseIntents.filter((intent) => intent.buyerId === actor.id),
      transactions: snapshot.transactions.filter((transaction) => visibleTransactionIds.has(transaction.id)),
      payments: snapshot.payments.filter((payment) => visibleTransactionIds.has(payment.transactionId)),
      shipments: snapshot.shipments.filter((shipment) => visibleTransactionIds.has(shipment.transactionId)),
      bids: snapshot.bids.filter((bid) => bid.bidderId === actor.id),
      reviews: snapshot.reviews.filter((review) => review.reviewerId === actor.id || review.revieweeId === actor.id),
      returns: snapshot.returns?.filter((returnCase) => returnCase.requesterId === actor.id || visibleTransactionIds.has(returnCase.transactionId)),
      messages: snapshot.messages?.filter((message) => visibleTransactionIds.has(message.transactionId)),
      supportTickets: snapshot.supportTickets?.filter((ticket) => ticket.reporterId === actor.id),
      profiles: snapshot.profiles?.filter((profile) => profile.actorId === actor.id),
      events: snapshot.events.filter((event) => event.actorId === actor.id || visibleTransactionIds.has(event.aggregateId)),
      notifications: snapshot.notifications.filter((notification) => !notification.actorId || notification.actorId === actor.id),
      wallets: snapshot.wallets.filter((wallet) => wallet.actorId === actor.id),
      follows: snapshot.follows.filter((follow) => follow.followerId === actor.id || follow.followeeId === actor.id),
      pendingFailures: [],
    };
  }

  public getVisibleTransactions(actorId?: string): TransactionRecord[] {
    const actor = this.state.actors.find((candidate) => candidate.id === this.state.currentActorId);
    if (actor?.role === 'admin' || actor?.role === 'platform') return this.getTransactions(actorId);
    const targetActorId = actorId ?? this.state.currentActorId;
    if (targetActorId !== this.state.currentActorId) return [];
    return this.getTransactions(targetActorId);
  }

  public getVisibleDomainEvents(actorId = this.state.currentActorId): DomainEvent[] {
    const actor = this.state.actors.find((candidate) => candidate.id === this.state.currentActorId);
    if (actor?.role === 'admin' || actor?.role === 'platform') return this.getDomainEvents();
    return this.getScopedSnapshot(actorId).events;
  }

  public getProfile(actorId = this.state.currentActorId): ActorProfile | undefined {
    const profile = this.state.profiles.find((candidate) => candidate.actorId === actorId);
    return profile ? clone(profile) : undefined;
  }

  private followSummaryFor(targetActorId: string, viewerActorId = this.state.currentActorId): FollowSummary {
    return {
      actorId: targetActorId,
      followingCount: this.state.follows.filter((follow) => follow.followerId === targetActorId).length,
      followerCount: this.state.follows.filter((follow) => follow.followeeId === targetActorId).length,
      isFollowing: this.state.follows.some((follow) => follow.followerId === viewerActorId && follow.followeeId === targetActorId),
    };
  }

  private followActor(options?: AgentActionOptions): { actor: SandboxActor } | ActionResult<never> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<never>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion, 'フォロー機能を利用するにはログインが必要です');
    const current = this.getCurrentActor();
    if (actor.id !== current.id && current.role !== 'admin' && current.role !== 'platform' && options?.scope !== 'sandbox-control') {
      return resultError('FORBIDDEN', this.state.stateVersion, '現在のactor以外のフォロー情報は変更できません');
    }
    return { actor };
  }

  public getFollowSummary(actorId = this.state.currentActorId, options?: AgentActionOptions): ActionResult<FollowSummary> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<FollowSummary>;
    const target = this.currentActor(actorId);
    if (!target?.authenticated) return resultError('FOLLOW_TARGET_NOT_FOUND', this.state.stateVersion, 'フォロー対象のユーザーが見つかりません');
    const viewer = this.actorFor(options) ?? this.getCurrentActor();
    return resultOk(this.followSummaryFor(target.id, viewer.authenticated ? viewer.id : 'guest'), this.state.stateVersion);
  }

  public getFollowList(direction: FollowDirection, options?: AgentActionOptions): ActionResult<FollowListResult> {
    const actorResult = this.followActor(options);
    if ('ok' in actorResult) return actorResult as ActionResult<FollowListResult>;
    if (direction !== 'following' && direction !== 'followers') return resultError('INVALID_INPUT', this.state.stateVersion, 'フォロー一覧の方向はfollowingまたはfollowersで指定してください');
    const actor = actorResult.actor;
    const relations = this.state.follows
      .filter((follow) => direction === 'following' ? follow.followerId === actor.id : follow.followeeId === actor.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const targetIds = relations.map((follow) => direction === 'following' ? follow.followeeId : follow.followerId);
    const users = targetIds
      .map((targetId) => this.getProfile(targetId))
      .filter((profile): profile is ActorProfile => Boolean(profile));
    return resultOk({ actorId: actor.id, direction, users, summary: this.followSummaryFor(actor.id, actor.id) }, this.state.stateVersion);
  }

  public followUser(targetActorId: string, options?: AgentActionOptions): ActionResult<FollowMutationResult> {
    const actorResult = this.followActor(options);
    if ('ok' in actorResult) return actorResult as ActionResult<FollowMutationResult>;
    const actor = actorResult.actor;
    const target = this.currentActor(targetActorId);
    if (!target?.authenticated) return resultError('FOLLOW_TARGET_NOT_FOUND', this.state.stateVersion, 'フォロー対象のユーザーが見つかりません');
    if (target.id === actor.id) return resultError('CANNOT_FOLLOW_SELF', this.state.stateVersion, '自分自身はフォローできません');
    if (this.state.follows.some((follow) => follow.followerId === actor.id && follow.followeeId === target.id)) {
      return resultError('ALREADY_FOLLOWING', this.state.stateVersion, 'このユーザーはすでにフォローしています');
    }
    const relation: FollowRelation = { id: this.nextId('follow'), followerId: actor.id, followeeId: target.id, createdAt: this.state.now };
    this.state.follows.push(relation);
    const events = this.commit([{ type: 'FOLLOW_CREATED', aggregateType: 'system', aggregateId: target.id, actorId: actor.id, payload: { relationId: relation.id, followerId: actor.id, followeeId: target.id } }]);
    return resultOk({ actorId: actor.id, targetActorId: target.id, following: true, relation: clone(relation), summary: this.followSummaryFor(target.id, actor.id) }, this.state.stateVersion, events);
  }

  public unfollowUser(targetActorId: string, options?: AgentActionOptions): ActionResult<FollowMutationResult> {
    const actorResult = this.followActor(options);
    if ('ok' in actorResult) return actorResult as ActionResult<FollowMutationResult>;
    const actor = actorResult.actor;
    const target = this.currentActor(targetActorId);
    if (!target?.authenticated) return resultError('FOLLOW_TARGET_NOT_FOUND', this.state.stateVersion, 'フォロー対象のユーザーが見つかりません');
    const relation = this.state.follows.find((follow) => follow.followerId === actor.id && follow.followeeId === target.id);
    if (!relation) return resultError('NOT_FOLLOWING', this.state.stateVersion, 'このユーザーはフォローしていません');
    this.state.follows = this.state.follows.filter((follow) => follow.id !== relation.id);
    const events = this.commit([{ type: 'FOLLOW_REMOVED', aggregateType: 'system', aggregateId: target.id, actorId: actor.id, payload: { relationId: relation.id, followerId: actor.id, followeeId: target.id } }]);
    return resultOk({ actorId: actor.id, targetActorId: target.id, following: false, summary: this.followSummaryFor(target.id, actor.id) }, this.state.stateVersion, events);
  }

  private validateWalletAmount(amount: number): ActionResult<undefined> | null {
    if (!isInteger(amount) || amount < MIN_WALLET_AMOUNT || amount > MAX_WALLET_AMOUNT) {
      return resultError('INVALID_AMOUNT', this.state.stateVersion, `金額は${MIN_WALLET_AMOUNT.toLocaleString()}〜${MAX_WALLET_AMOUNT.toLocaleString()}円の整数で指定してください`);
    }
    return null;
  }

  private walletForAuthenticatedActor(options?: AgentActionOptions): { actor: SandboxActor; wallet: WalletSnapshot } | ActionResult<never> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<never>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion, 'ウォレットを利用するにはログインが必要です');
    const wallet = this.wallet(actor.id);
    if (!wallet) return resultError('WALLET_NOT_FOUND', this.state.stateVersion, 'このactorのウォレットが見つかりません');
    return { actor, wallet };
  }

  public getWallet(options?: AgentActionOptions): ActionResult<WalletSnapshot> {
    const result = this.walletForAuthenticatedActor(options);
    if ('ok' in result) return result as ActionResult<WalletSnapshot>;
    return resultOk(clone(result.wallet), this.state.stateVersion);
  }

  public depositWallet(amount: number, options?: AgentActionOptions): ActionResult<WalletSnapshot> {
    const result = this.walletForAuthenticatedActor(options);
    if ('ok' in result) return result as ActionResult<WalletSnapshot>;
    const invalidAmount = this.validateWalletAmount(amount);
    if (invalidAmount) return invalidAmount as ActionResult<WalletSnapshot>;
    this.addLedger(result.actor.id, 'DEPOSIT', amount, this.nextId('wallet-deposit'));
    const events = this.commit([{ type: 'WALLET_DEPOSITED', aggregateType: 'system', aggregateId: `wallet:${result.actor.id}`, actorId: result.actor.id, payload: { amount } }]);
    return resultOk(clone(result.wallet), this.state.stateVersion, events);
  }

  public withdrawWallet(amount: number, options?: AgentActionOptions): ActionResult<WalletSnapshot> {
    const result = this.walletForAuthenticatedActor(options);
    if ('ok' in result) return result as ActionResult<WalletSnapshot>;
    const invalidAmount = this.validateWalletAmount(amount);
    if (invalidAmount) return invalidAmount as ActionResult<WalletSnapshot>;
    if (result.wallet.availableBalance < amount) return resultError('INSUFFICIENT_FUNDS', this.state.stateVersion, '利用可能残高が不足しています', { availableBalance: result.wallet.availableBalance, requestedAmount: amount });
    this.addLedger(result.actor.id, 'WITHDRAWAL', amount, this.nextId('wallet-withdrawal'));
    const events = this.commit([{ type: 'WALLET_WITHDRAWN', aggregateType: 'system', aggregateId: `wallet:${result.actor.id}`, actorId: result.actor.id, payload: { amount } }]);
    return resultOk(clone(result.wallet), this.state.stateVersion, events);
  }

  public updateProfile(input: Partial<ActorProfile>, options?: AgentActionOptions): ActionResult<ActorProfile> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<ActorProfile>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    const targetId = typeof input.actorId === 'string' ? input.actorId : actor.id;
    if (targetId !== actor.id && actor.role !== 'admin' && actor.role !== 'platform') return resultError('FORBIDDEN', this.state.stateVersion);
    const profile = this.state.profiles.find((candidate) => candidate.actorId === targetId);
    if (!profile) return resultError('INVALID_ACTOR', this.state.stateVersion);
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : profile.displayName;
    const bio = typeof input.bio === 'string' ? input.bio.trim() : profile.bio;
    const avatarRef = input.avatarRef === undefined ? profile.avatarRef : input.avatarRef;
    if (!displayName || displayName.length > 60 || bio.length > 500 || unsafeContactText(`${displayName} ${bio}`) || (avatarRef !== undefined && avatarRef !== '' && !/^media_[A-Za-z0-9_-]+$/u.test(avatarRef))) return resultError('INVALID_INPUT', this.state.stateVersion, 'プロフィールは連絡先を含まない文字数制限内で指定してください');
    Object.assign(profile, { displayName, bio, avatarRef: avatarRef || undefined, avatar: '/favicon.svg', updatedAt: this.state.now });
    this.state.items = this.state.items.map((item) => item.sellerId === targetId ? { ...item, seller: { ...item.seller, name: displayName, avatar: '/favicon.svg', avatarRef: avatarRef || undefined }, updatedAt: this.state.now } : item);
    const events = this.commit([{ type: 'PROFILE_UPDATED', aggregateType: 'system', aggregateId: targetId, actorId: actor.id, payload: { targetId } }]);
    return resultOk(clone(profile), this.state.stateVersion, events);
  }

  public getCapabilities() {
    return {
      apiVersion: '1' as const,
      scenarios: [...SCENARIOS],
      actors: clone(this.state.actors),
      commands: [
        'navigateTab', 'navigateHomeSubTab', 'navigateCategory', 'search', 'openItem', 'setLiked', 'setSaved', 'addComment',
        'createListingDraft', 'updateListingDraft', 'getListingDrafts', 'deleteListingDraft', 'submitListing', 'listItem', 'startPurchase', 'confirmPurchase', 'shipOrder',
        'markDelivered', 'reviewOrder', 'cancelOrder', 'resolveCancellation', 'reviewListing', 'requestReturn', 'confirmReturnReceived', 'sendTransactionMessage', 'createSupportTicket', 'reportTransaction', 'updateListing', 'pauseListing', 'resumeListing', 'relistItem', 'placeBid', 'closeAuction', 'switchActor', 'loadScenario',
        'advanceClock', 'injectFailure', 'resetScenario', 'previewAction', 'commitPreview', 'exportState', 'importState', 'getWallet', 'depositWallet', 'withdrawWallet', 'getProfile', 'updateProfile', 'getFollowList', 'getFollowSummary', 'followUser', 'unfollowUser',
      ],
      errorCodes: [
        'ITEM_NOT_FOUND', 'ALREADY_SOLD', 'BID_TOO_LOW', 'NOT_AUCTION', 'INVALID_INPUT', 'DRAFT_NOT_FOUND',
        'INVALID_TAB', 'CONFIRMATION_REQUIRED', 'AUTH_REQUIRED', 'POLICY_REVIEW_REQUIRED', 'POLICY_BLOCKED',
        'INVALID_ACTOR', 'FORBIDDEN', 'STATE_CONFLICT', 'PURCHASE_INTENT_EXPIRED', 'PAYMENT_FAILED', 'PREVIEW_NOT_FOUND', 'PREVIEW_EXPIRED',
        'TRANSACTION_NOT_FOUND', 'INVALID_TRANSITION', 'IDEMPOTENCY_CONFLICT', 'UNKNOWN_SCENARIO', 'AUCTION_ENDED',
        'INVALID_AMOUNT', 'INSUFFICIENT_FUNDS', 'WALLET_NOT_FOUND', 'FOLLOW_TARGET_NOT_FOUND', 'ALREADY_FOLLOWING', 'NOT_FOLLOWING', 'CANNOT_FOLLOW_SELF', 'NO_RESULTS', 'UNSUPPORTED_CATEGORY',
      ] satisfies AgentErrorCode[],
    };
  }

  public startPurchase(itemId: string, options?: AgentActionOptions): ActionResult<StartPurchaseResult> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<StartPurchaseResult>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion, '購入にはログイン済みbuyer actorが必要です');
    if (actor.role !== 'buyer') return resultError('FORBIDDEN', this.state.stateVersion, '購入を実行できるのはbuyer actorだけです');
    const expired = this.releaseExpiredPurchaseIntents(actor.id);
    if (expired.specs.length) {
      this.commit(expired.specs);
      expired.ids.forEach((intentId) => {
        const expiredIntent = this.state.purchaseIntents.find((intent) => intent.id === intentId);
        this.addNotification(expiredIntent?.buyerId ?? actor.id, '購入予約の期限が切れました', '在庫予約を解放しました。もう一度購入手続きを開始してください。');
      });
    }
    const item = this.item(itemId);
    if (!item) return resultError('ITEM_NOT_FOUND', this.state.stateVersion);
    if (item.isAuction) return resultError('INVALID_TRANSITION', this.state.stateVersion, 'オークション商品は入札コマンドを使用してください');
    if (item.listingStatus === 'HELD') return resultError('POLICY_REVIEW_REQUIRED', this.state.stateVersion, 'この商品は審査完了まで購入できません');
    if (item.listingStatus && !publicListingStatuses.has(item.listingStatus)) return resultError('INVALID_TRANSITION', this.state.stateVersion, 'この商品は現在公開購入できる状態ではありません');
    if ((item.inventoryQuantity ?? 0) - (item.reservedQuantity ?? 0) <= 0 || item.isSold) return resultError('ALREADY_SOLD', this.state.stateVersion, 'この商品は購入できません');
    const existing = this.activeIntentFor(itemId, actor.id);
    if (existing) {
      return resultOk({ purchaseIntentId: existing.id, transactionId: existing.transactionId, expiresAt: existing.expiresAt, quote: existing.quote }, this.state.stateVersion, undefined, ['ConfirmCheckout', 'CancelPurchase']);
    }
    const createdAt = this.state.now;
    const intentId = this.nextId('purchase-intent');
    const transactionId = this.nextId('txn');
    const paymentId = this.nextId('payment');
    const shipmentId = this.nextId('shipment');
    const total = item.price + shippingCostFor(item);
    const buyerWallet = this.wallet(actor.id);
    if (!buyerWallet || buyerWallet.availableBalance < total) {
      return resultError('PAYMENT_FAILED', this.state.stateVersion, 'Sandboxウォレットの残高が不足しています', { required: total, available: buyerWallet?.availableBalance ?? 0, retryable: false });
    }
    const intent: PurchaseIntent = {
      id: intentId,
      transactionId,
      itemId,
      buyerId: actor.id,
      quantity: 1,
      quote: total,
      createdAt,
      expiresAt: addMilliseconds(createdAt, PURCHASE_INTENT_TTL_MS),
      expectedStateVersion: this.state.stateVersion + 1,
      status: 'ACTIVE',
    };
    const transaction: TransactionRecord = {
      id: transactionId,
      orderId: this.nextId('order').toUpperCase(),
      itemId,
      buyerId: actor.id,
      sellerId: sellerIdForItem(item),
      titleSnapshot: item.title,
      priceSnapshot: item.price,
      shippingCost: shippingCostFor(item),
      total,
      status: 'PAYMENT_PENDING',
      paymentId,
      shipmentId,
      reservationId: intentId,
      createdAt,
      updatedAt: createdAt,
    };
    const payment: PaymentRecord = { id: paymentId, transactionId, method: 'sandbox-wallet', amount: total, status: 'INITIATED', createdAt, updatedAt: createdAt };
    const shipment: ShipmentRecord = { id: shipmentId, transactionId, method: item.shippingMethod, status: 'PENDING', createdAt, updatedAt: createdAt };
    this.state.purchaseIntents.push(intent);
    this.state.transactions.push(transaction);
    this.state.payments.push(payment);
    this.state.shipments.push(shipment);
    this.addLedger(actor.id, 'HOLD', total, transactionId);
    const nextReserved = (item.reservedQuantity ?? 0) + 1;
    const nextQuantity = item.inventoryQuantity ?? 0;
    this.updateItem(itemId, { reservedQuantity: nextReserved, listingStatus: nextQuantity - nextReserved <= 0 ? 'RESERVED' : item.listingStatus });
    this.recordInventoryMovement(item, 'RESERVE', 1, '購入予約', intentId);
    const events = this.commit([
      { type: 'PURCHASE_INTENT_CREATED', aggregateType: 'transaction', aggregateId: transactionId, actorId: actor.id, payload: { itemId, purchaseIntentId: intentId, expiresAt: intent.expiresAt, total } },
      { type: 'INVENTORY_RESERVED', aggregateType: 'inventory', aggregateId: itemId, actorId: actor.id, payload: { quantity: 1, reservationId: intentId } },
    ]);
    this.addNotification(actor.id, '購入手続きを開始しました', `${item.title}の購入予約を作成しました。${intent.expiresAt}までに確定してください。`, events[0]?.id);
    return resultOk({ purchaseIntentId: intentId, transactionId, expiresAt: intent.expiresAt, quote: total }, this.state.stateVersion, events, ['ConfirmCheckout', 'CancelPurchase']);
  }

  public purchaseItem(itemId: string, options?: AgentActionOptions): ActionResult<ConfirmPurchaseResult> {
    return this.purchaseItemWithPricing(itemId, undefined, options);
  }

  public purchaseItemWithPricing(itemId: string, pricing?: PurchasePricing, options?: AgentActionOptions): ActionResult<ConfirmPurchaseResult> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<ConfirmPurchaseResult>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion, '購入にはログイン済みbuyer actorが必要です');
    const intent = this.activeIntentFor(itemId, actor.id);
    if (!intent) return resultError('CONFIRMATION_REQUIRED', this.state.stateVersion, '先にstartPurchaseで購入予約を作成してください');
    const pricingResult = this.updatePurchasePricing(intent, pricing, actor.id);
    if (!pricingResult.ok) return pricingResult as ActionResult<ConfirmPurchaseResult>;
    // Quote updates advance the domain version. The optimistic check already
    // happened at the start of this synchronous checkout command.
    const confirmOptions = options?.expectedStateVersion === undefined ? options : { ...options, expectedStateVersion: undefined };
    return this.confirmPurchase(intent.id, confirmOptions);
  }

  private updatePurchasePricing(intent: PurchaseIntent, pricing: PurchasePricing | undefined, actorId: string): ActionResult<undefined> {
    if (!pricing || (pricing.couponDiscount ?? 0) === 0 && (pricing.pointsDiscount ?? 0) === 0) return resultOk(undefined, this.state.stateVersion);
    const item = this.item(intent.itemId);
    const transaction = this.state.transactions.find((candidate) => candidate.id === intent.transactionId);
    const wallet = this.wallet(actorId);
    if (!item || !transaction || !wallet) return resultError('STATE_CONFLICT', this.state.stateVersion, '購入集約の価格情報が見つかりません');
    if (intent.status !== 'ACTIVE') return resultError('INVALID_TRANSITION', this.state.stateVersion, '購入予約は価格変更できない状態です');
    const requestedCoupon = Math.max(0, Math.floor(pricing.couponDiscount ?? 0));
    const requestedPoints = Math.max(0, Math.floor(pricing.pointsDiscount ?? 0));
    const couponDiscount = requestedCoupon > 0
      ? item.isCouponEligible ? Math.min(requestedCoupon, 500, item.price) : 0
      : 0;
    const pointsDiscount = Math.min(requestedPoints, 200, wallet.points, Math.max(0, item.price - couponDiscount));
    if (requestedCoupon > 0 && couponDiscount === 0) return resultError('INVALID_INPUT', this.state.stateVersion, 'この商品はクーポン対象ではありません');
    if (requestedPoints > 0 && pointsDiscount !== requestedPoints) return resultError('INVALID_INPUT', this.state.stateVersion, '利用ポイントが保有ポイントまたは商品価格を超えています');
    const nextTotal = Math.max(0, item.price + shippingCostFor(item) - couponDiscount - pointsDiscount);
    const previousTotal = transaction.total;
    if (nextTotal !== previousTotal) {
      const released = this.releaseWalletHold(actorId, previousTotal, transaction.id);
      const walletAfterRelease = this.wallet(actorId);
      if (!walletAfterRelease || walletAfterRelease.availableBalance < nextTotal) {
        if (released > 0) this.addLedger(actorId, 'HOLD', released, transaction.id);
        return resultError('PAYMENT_FAILED', this.state.stateVersion, 'Sandboxウォレットの残高が不足しています', { required: nextTotal, available: walletAfterRelease?.availableBalance ?? 0, retryable: false });
      }
      this.addLedger(actorId, 'HOLD', nextTotal, transaction.id);
    }
    intent.quote = nextTotal;
    intent.couponDiscount = couponDiscount || undefined;
    intent.pointsDiscount = pointsDiscount || undefined;
    transaction.total = nextTotal;
    transaction.updatedAt = this.state.now;
    transaction.couponDiscount = couponDiscount || undefined;
    transaction.pointsUsed = pointsDiscount || undefined;
    const payment = this.state.payments.find((candidate) => candidate.id === transaction.paymentId);
    if (payment) {
      payment.amount = nextTotal;
      payment.updatedAt = this.state.now;
    }
    const events = this.commit([{ type: 'PURCHASE_QUOTE_UPDATED', aggregateType: 'transaction', aggregateId: transaction.id, actorId, payload: { total: nextTotal, couponDiscount, pointsDiscount } }]);
    return resultOk(undefined, this.state.stateVersion, events);
  }

  public confirmPurchase(purchaseIntentId: string, options?: AgentActionOptions): ActionResult<ConfirmPurchaseResult> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<ConfirmPurchaseResult>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion, '購入にはログイン済みbuyer actorが必要です');
    const intent = this.state.purchaseIntents.find((candidate) => candidate.id === purchaseIntentId);
    if (!intent) return resultError('CONFIRMATION_REQUIRED', this.state.stateVersion, '有効なpurchaseIntentIdを指定してください');
    if (intent.buyerId !== actor.id) return resultError('FORBIDDEN', this.state.stateVersion, 'この購入予約のbuyerではありません');
    if (intent.status !== 'ACTIVE') return resultError('INVALID_TRANSITION', this.state.stateVersion, '購入予約はすでに確定または解放されています');
    if (Date.parse(intent.expiresAt) <= Date.parse(this.state.now)) {
      const specs = this.releaseIntent(intent, 'EXPIRED', actor.id);
      const events = this.commit(specs);
      return resultError('PURCHASE_INTENT_EXPIRED', this.state.stateVersion, '購入予約の期限が切れています', { events });
    }
    if (options?.expectedStateVersion !== undefined && options.expectedStateVersion !== intent.expectedStateVersion) {
      return resultError('STATE_CONFLICT', this.state.stateVersion, '購入開始後に状態が変化しました');
    }
    const transaction = this.state.transactions.find((candidate) => candidate.id === intent.transactionId);
    const payment = this.state.payments.find((candidate) => candidate.id === transaction?.paymentId);
    const shipment = this.state.shipments.find((candidate) => candidate.id === transaction?.shipmentId);
    const item = this.item(intent.itemId);
    if (!transaction || !payment || !shipment || !item) return resultError('STATE_CONFLICT', this.state.stateVersion, '購入集約の関連データが見つかりません');
    if ((item.inventoryQuantity ?? 0) - (item.reservedQuantity ?? 0) < 0) return resultError('STATE_CONFLICT', this.state.stateVersion, '在庫不変条件に違反しています');
    if (this.state.pendingFailures.includes('payment')) {
      this.state.pendingFailures = this.state.pendingFailures.filter((failure) => failure !== 'payment');
      payment.status = 'FAILED';
      payment.updatedAt = this.state.now;
      const specs = this.releaseIntent(intent, 'RELEASED', actor.id);
      const events = this.commit([{ type: 'PAYMENT_FAILED', aggregateType: 'payment', aggregateId: payment.id, actorId: actor.id, payload: { transactionId: transaction.id, reason: 'injected_failure' } }, ...specs]);
      return resultError('PAYMENT_FAILED', this.state.stateVersion, 'Sandboxの決済エミュレータが失敗しました。再試行してください。', { events, retryable: true });
    }
    const buyerWallet = this.wallet(actor.id);
    if (!buyerWallet || (transaction.pointsUsed ?? 0) > buyerWallet.points) return resultError('PAYMENT_FAILED', this.state.stateVersion, '利用ポイントの残高が不足しています');
    const sellerNet = Math.max(0, transaction.priceSnapshot - Math.floor(transaction.priceSnapshot * 0.1));
    payment.status = 'CAPTURED';
    payment.updatedAt = this.state.now;
    transaction.status = 'AWAITING_SHIPMENT';
    transaction.paidAt = this.state.now;
    transaction.updatedAt = this.state.now;
    intent.status = 'COMMITTED';
    if (transaction.pointsUsed) buyerWallet.points -= transaction.pointsUsed;
    shipment.status = 'PENDING';
    shipment.updatedAt = this.state.now;
    const nextQuantity = Math.max(0, (item.inventoryQuantity ?? 0) - intent.quantity);
    const nextReserved = Math.max(0, (item.reservedQuantity ?? 0) - intent.quantity);
    const nextIsSold = nextQuantity === 0;
    this.updateItem(item.id, { inventoryQuantity: nextQuantity, reservedQuantity: nextReserved, isSold: nextIsSold, listingStatus: nextIsSold ? 'SOLD' : 'ACTIVE', soldAt: nextIsSold ? this.state.now : item.soldAt });
    this.recordInventoryMovement(item, 'OUT', intent.quantity, '決済確定', transaction.id);
    const events = this.commit([
      { type: 'PAYMENT_CAPTURED', aggregateType: 'payment', aggregateId: payment.id, actorId: actor.id, payload: { transactionId: transaction.id, amount: transaction.total } },
      { type: 'INVENTORY_COMMITTED', aggregateType: 'inventory', aggregateId: item.id, actorId: actor.id, payload: { quantity: intent.quantity, transactionId: transaction.id } },
      { type: 'TRANSACTION_PAID', aggregateType: 'transaction', aggregateId: transaction.id, actorId: actor.id, payload: { orderId: transaction.orderId, sellerNet } },
    ]);
    this.addNotification(transaction.sellerId, '商品が購入されました', `${transaction.titleSnapshot}の支払いが完了しました。発送してください。`, events.at(-1)?.id);
    this.addNotification(actor.id, '購入が確定しました', `${transaction.titleSnapshot}の支払いが完了しました。`, events.at(-1)?.id);
    return resultOk({ transactionId: transaction.id, orderId: transaction.orderId, status: transaction.status, total: transaction.total }, this.state.stateVersion, events, ['ShipOrder', 'SendTransactionMessage', 'CancelOrder']);
  }

  public shipOrder(transactionId: string, options?: AgentActionOptions): ActionResult<{ transactionId: string; status: TransactionStatus }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ transactionId: string; status: TransactionStatus }>;
    const actor = this.actorFor(options);
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'admin' && actor.role !== 'platform' && actor.id !== transaction.sellerId) return resultError('FORBIDDEN', this.state.stateVersion, '発送できるのは出品者または運営だけです');
    if (!['PAID', 'AWAITING_SHIPMENT'].includes(transaction.status)) return resultError('INVALID_TRANSITION', this.state.stateVersion, '支払い済み・発送待ちの取引だけ発送できます');
    const shipment = this.state.shipments.find((candidate) => candidate.id === transaction.shipmentId);
    if (!shipment) return resultError('STATE_CONFLICT', this.state.stateVersion);
    if (this.state.pendingFailures.includes('delivery')) {
      this.state.pendingFailures = this.state.pendingFailures.filter((failure) => failure !== 'delivery');
      shipment.status = 'EXCEPTION';
      shipment.updatedAt = this.state.now;
      const events = this.commit([{ type: 'SHIPMENT_EXCEPTION', aggregateType: 'shipment', aggregateId: shipment.id, actorId: actor.id, payload: { transactionId, reason: 'injected_failure' } }]);
      return resultError('INVALID_TRANSITION', this.state.stateVersion, '配送エミュレータが例外状態になりました', { events, retryable: true });
    }
    shipment.status = 'IN_TRANSIT';
    shipment.trackingNumber = `SBX-${this.nextId('tracking').slice(-8).toUpperCase()}`;
    shipment.updatedAt = this.state.now;
    transaction.status = 'SHIPPED';
    transaction.shippedAt = this.state.now;
    transaction.updatedAt = this.state.now;
    const events = this.commit([{ type: 'SHIPMENT_DISPATCHED', aggregateType: 'shipment', aggregateId: shipment.id, actorId: actor.id, payload: { transactionId, trackingNumber: shipment.trackingNumber } }, { type: 'TRANSACTION_SHIPPED', aggregateType: 'transaction', aggregateId: transaction.id, actorId: actor.id, payload: {} }]);
    this.addNotification(transaction.buyerId, '商品が発送されました', `${transaction.titleSnapshot}の発送通知が届きました。`, events[0]?.id);
    return resultOk({ transactionId, status: transaction.status }, this.state.stateVersion, events, ['MarkDelivered', 'SendTransactionMessage']);
  }

  public markDelivered(transactionId: string, options?: AgentActionOptions): ActionResult<{ transactionId: string; status: TransactionStatus }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ transactionId: string; status: TransactionStatus }>;
    const actor = this.actorFor(options);
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'admin' && actor.role !== 'platform' && actor.id !== transaction.buyerId) return resultError('FORBIDDEN', this.state.stateVersion, '配達完了を記録できるのは購入者または運営です');
    if (transaction.status !== 'SHIPPED') return resultError('INVALID_TRANSITION', this.state.stateVersion, '発送済みの取引だけ配達完了にできます');
    const shipment = this.state.shipments.find((candidate) => candidate.id === transaction.shipmentId);
    if (!shipment) return resultError('STATE_CONFLICT', this.state.stateVersion);
    shipment.status = 'DELIVERED';
    shipment.updatedAt = this.state.now;
    transaction.status = 'DELIVERED';
    transaction.deliveredAt = this.state.now;
    transaction.updatedAt = this.state.now;
    const events = this.commit([{ type: 'SHIPMENT_DELIVERED', aggregateType: 'shipment', aggregateId: shipment.id, actorId: actor.id, payload: { transactionId } }, { type: 'TRANSACTION_DELIVERED', aggregateType: 'transaction', aggregateId: transaction.id, actorId: actor.id, payload: {} }]);
    this.addNotification(transaction.buyerId, '受取確認が可能です', `${transaction.titleSnapshot}が配達済みです。受取評価をお願いします。`, events[0]?.id);
    return resultOk({ transactionId, status: transaction.status }, this.state.stateVersion, events, ['ReviewOrder']);
  }

  public reviewOrder(transactionId: string, rating: 1 | 2 | 3 | 4 | 5, comment = '', options?: AgentActionOptions): ActionResult<{ transactionId: string; status: TransactionStatus }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ transactionId: string; status: TransactionStatus }>;
    const actor = this.actorFor(options);
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (!isInteger(rating) || rating < 1 || rating > 5) return resultError('INVALID_AMOUNT', this.state.stateVersion, '評価は1〜5の整数で指定してください');
    if (typeof comment !== 'string') return resultError('INVALID_INPUT', this.state.stateVersion, 'レビュー本文の形式が不正です');
    const normalizedComment = comment.trim();
    if (normalizedComment.length > 500) return resultError('INVALID_INPUT', this.state.stateVersion, 'レビューは500文字以内で入力してください');
    if (unsafeContactText(normalizedComment)) return resultError('POLICY_BLOCKED', this.state.stateVersion, 'レビューに外部URLや連絡先を含めることはできません');
    const isBuyer = actor.id === transaction.buyerId;
    const isSeller = actor.id === transaction.sellerId;
    if (!isBuyer && !isSeller) return resultError('FORBIDDEN', this.state.stateVersion);
    if (isBuyer && !['DELIVERED'].includes(transaction.status)) return resultError('INVALID_TRANSITION', this.state.stateVersion, '購入者は配達完了後に受取評価できます');
    if (isSeller && transaction.status !== 'BUYER_REVIEWED') return resultError('INVALID_TRANSITION', this.state.stateVersion, '出品者評価は購入者の受取評価後にできます');
    if (isBuyer && transaction.buyerReviewedAt) return resultError('INVALID_TRANSITION', this.state.stateVersion, '購入者評価はすでに登録されています');
    if (isSeller && transaction.sellerReviewedAt) return resultError('INVALID_TRANSITION', this.state.stateVersion, '出品者評価はすでに登録されています');
    const review: ReviewRecord = { id: this.nextId('review'), transactionId, reviewerId: actor.id, revieweeId: isBuyer ? transaction.sellerId : transaction.buyerId, rating: rating as 1 | 2 | 3 | 4 | 5, comment: normalizedComment || undefined, createdAt: this.state.now };
    this.state.reviews.push(review);
    if (isBuyer) {
      transaction.buyerReviewedAt = this.state.now;
      transaction.status = 'BUYER_REVIEWED';
    } else {
      transaction.sellerReviewedAt = this.state.now;
      transaction.status = 'SELLER_REVIEWED';
    }
    if (transaction.buyerReviewedAt && transaction.sellerReviewedAt) {
      transaction.status = 'COMPLETED';
      transaction.completedAt = this.state.now;
      this.addLedger(transaction.buyerId, 'CAPTURE', transaction.total, transaction.id);
      const sellerFee = Math.floor(transaction.priceSnapshot * 0.1);
      this.addLedger(transaction.sellerId, 'SALE', transaction.priceSnapshot, transaction.id);
      if (sellerFee > 0) this.addLedger(transaction.sellerId, 'FEE', sellerFee, transaction.id);
    }
    transaction.updatedAt = this.state.now;
    const reviewSpecs: EventSpec[] = [{ type: isBuyer ? 'BUYER_REVIEWED' : 'SELLER_REVIEWED', aggregateType: 'transaction', aggregateId: transaction.id, actorId: actor.id, payload: { rating } }];
    if (transaction.status === 'COMPLETED') reviewSpecs.push({ type: 'TRANSACTION_COMPLETED', aggregateType: 'transaction', aggregateId: transaction.id, actorId: actor.id, payload: { sellerId: transaction.sellerId } });
    const events = this.commit(reviewSpecs);
    this.addNotification(isBuyer ? transaction.sellerId : transaction.buyerId, '取引評価が届きました', `${transaction.titleSnapshot}の評価が登録されました。`, events[0]?.id);
    return resultOk({ transactionId, status: transaction.status }, this.state.stateVersion, events, transaction.status === 'COMPLETED' ? ['ViewSalesBalance'] : ['ReviewOrder']);
  }

  public cancelOrder(transactionId: string, reason: string, options?: AgentActionOptions): ActionResult<{ transactionId: string; status: TransactionStatus }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ transactionId: string; status: TransactionStatus }>;
    const actor = this.actorFor(options);
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (![transaction.buyerId, transaction.sellerId].includes(actor.id) && actor.role !== 'admin' && actor.role !== 'platform') return resultError('FORBIDDEN', this.state.stateVersion);
    if (['COMPLETED', 'CANCELED', 'REFUNDED'].includes(transaction.status)) return resultError('INVALID_TRANSITION', this.state.stateVersion, '完了済みの取引はキャンセルできません');
    if (transaction.status === 'CANCEL_REQUESTED') return resultError('INVALID_TRANSITION', this.state.stateVersion, 'キャンセル申請中の取引は運営審査を待ってください');
    if (typeof reason !== 'string') return resultError('INVALID_INPUT', this.state.stateVersion, 'キャンセル理由の形式が不正です');
    const normalizedReason = reason.trim();
    if (!normalizedReason) return resultError('INVALID_INPUT', this.state.stateVersion, 'キャンセル理由を入力してください');
    const payment = this.state.payments.find((candidate) => candidate.id === transaction.paymentId);
    const item = this.item(transaction.itemId);
    const intent = this.state.purchaseIntents.find((candidate) => candidate.id === transaction.reservationId);
    const specs: EventSpec[] = [];
    if (intent?.status === 'ACTIVE') specs.push(...this.releaseIntent(intent, 'RELEASED', actor.id));
    if (['SHIPPED', 'DELIVERED'].includes(transaction.status)) {
      transaction.cancelPreviousStatus = transaction.status as Extract<TransactionStatus, 'SHIPPED' | 'DELIVERED'>;
      transaction.status = 'CANCEL_REQUESTED';
    } else if (payment?.status === 'CAPTURED') {
      payment.status = 'REFUNDED';
      payment.updatedAt = this.state.now;
      transaction.status = 'REFUNDED';
      this.releaseWalletHold(transaction.buyerId, transaction.total, transaction.id);
      const buyerWallet = this.wallet(transaction.buyerId);
      if (buyerWallet && transaction.pointsUsed) buyerWallet.points += transaction.pointsUsed;
    } else {
      transaction.status = transaction.status === 'SHIPPED' || transaction.status === 'DELIVERED' ? 'CANCEL_REQUESTED' : 'CANCELED';
    }
    transaction.cancelReason = normalizedReason;
    transaction.canceledAt = this.state.now;
    transaction.updatedAt = this.state.now;
    // A pending reservation never reduced on-hand inventory; only a captured
    // payment has to put one unit back after a refund.
    if (item && transaction.status === 'REFUNDED') {
      const restoredQuantity = (item.inventoryQuantity ?? 0) + 1;
      const nextReserved = this.activeReservationQuantity(item.id);
      this.updateItem(item.id, { inventoryQuantity: restoredQuantity, reservedQuantity: nextReserved, isSold: false, listingStatus: nextReserved > 0 ? 'RESERVED' : 'ACTIVE' });
      this.recordInventoryMovement(item, 'RELEASE', 1, 'キャンセルによる在庫復帰', transaction.id);
    }
    specs.unshift({ type: transaction.status === 'REFUNDED' ? 'PAYMENT_REFUNDED' : 'TRANSACTION_CANCELED', aggregateType: 'transaction', aggregateId: transaction.id, actorId: actor.id, payload: { reason: normalizedReason } });
    const events = this.commit(specs);
    this.addNotification(transaction.buyerId, '取引状態が更新されました', `${transaction.titleSnapshot}の取引が${transaction.status}になりました。`, events[0]?.id);
    this.addNotification(transaction.sellerId, '取引状態が更新されました', `${transaction.titleSnapshot}の取引が${transaction.status}になりました。`, events[0]?.id);
    return resultOk({ transactionId, status: transaction.status }, this.state.stateVersion, events, transaction.status === 'CANCEL_REQUESTED' ? ['SendTransactionMessage', 'OpenSupport'] : ['ViewInventory']);
  }

  public resolveCancellation(transactionId: string, approve: boolean, options?: AgentActionOptions): ActionResult<{ transactionId: string; status: TransactionStatus }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ transactionId: string; status: TransactionStatus }>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'admin' && actor.role !== 'platform') return resultError('FORBIDDEN', this.state.stateVersion, 'キャンセル審査はadmin/platformだけが実行できます');
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (transaction.status !== 'CANCEL_REQUESTED') return resultError('INVALID_TRANSITION', this.state.stateVersion, 'キャンセル申請中の取引だけ審査できます');
    const payment = this.state.payments.find((candidate) => candidate.id === transaction.paymentId);
    const shipment = this.state.shipments.find((candidate) => candidate.id === transaction.shipmentId);
    const item = this.item(transaction.itemId);
    const returnCase = this.state.returns.find((candidate) => candidate.transactionId === transactionId && candidate.status === 'REQUESTED');
    if (!payment || !shipment || !item) return resultError('STATE_CONFLICT', this.state.stateVersion);
    if (approve) {
      payment.status = 'REFUNDED';
      payment.updatedAt = this.state.now;
      this.releaseWalletHold(transaction.buyerId, transaction.total, transaction.id);
      const buyerWallet = this.wallet(transaction.buyerId);
      if (buyerWallet && transaction.pointsUsed) buyerWallet.points += transaction.pointsUsed;
      transaction.status = 'REFUNDED';
      shipment.status = 'RETURNING';
      const restoredQuantity = Math.min(item.inventoryInitialQuantity ?? 1, (item.inventoryQuantity ?? 0) + 1);
      const nextReserved = this.activeReservationQuantity(item.id);
      this.updateItem(item.id, { inventoryQuantity: restoredQuantity, reservedQuantity: nextReserved, isSold: false, listingStatus: nextReserved > 0 ? 'RESERVED' : 'ACTIVE', soldAt: undefined });
      this.recordInventoryMovement(item, 'RELEASE', 1, 'キャンセル承認による在庫復元', transaction.id);
      if (returnCase) { returnCase.status = 'IN_TRANSIT'; returnCase.decidedAt = this.state.now; returnCase.refundedAt = this.state.now; }
    } else {
      transaction.status = transaction.cancelPreviousStatus ?? 'SHIPPED';
      shipment.status = transaction.status === 'DELIVERED' ? 'DELIVERED' : 'IN_TRANSIT';
      if (returnCase) { returnCase.status = 'DECLINED'; returnCase.decidedAt = this.state.now; }
    }
    transaction.updatedAt = this.state.now;
    const events = this.commit([
      { type: approve ? 'CANCELLATION_APPROVED' : 'CANCELLATION_DECLINED', aggregateType: 'transaction', aggregateId: transaction.id, actorId: actor.id, payload: { transactionId, approve } },
      ...(approve ? [{ type: 'PAYMENT_REFUNDED', aggregateType: 'payment', aggregateId: payment.id, actorId: actor.id, payload: { transactionId, amount: transaction.total } } satisfies EventSpec] : []),
    ]);
    this.addNotification(transaction.buyerId, approve ? 'キャンセルが承認され返金されました' : 'キャンセル申請が却下されました', `${transaction.titleSnapshot}の取引状態が更新されました。`, events[0]?.id);
    this.addNotification(transaction.sellerId, approve ? 'キャンセルが承認されました' : 'キャンセル申請が却下されました', `${transaction.titleSnapshot}の取引状態が更新されました。`, events[0]?.id);
    return resultOk({ transactionId, status: transaction.status }, this.state.stateVersion, events, approve ? ['ViewInventory'] : ['ContinueTransaction']);
  }

  public requestReturn(transactionId: string, reason: string, options?: AgentActionOptions): ActionResult<{ returnCaseId: string; status: ReturnCase['status'] }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ returnCaseId: string; status: ReturnCase['status'] }>;
    const actor = this.actorFor(options);
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.id !== transaction.buyerId) return resultError('FORBIDDEN', this.state.stateVersion, '返品申請は購入者だけが実行できます');
    if (!['DELIVERED', 'COMPLETED'].includes(transaction.status)) return resultError('INVALID_TRANSITION', this.state.stateVersion, '配達済みの取引だけ返品申請できます');
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!normalizedReason || normalizedReason.length > 500 || unsafeContactText(normalizedReason)) return resultError('INVALID_INPUT', this.state.stateVersion, '返品理由は連絡先を含まない500文字以内で指定してください');
    if (this.state.returns.some((returnCase) => returnCase.transactionId === transactionId && !['DECLINED', 'REFUND_COMPLETED'].includes(returnCase.status))) return resultError('INVALID_TRANSITION', this.state.stateVersion, 'この取引には既に返品申請があります');
    const returnCase: ReturnCase = { id: this.nextId('return'), transactionId, requesterId: actor.id, reason: normalizedReason, status: 'REQUESTED', requestedAt: this.state.now };
    this.state.returns.push(returnCase);
    transaction.cancelPreviousStatus = 'DELIVERED';
    transaction.status = 'CANCEL_REQUESTED';
    transaction.cancelReason = normalizedReason;
    transaction.canceledAt = this.state.now;
    transaction.updatedAt = this.state.now;
    const events = this.commit([{ type: 'RETURN_REQUESTED', aggregateType: 'transaction', aggregateId: transactionId, actorId: actor.id, payload: { returnCaseId: returnCase.id, reason: normalizedReason } }]);
    this.addNotification(transaction.sellerId, '返品申請が届きました', `${transaction.titleSnapshot}の返品申請を運営が確認します。`, events[0]?.id);
    this.addNotification('admin_01', '返品申請を審査してください', `${transaction.titleSnapshot}の返品申請が作成されました。`, events[0]?.id);
    return resultOk({ returnCaseId: returnCase.id, status: returnCase.status }, this.state.stateVersion, events, ['ResolveReturn', 'SendTransactionMessage']);
  }

  public confirmReturnReceived(transactionId: string, options?: AgentActionOptions): ActionResult<{ returnCaseId: string; status: ReturnCase['status'] }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ returnCaseId: string; status: ReturnCase['status'] }>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated || (actor.role !== 'admin' && actor.role !== 'platform' && actor.role !== 'seller')) return resultError('FORBIDDEN', this.state.stateVersion, '返送受領はseller/admin/platformだけが実行できます');
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    const returnCase = this.state.returns.find((candidate) => candidate.transactionId === transactionId && candidate.status === 'IN_TRANSIT');
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (!returnCase) return resultError('INVALID_TRANSITION', this.state.stateVersion, '返送中の返品ケースがありません');
    if (actor.role === 'seller' && actor.id !== transaction.sellerId) return resultError('FORBIDDEN', this.state.stateVersion);
    returnCase.status = 'REFUND_COMPLETED';
    returnCase.receivedAt = this.state.now;
    returnCase.refundedAt ??= this.state.now;
    const shipment = this.state.shipments.find((candidate) => candidate.id === transaction.shipmentId);
    if (shipment) { shipment.status = 'RETURNING'; shipment.updatedAt = this.state.now; }
    transaction.updatedAt = this.state.now;
    const events = this.commit([{ type: 'RETURN_RECEIVED', aggregateType: 'transaction', aggregateId: transactionId, actorId: actor.id, payload: { returnCaseId: returnCase.id, refundCompleted: true } }]);
    this.addNotification(transaction.buyerId, '返送を受領し返金を完了しました', `${transaction.titleSnapshot}の返品処理が完了しました。`, events[0]?.id);
    return resultOk({ returnCaseId: returnCase.id, status: returnCase.status }, this.state.stateVersion, events, ['ViewTransaction']);
  }

  public sendTransactionMessage(transactionId: string, body: string, options?: AgentActionOptions): ActionResult<TransactionMessage> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<TransactionMessage>;
    const actor = this.actorFor(options);
    const transaction = this.state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction) return resultError('TRANSACTION_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated || (![transaction.buyerId, transaction.sellerId].includes(actor.id) && actor.role !== 'admin' && actor.role !== 'platform')) return resultError('FORBIDDEN', this.state.stateVersion);
    const normalizedBody = typeof body === 'string' ? body.trim() : '';
    if (!normalizedBody || normalizedBody.length > 1000 || unsafeContactText(normalizedBody)) return resultError('POLICY_BLOCKED', this.state.stateVersion, '取引メッセージは連絡先を含まない1,000文字以内で指定してください');
    const message: TransactionMessage = { id: this.nextId('message'), transactionId, senderId: actor.id, body: normalizedBody, createdAt: this.state.now, readBy: [actor.id] };
    this.state.messages.push(message);
    const recipientId = actor.id === transaction.buyerId ? transaction.sellerId : transaction.buyerId;
    const events = this.commit([{ type: 'TRANSACTION_MESSAGE_SENT', aggregateType: 'transaction', aggregateId: transactionId, actorId: actor.id, payload: { messageId: message.id } }]);
    this.addNotification(recipientId, '取引メッセージが届きました', `${transaction.titleSnapshot}について新しいメッセージがあります。`, events[0]?.id);
    return resultOk(clone(message), this.state.stateVersion, events, ['ReadTransactionMessages']);
  }

  public createSupportTicket(input: Partial<SupportTicket>, options?: AgentActionOptions): ActionResult<SupportTicket> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<SupportTicket>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    const category = input?.category;
    const subject = typeof input?.subject === 'string' ? input.subject.trim() : '';
    const body = typeof input?.body === 'string' ? input.body.trim() : '';
    const evidence = Array.isArray(input?.evidence) ? input.evidence.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 2_000_000).slice(0, 5) : [];
    if (!['TRANSACTION', 'LISTING', 'PAYMENT', 'DELIVERY', 'SAFETY'].includes(String(category)) || !subject || subject.length > 100 || !body || body.length > 2000 || unsafeContactText(`${subject} ${body}`)) return resultError('INVALID_INPUT', this.state.stateVersion, 'サポートチケットの入力が不正です');
    const transaction = input.transactionId ? this.state.transactions.find((candidate) => candidate.id === input.transactionId) : undefined;
    if (input.transactionId && (!transaction || (actor.role !== 'admin' && actor.role !== 'platform' && ![transaction.buyerId, transaction.sellerId].includes(actor.id)))) return resultError('FORBIDDEN', this.state.stateVersion);
    const ticket: SupportTicket = { id: this.nextId('ticket'), transactionId: transaction?.id, reporterId: actor.id, category: category as SupportTicket['category'], subject, body, evidence, status: 'OPEN', createdAt: this.state.now, updatedAt: this.state.now };
    this.state.supportTickets.push(ticket);
    const events = this.commit([{ type: 'SUPPORT_TICKET_CREATED', aggregateType: 'system', aggregateId: ticket.id, actorId: actor.id, payload: { category: ticket.category, transactionId: ticket.transactionId } }]);
    this.addNotification('admin_01', 'サポートチケットが作成されました', ticket.subject, events[0]?.id);
    return resultOk(clone(ticket), this.state.stateVersion, events, ['OpenSupportTicket']);
  }

  public reportTransaction(transactionId: string, body: string, options?: AgentActionOptions): ActionResult<SupportTicket> {
    return this.createSupportTicket({ transactionId, category: 'SAFETY', subject: '取引を通報', body, evidence: [] }, options);
  }

  public placeBid(itemId: string, amount: number, options?: AgentActionOptions): ActionResult<{ currentBid: number; bidsCount: number }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ currentBid: number; bidsCount: number }>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'buyer') return resultError('FORBIDDEN', this.state.stateVersion, '入札できるのはbuyer actorだけです');
    const item = this.item(itemId);
    if (!item) return resultError('ITEM_NOT_FOUND', this.state.stateVersion);
    if (!item.isAuction) return resultError('NOT_AUCTION', this.state.stateVersion, 'この商品はオークション商品ではありません');
    if (item.auctionEndsAt && Date.parse(item.auctionEndsAt) <= Date.parse(this.state.now)) return resultError('AUCTION_ENDED', this.state.stateVersion, 'オークションは終了しています');
    if (item.isSold || (item.inventoryQuantity ?? 0) <= 0) return resultError('ALREADY_SOLD', this.state.stateVersion, 'この商品は入札できる在庫がありません');
    const minimumBid = (item.currentBid ?? item.price) + 100;
    if (!isInteger(amount) || amount <= 0) return resultError('INVALID_AMOUNT', this.state.stateVersion, '入札額は正の整数で入力してください');
    if (amount < minimumBid) return resultError('BID_TOO_LOW', this.state.stateVersion, `入札額は¥${minimumBid.toLocaleString()}以上で入力してください`);
    const wallet = this.wallet(actor.id);
    const holdReference = this.auctionHoldReference(itemId, actor.id);
    const existingHold = this.heldAmountForReference(actor.id, holdReference);
    const requiredHold = amount + shippingCostFor(item);
    if (!wallet || requiredHold > wallet.availableBalance + existingHold) {
      return resultError('PAYMENT_FAILED', this.state.stateVersion, '入札額と送料の合計がSandboxウォレットの利用可能残高を超えています', { required: requiredHold, available: (wallet?.availableBalance ?? 0) + existingHold, retryable: false });
    }
    const previousHighest = [...this.state.bids].filter((bid) => bid.itemId === itemId).sort((a, b) => b.amount - a.amount)[0];
    if (existingHold > 0) this.releaseWalletHold(actor.id, existingHold, holdReference);
    if (previousHighest && previousHighest.bidderId !== actor.id) {
      this.releaseWalletHold(previousHighest.bidderId, previousHighest.amount + shippingCostFor(item), this.auctionHoldReference(itemId, previousHighest.bidderId));
    }
    const bid: AuctionBidRecord = { id: this.nextId('bid'), itemId, bidderId: actor.id, amount, createdAt: this.state.now };
    this.state.bids.push(bid);
    this.addLedger(actor.id, 'HOLD', requiredHold, holdReference);
    const nextBidsCount = (item.bidsCount ?? 0) + 1;
    this.updateItem(itemId, { currentBid: amount, bidsCount: nextBidsCount });
    const events = this.commit([{ type: 'BID_PLACED', aggregateType: 'auction', aggregateId: itemId, actorId: actor.id, payload: { amount, bidsCount: nextBidsCount } }]);
    if (previousHighest && previousHighest.bidderId !== actor.id) this.addNotification(previousHighest.bidderId, '入札を上回られました', `${item.title}の入札額が更新されました。`, events[0]?.id);
    return resultOk({ currentBid: amount, bidsCount: nextBidsCount }, this.state.stateVersion, events, ['PlaceHigherBid', 'WaitForAuctionEnd']);
  }

  private settleExpiredAuction(itemId: string): DomainEvent[] {
    const item = this.item(itemId);
    if (!item || !item.isAuction || !item.auctionEndsAt || Date.parse(item.auctionEndsAt) > Date.parse(this.state.now)) return [];
    if (this.state.transactions.some((transaction) => transaction.itemId === itemId)) return [];
    const highestBid = [...this.state.bids]
      .filter((bid) => bid.itemId === itemId)
      .sort((left, right) => right.amount - left.amount || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
    if (!highestBid) {
      this.updateItem(itemId, { listingStatus: 'ARCHIVED' });
      const events = this.commit([{ type: 'AUCTION_CLOSED_NO_BIDS', aggregateType: 'auction', aggregateId: itemId, actorId: 'platform', payload: { itemId } }]);
      return events;
    }
    const winner = this.currentActor(highestBid.bidderId);
    const total = highestBid.amount + shippingCostFor(item);
    const wallet = winner ? this.wallet(winner.id) : undefined;
    const holdReference = this.auctionHoldReference(itemId, highestBid.bidderId);
    const heldForWinner = winner && wallet ? this.heldAmountForReference(winner.id, holdReference) : 0;
    const missingHold = Math.max(0, total - heldForWinner);
    if (!winner || !wallet || wallet.availableBalance < missingHold || this.state.pendingFailures.includes('payment')) {
      if (winner && heldForWinner > 0) this.releaseWalletHold(winner.id, heldForWinner, holdReference);
      if (this.state.pendingFailures.includes('payment')) this.state.pendingFailures = this.state.pendingFailures.filter((failure) => failure !== 'payment');
      this.updateItem(itemId, { listingStatus: 'ARCHIVED' });
      const events = this.commit([{ type: 'AUCTION_PAYMENT_FAILED', aggregateType: 'auction', aggregateId: itemId, actorId: 'platform', payload: { itemId, bidderId: highestBid.bidderId, required: total, available: wallet?.availableBalance ?? 0 } }]);
      this.addNotification(highestBid.bidderId, 'オークションの決済に失敗しました', `${item.title}は残高不足または決済エラーのため落札を確定できませんでした。`, events[0]?.id);
      return events;
    }
    const createdAt = this.state.now;
    const intentId = this.nextId('auction-intent');
    const transactionId = this.nextId('txn');
    const paymentId = this.nextId('payment');
    const shipmentId = this.nextId('shipment');
    const intent: PurchaseIntent = {
      id: intentId,
      transactionId,
      itemId,
      buyerId: winner.id,
      quantity: 1,
      quote: total,
      createdAt,
      expiresAt: addMilliseconds(createdAt, PURCHASE_INTENT_TTL_MS),
      expectedStateVersion: this.state.stateVersion + 1,
      status: 'COMMITTED',
    };
    const transaction: TransactionRecord = {
      id: transactionId,
      orderId: this.nextId('order').toUpperCase(),
      itemId,
      buyerId: winner.id,
      sellerId: sellerIdForItem(item),
      titleSnapshot: item.title,
      priceSnapshot: highestBid.amount,
      shippingCost: shippingCostFor(item),
      total,
      status: 'AWAITING_SHIPMENT',
      paymentId,
      shipmentId,
      reservationId: intentId,
      createdAt,
      updatedAt: createdAt,
      paidAt: createdAt,
    };
    const payment: PaymentRecord = { id: paymentId, transactionId, method: 'sandbox-wallet', amount: total, status: 'CAPTURED', createdAt, updatedAt: createdAt };
    const shipment: ShipmentRecord = { id: shipmentId, transactionId, method: item.shippingMethod, status: 'PENDING', createdAt, updatedAt: createdAt };
    this.state.purchaseIntents.push(intent);
    this.state.transactions.push(transaction);
    this.state.payments.push(payment);
    this.state.shipments.push(shipment);
    if (heldForWinner > 0) this.releaseWalletHold(winner.id, heldForWinner, holdReference);
    this.addLedger(winner.id, 'HOLD', total, transactionId);
    this.updateItem(itemId, { inventoryQuantity: Math.max(0, (item.inventoryQuantity ?? 0) - 1), reservedQuantity: 0, isSold: true, listingStatus: 'SOLD', soldAt: this.state.now });
    this.recordInventoryMovement(item, 'OUT', 1, 'オークション落札確定', transactionId);
    const events = this.commit([
      { type: 'AUCTION_CLOSED', aggregateType: 'auction', aggregateId: itemId, actorId: 'platform', payload: { itemId, bidderId: winner.id, amount: highestBid.amount } },
      { type: 'PAYMENT_CAPTURED', aggregateType: 'payment', aggregateId: paymentId, actorId: 'platform', payload: { transactionId, amount: total } },
      { type: 'INVENTORY_COMMITTED', aggregateType: 'inventory', aggregateId: itemId, actorId: 'platform', payload: { quantity: 1, transactionId } },
    ]);
    this.addNotification(winner.id, 'オークションに落札しました', `${item.title}の落札が確定しました。出品者の発送をお待ちください。`, events[0]?.id);
    this.addNotification(transaction.sellerId, 'オークション商品が落札されました', `${item.title}の落札価格は${highestBid.amount.toLocaleString()}円です。発送してください。`, events[0]?.id);
    return events;
  }

  public closeAuction(itemId: string, options?: AgentActionOptions): ActionResult<CloseAuctionResult> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<CloseAuctionResult>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'admin' && actor.role !== 'platform') return resultError('FORBIDDEN', this.state.stateVersion, 'オークションの終了処理はadmin/platformだけが実行できます');
    const item = this.item(itemId);
    if (!item) return resultError('ITEM_NOT_FOUND', this.state.stateVersion);
    if (!item.isAuction) return resultError('NOT_AUCTION', this.state.stateVersion);
    if (!item.auctionEndsAt || Date.parse(item.auctionEndsAt) > Date.parse(this.state.now)) return resultError('INVALID_TRANSITION', this.state.stateVersion, 'オークション終了時刻前です');
    const events = this.settleExpiredAuction(itemId);
    if (!events.length) return resultError('INVALID_TRANSITION', this.state.stateVersion, 'オークションはすでに終了処理済みです');
    const transaction = this.state.transactions.find((candidate) => candidate.itemId === itemId);
    const status = transaction ? 'SETTLED' : events.some((event) => event.type === 'AUCTION_PAYMENT_FAILED') ? 'PAYMENT_FAILED' : 'NO_BIDS';
    return resultOk({ itemId, transactionId: transaction?.id, status }, this.state.stateVersion, events, transaction ? ['ShipOrder'] : ['ViewAuctionResult']);
  }

  public evaluateListingPolicy(input: Partial<MercariItem>): PolicyDecision {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {
        allowed: false,
        status: 'REJECTED',
        ruleVersion: POLICY_RULE_VERSION,
        signals: [{ code: 'INVALID_INPUT', label: '入力形式', status: 'blocked', detail: '出品データはオブジェクトで指定してください' }],
        decidedAt: this.state.now,
      };
    }
    const title = input.title?.trim() ?? '';
    const description = input.description?.trim() ?? '';
    const text = normalize(`${title} ${description} ${(input.category ?? []).join(' ')} ${input.brand ?? ''}`);
    const signals: PolicySignal[] = [];
    const condition = canonicalListingCondition(input.condition);
    const required: Array<[string, boolean, string]> = [
      ['TITLE_REQUIRED', title.length > 0 && title.length <= 40, '商品名は1〜40文字で入力してください'],
      ['DESCRIPTION_REQUIRED', description.length > 0 && description.length <= 1000, '商品説明は1〜1,000文字で入力してください'],
      ['PRICE_VALID', isInteger(input.price) && (input.price ?? 0) >= 300 && (input.price ?? 0) <= MAX_LISTING_PRICE, '価格は300〜9,999,999円の整数で入力してください'],
      ['CATEGORY_REQUIRED', Boolean(input.category?.length), 'カテゴリを指定してください'],
      ['CONDITION_REQUIRED', LISTING_CONDITIONS.has(condition), '公式の6段階から商品の状態を指定してください'],
      ['SHIPPING_REQUIRED', Boolean(input.shippingMethod?.trim()), '配送方法を指定してください'],
    ];
    required.forEach(([code, valid, detail]) => signals.push({ code, label: code, status: valid ? 'pass' : 'blocked', detail: valid ? '入力されています' : detail }));
    const prohibited = ['拳銃', '銃', '武器', '覚醒剤', '大麻', '麻薬', '盗品', '危険物', '爆薬', '偽ブランド', '個人情報', '口座番号', 'マイナンバー'];
    const matched = prohibited.filter((word) => text.includes(normalize(word)));
    signals.push({ code: 'PROHIBITED_GOODS', label: '禁止品・危険語', status: matched.length ? 'blocked' : 'pass', detail: matched.length ? `禁止語を検出: ${matched.join('、')}` : '禁止語は検出されませんでした' });
    const hasExternalLink = /https?:\/\//u.test(`${title} ${description}`) || /www\./u.test(text);
    signals.push({ code: 'EXTERNAL_REDIRECT', label: '外部誘導', status: hasExternalLink ? 'blocked' : 'pass', detail: hasExternalLink ? '外部URLを含む出品は受け付けません' : '外部URLは検出されませんでした' });
    const hasPii = /(?:\d{3}-\d{4}|\d{2,4}-\d{2,4}-\d{3,4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/u.test(`${title} ${description}`);
    signals.push({ code: 'PII_DETECTION', label: '個人情報', status: hasPii ? 'blocked' : 'pass', detail: hasPii ? '電話番号・メールアドレスらしき情報を検出しました' : '個人情報らしき文字列は検出されませんでした' });
    const duplicateSku = input.sku ? this.state.items.some((item) => item.sku && item.sku === input.sku && item.id !== input.id) : false;
    signals.push({ code: 'DUPLICATE_SKU', label: 'SKU重複', status: duplicateSku ? 'blocked' : 'pass', detail: duplicateSku ? '既存出品とSKUが重複しています' : 'SKU重複は検出されませんでした' });
    const missingImage = !input.images?.length && !input.imageRefs?.length;
    signals.push({ code: 'IMAGE_EVIDENCE', label: '画像証跡', status: missingImage ? 'warning' : 'pass', detail: missingImage ? '画像がないため購入者向けの確認情報が不足しています' : '画像が登録されています' });
    const images = Array.isArray(input.images) ? input.images : [];
    const imageSizeError = imagePayloadError(input.images) ?? imageReferenceError(input.imageRefs);
    signals.push({ code: 'IMAGE_INPUT_SIZE', label: '画像入力サイズ', status: imageSizeError ? 'blocked' : 'pass', detail: imageSizeError ?? '画像入力サイズは許容範囲です' });
    const hasExternalImage = images.some((image) => typeof image === 'string' && /^https?:\/\//u.test(image));
    signals.push({ code: 'EXTERNAL_IMAGE_SOURCE', label: '外部画像ソース', status: hasExternalImage ? 'blocked' : 'pass', detail: hasExternalImage ? '外部URL画像はSandbox出品に使用できません' : '外部URL画像は検出されませんでした' });
    const blocked = signals.some((signal) => signal.status === 'blocked');
    const hasWarning = signals.some((signal) => signal.status === 'warning');
    return {
      allowed: !blocked,
      status: blocked ? 'REJECTED' : hasWarning ? 'HELD' : 'APPROVED',
      ruleVersion: POLICY_RULE_VERSION,
      signals,
      decidedAt: this.state.now,
    };
  }

  private buildItem(input: Partial<MercariItem>, actor: SandboxActor): MercariItem {
    const id = this.nextId('item');
    const title = input.title?.trim() ?? '';
    const quantity = input.inventoryPolicy === 'MULTI' && isInteger(input.inventoryQuantity) && (input.inventoryQuantity ?? 0) > 0 ? input.inventoryQuantity ?? 1 : 1;
    const sellerId = actor.role === 'seller' ? actor.id : 'seller_01';
    return {
      id,
      sku: input.sku ?? `FBS-${this.state.idCounter.toString(36).toUpperCase()}`,
      title,
      price: input.price ?? 0,
      images: input.images?.length ? [...input.images] : ['/images/products/knit.jpg'],
      imageRefs: input.imageRefs?.length ? [...input.imageRefs] : undefined,
      isSold: false,
      inventoryPolicy: input.inventoryPolicy ?? 'SINGLE',
      inventoryInitialQuantity: quantity,
      inventoryQuantity: quantity,
      reservedQuantity: 0,
      listingStatus: 'ACTIVE',
      moderationStatus: 'PENDING',
      isDemo: input.isDemo ?? true,
      isAuction: input.isAuction,
      currentBid: input.currentBid,
      bidsCount: input.bidsCount,
      timeLeft: input.timeLeft,
      auctionEndsAt: input.auctionEndsAt,
      description: input.description?.trim() ?? '',
      category: input.category?.length ? [...input.category] : [],
      condition: canonicalListingCondition(input.condition),
      shippingFee: input.shippingFee ?? '送料込み（出品者負担）',
      shippingMethod: input.shippingMethod ?? '',
      origin: input.origin ?? '東京都',
      shippingDays: input.shippingDays ?? '1〜2日で発送',
      likesCount: 0,
      isLiked: false,
      brand: input.brand,
      size: input.size,
      color: input.color,
      shippingSize: input.shippingSize,
      isAnonymousShipping: input.isAnonymousShipping ?? true,
      isAuthenticityEligible: input.isAuthenticityEligible,
      sellerType: input.sellerType ?? 'individual',
      sellerId,
      createdAt: this.state.now,
      updatedAt: this.state.now,
      qualityTier: 'gold',
      isCouponEligible: input.isCouponEligible,
      discountRate: input.discountRate,
      isTimeSale: input.isTimeSale,
      isGuaranteeEligible: input.isGuaranteeEligible,
      productFamilyId: input.productFamilyId,
      productFamilyName: input.productFamilyName,
      variantId: input.variantId,
      variantName: input.variantName,
      productType: input.productType,
      searchTags: input.searchTags ? [...input.searchTags] : undefined,
      attributes: input.attributes ? { ...input.attributes } : undefined,
      sourceUrl: input.sourceUrl,
      sourcePhotographer: input.sourcePhotographer,
      sourceAttribution: input.sourceAttribution,
      sourceChecksum: input.sourceChecksum,
      seller: { name: this.state.profiles.find((profile) => profile.actorId === sellerId)?.displayName ?? (actor.role === 'seller' ? actor.name : 'Sandbox Seller'), avatar: '/favicon.svg', avatarRef: this.state.profiles.find((profile) => profile.actorId === sellerId)?.avatarRef, rating: 5, ratingsCount: 0, isVerified: true },
      comments: [],
    };
  }

  public listItem(input: Partial<MercariItem>, options?: AgentActionOptions): ActionResult<MercariItem> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<MercariItem>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return resultError('INVALID_INPUT', this.state.stateVersion, '出品データの形式が不正です');
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion, '出品にはログイン済みactorが必要です');
    if (actor.role !== 'seller') return resultError('FORBIDDEN', this.state.stateVersion, '出品できるのはseller actorだけです。buyerの購入権限とsellerの出品権限は分離されています');
    const decision = this.evaluateListingPolicy(input);
    if (!decision.allowed) return resultError('POLICY_BLOCKED', this.state.stateVersion, '出品ポリシーによりブロックされました', decision);
    const item = this.buildItem(input, actor);
    item.moderationStatus = decision.status === 'HELD' ? 'HELD' : 'APPROVED';
    if (decision.status === 'HELD') item.listingStatus = 'HELD';
    this.state.items = [item, ...this.state.items];
    this.recordInventoryMovement(item, 'IN', item.inventoryQuantity ?? 1, decision.status === 'HELD' ? '審査保留出品' : '新規出品');
    const events = this.commit([{ type: decision.status === 'HELD' ? 'LISTING_HELD' : 'LISTING_PUBLISHED', aggregateType: 'listing', aggregateId: item.id, actorId: actor.id, payload: { policy: decision } }]);
    return resultOk(clone(item), this.state.stateVersion, events, decision.status === 'HELD' ? ['ReviewListing'] : ['OpenListing', 'ShareListing']);
  }

  public createListingDraft(input: Partial<MercariItem>, options?: AgentActionOptions): ActionResult<CreateDraftResult> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<CreateDraftResult>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return resultError('INVALID_INPUT', this.state.stateVersion, '出品下書きの形式が不正です');
    const imageError = imagePayloadError(input.images) ?? imageReferenceError(input.imageRefs);
    if (imageError) return resultError('INVALID_INPUT', this.state.stateVersion, imageError);
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'seller') return resultError('FORBIDDEN', this.state.stateVersion, '出品下書きを作成できるのはseller actorだけです');
    const draftId = this.nextId('draft');
    this.state.drafts[draftId] = clone(input);
    this.state.draftOwners[draftId] = actor.id;
    const events = this.commit([{ type: 'LISTING_DRAFT_CREATED', aggregateType: 'listing', aggregateId: draftId, actorId: actor.id, payload: { fields: Object.keys(input) } }]);
    return resultOk({ draftId }, this.state.stateVersion, events, ['SubmitListing']);
  }

  public updateListingDraft(draftId: string, input: Partial<MercariItem>, options?: AgentActionOptions): ActionResult<CreateDraftResult> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<CreateDraftResult>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'seller') return resultError('FORBIDDEN', this.state.stateVersion, '出品下書きを編集できるのはseller actorだけです');
    if (typeof draftId !== 'string' || !draftId.trim() || !input || typeof input !== 'object' || Array.isArray(input)) return resultError('INVALID_INPUT', this.state.stateVersion, '出品下書きの形式が不正です');
    const imageError = imagePayloadError(input.images) ?? imageReferenceError(input.imageRefs);
    if (imageError) return resultError('INVALID_INPUT', this.state.stateVersion, imageError);
    if (!this.state.drafts[draftId]) return resultError('DRAFT_NOT_FOUND', this.state.stateVersion);
    if (this.state.draftOwners[draftId] !== actor.id) return resultError('FORBIDDEN', this.state.stateVersion, 'この出品下書きを編集できるactorではありません');
    this.state.drafts[draftId] = clone(input);
    const events = this.commit([{ type: 'LISTING_DRAFT_UPDATED', aggregateType: 'listing', aggregateId: draftId, actorId: actor.id, payload: { fields: Object.keys(input) } }]);
    return resultOk({ draftId }, this.state.stateVersion, events, ['SubmitListing']);
  }

  public getListingDrafts(actorId = this.state.currentActorId): Array<{ draftId: string; fields: Partial<MercariItem>; updatedAt: string }> {
    const actor = this.state.actors.find((candidate) => candidate.id === actorId);
    if (!actor?.authenticated) return [];
    return Object.entries(this.state.drafts)
      .filter(([draftId]) => actor.role === 'admin' || actor.role === 'platform' || this.state.draftOwners[draftId] === actor.id)
      .map(([draftId, fields]) => ({ draftId, fields: clone(fields), updatedAt: this.state.now }));
  }

  public deleteListingDraft(draftId: string, options?: AgentActionOptions): ActionResult<{ draftId: string }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ draftId: string }>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (typeof draftId !== 'string' || !draftId.trim()) return resultError('INVALID_INPUT', this.state.stateVersion, '出品下書きIDを指定してください');
    if (!this.state.drafts[draftId]) return resultError('DRAFT_NOT_FOUND', this.state.stateVersion);
    if (actor.role !== 'admin' && actor.role !== 'platform' && this.state.draftOwners[draftId] !== actor.id) return resultError('FORBIDDEN', this.state.stateVersion, 'この出品下書きを削除できるactorではありません');
    delete this.state.drafts[draftId];
    delete this.state.draftOwners[draftId];
    const events = this.commit([{ type: 'LISTING_DRAFT_DELETED', aggregateType: 'listing', aggregateId: draftId, actorId: actor.id, payload: { draftId } }]);
    return resultOk({ draftId }, this.state.stateVersion, events, ['CreateListingDraft']);
  }

  public submitListing(draftId: string, options?: AgentActionOptions): ActionResult<{ itemId: string }> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<{ itemId: string }>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    const draft = this.state.drafts[draftId];
    if (!draft) return resultError('DRAFT_NOT_FOUND', this.state.stateVersion);
    if (this.state.draftOwners[draftId] !== actor.id) return resultError('FORBIDDEN', this.state.stateVersion, 'この出品下書きを送信できるactorではありません');
    const result = this.listItem(draft, options);
    if (!result.ok) return resultError(result.error, result.stateVersion, result.message, result.details);
    delete this.state.drafts[draftId];
    delete this.state.draftOwners[draftId];
    return resultOk({ itemId: result.data.id }, result.stateVersion, result.events, result.nextActions);
  }

  public reviewListing(itemId: string, approve: boolean, options?: AgentActionOptions): ActionResult<MercariItem> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<MercariItem>;
    const actor = this.actorFor(options);
    if (!actor?.authenticated) return resultError('AUTH_REQUIRED', this.state.stateVersion);
    if (actor.role !== 'admin' && actor.role !== 'platform') return resultError('FORBIDDEN', this.state.stateVersion, '出品審査はadmin/platformだけが実行できます');
    if (typeof itemId !== 'string' || !itemId.trim() || typeof approve !== 'boolean') return resultError('INVALID_INPUT', this.state.stateVersion, '審査入力の形式が不正です');
    const item = this.item(itemId);
    if (!item) return resultError('ITEM_NOT_FOUND', this.state.stateVersion);
    if (item.listingStatus !== 'HELD') return resultError('INVALID_TRANSITION', this.state.stateVersion, '審査保留中の出品だけ審査できます');
    const nextStatus = approve ? 'ACTIVE' : 'ARCHIVED';
    const next = this.updateItem(itemId, { listingStatus: nextStatus, moderationStatus: approve ? 'APPROVED' : 'REJECTED' });
    if (!next) return resultError('STATE_CONFLICT', this.state.stateVersion);
    const events = this.commit([{ type: approve ? 'LISTING_APPROVED' : 'LISTING_REJECTED', aggregateType: 'moderation', aggregateId: itemId, actorId: actor.id, payload: { itemId, approve } }]);
    this.addNotification(item.sellerId ?? 'seller_01', approve ? '出品が承認されました' : '出品が却下されました', `${item.title}の審査結果が更新されました。`, events[0]?.id);
    return resultOk(clone(next), this.state.stateVersion, events, approve ? ['OpenListing'] : ['CreateListingDraft']);
  }

  public updateListing(itemId: string, input: Partial<MercariItem>, options?: AgentActionOptions): ActionResult<MercariItem> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<MercariItem>;
    const actor = this.actorFor(options);
    const item = this.item(itemId);
    if (!item) return resultError('ITEM_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated || (actor.role !== 'admin' && actor.role !== 'platform' && actor.id !== item.sellerId)) return resultError('FORBIDDEN', this.state.stateVersion, '出品を編集できるのは所有sellerまたは運営だけです');
    if (!['ACTIVE', 'HELD', 'ARCHIVED'].includes(String(item.listingStatus))) return resultError('INVALID_TRANSITION', this.state.stateVersion, '購入予約・売却済みの出品は編集できません');
    if (!input || typeof input !== 'object' || Array.isArray(input)) return resultError('INVALID_INPUT', this.state.stateVersion);
    const editableKeys = ['title', 'description', 'price', 'category', 'condition', 'shippingFee', 'shippingMethod', 'origin', 'shippingDays', 'shippingSize', 'images', 'imageRefs', 'brand', 'size', 'color', 'inventoryPolicy', 'inventoryInitialQuantity', 'inventoryQuantity', 'isAnonymousShipping'] as const;
    const editable = Object.fromEntries(editableKeys.filter((key) => key in input).map((key) => [key, input[key]])) as Partial<MercariItem>;
    const normalizedEditable = editable.condition === undefined ? editable : { ...editable, condition: canonicalListingCondition(editable.condition) };
    const decision = this.evaluateListingPolicy({ ...item, ...normalizedEditable });
    if (!decision.allowed) return resultError('POLICY_BLOCKED', this.state.stateVersion, '出品ポリシーによりブロックされました', decision);
    const next = this.updateItem(itemId, { ...normalizedEditable, listingStatus: decision.status === 'HELD' ? 'HELD' : 'ACTIVE', moderationStatus: decision.status === 'HELD' ? 'HELD' : 'APPROVED' });
    if (!next) return resultError('STATE_CONFLICT', this.state.stateVersion);
    const events = this.commit([{ type: 'LISTING_UPDATED', aggregateType: 'listing', aggregateId: itemId, actorId: actor.id, payload: { fields: Object.keys(editable), policy: decision } }]);
    return resultOk(clone(next), this.state.stateVersion, events, decision.status === 'HELD' ? ['ReviewListing'] : ['OpenListing']);
  }

  public pauseListing(itemId: string, options?: AgentActionOptions): ActionResult<MercariItem> {
    return this.changeListingVisibility(itemId, 'ARCHIVED', options);
  }

  public resumeListing(itemId: string, options?: AgentActionOptions): ActionResult<MercariItem> {
    return this.changeListingVisibility(itemId, 'ACTIVE', options);
  }

  private changeListingVisibility(itemId: string, nextStatus: 'ACTIVE' | 'ARCHIVED', options?: AgentActionOptions): ActionResult<MercariItem> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<MercariItem>;
    const actor = this.actorFor(options);
    const item = this.item(itemId);
    if (!item) return resultError('ITEM_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated || (actor.role !== 'admin' && actor.role !== 'platform' && actor.id !== item.sellerId)) return resultError('FORBIDDEN', this.state.stateVersion);
    if (nextStatus === 'ACTIVE' && ((item.inventoryQuantity ?? 0) - (item.reservedQuantity ?? 0) <= 0 || item.listingStatus === 'HELD')) return resultError('INVALID_TRANSITION', this.state.stateVersion, '在庫がない、または審査保留中の出品は再開できません');
    if (['SOLD', 'RESERVED'].includes(String(item.listingStatus)) && nextStatus === 'ARCHIVED') return resultError('INVALID_TRANSITION', this.state.stateVersion, '購入予約・売却済みの出品は停止できません');
    const next = this.updateItem(itemId, { listingStatus: nextStatus, isSold: nextStatus === 'ACTIVE' ? false : item.isSold });
    if (!next) return resultError('STATE_CONFLICT', this.state.stateVersion);
    const events = this.commit([{ type: nextStatus === 'ACTIVE' ? 'LISTING_RESUMED' : 'LISTING_PAUSED', aggregateType: 'listing', aggregateId: itemId, actorId: actor.id, payload: { itemId } }]);
    return resultOk(clone(next), this.state.stateVersion, events, nextStatus === 'ACTIVE' ? ['OpenListing'] : ['ViewListings']);
  }

  public relistItem(itemId: string, options?: AgentActionOptions): ActionResult<MercariItem> {
    const invalid = this.validateOptions(options);
    if (invalid) return invalid as ActionResult<MercariItem>;
    const actor = this.actorFor(options);
    const item = this.item(itemId);
    if (!item) return resultError('ITEM_NOT_FOUND', this.state.stateVersion);
    if (!actor?.authenticated || actor.role !== 'seller' || actor.id !== item.sellerId) return resultError('FORBIDDEN', this.state.stateVersion, '再出品は所有sellerだけが実行できます');
    if (!['SOLD', 'ARCHIVED'].includes(String(item.listingStatus))) return resultError('INVALID_TRANSITION', this.state.stateVersion, '売切れまたは停止済みの出品だけ再出品できます');
    const result = this.listItem({ ...clone(item), id: undefined, isSold: false, listingStatus: 'ACTIVE', inventoryQuantity: item.inventoryInitialQuantity ?? 1, reservedQuantity: 0, sku: `${item.sku ?? item.id}-relist-${this.state.idCounter}` }, { actorId: actor.id });
    return result;
  }

  public switchActor(actorId: string, options?: AgentActionOptions): ActionResult<SandboxActor> {
    const invalid = this.validateControlOptions(options);
    if (invalid) return invalid as ActionResult<SandboxActor>;
    const actor = this.currentActor(actorId);
    if (!actor) return resultError('INVALID_ACTOR', this.state.stateVersion, '指定されたactorは存在しません');
    this.state.currentActorId = actor.id;
    const events = this.commit([{ type: 'ACTOR_SWITCHED', aggregateType: 'system', aggregateId: actor.id, actorId: this.actorFor(options)?.id ?? 'platform', payload: { role: actor.role } }]);
    return resultOk(clone(actor), this.state.stateVersion, events);
  }

  public loadScenario(scenarioId: ScenarioId, options: AgentActionOptions & { seed?: string } = {}): ActionResult<{ scenarioId: ScenarioId; seed: string; now: string }> {
    const invalid = this.validateControlOptions(options);
    if (invalid) return invalid as ActionResult<{ scenarioId: ScenarioId; seed: string; now: string }>;
    if (!SCENARIOS.includes(scenarioId)) return resultError('UNKNOWN_SCENARIO', this.state.stateVersion, '未対応のシナリオです');
    const seed = options.seed ?? `${scenarioId}-seed-v1`;
    const previousStateVersion = this.state.stateVersion;
    const baseState = this.createState(this.initialItems, scenarioId, seed, BASE_NOW);
    // Scenario changes are commands, not a time-travel operation. Keep the
    // version monotonic so a stale preview or CAS writer cannot become valid
    // merely because an operator loaded another deterministic fixture.
    baseState.stateVersion = previousStateVersion + 1;
    this.state = baseState;
    const pickAvailable = () => this.state.items.find((item) => !item.isAuction && (item.inventoryQuantity ?? 0) > 0);
    if (scenarioId === 'already_sold') {
      const target = pickAvailable();
      if (target) this.updateItem(target.id, { inventoryQuantity: 0, reservedQuantity: 0, isSold: true, listingStatus: 'SOLD' });
    }
    if (scenarioId === 'multi_inventory') {
      const target = pickAvailable();
      if (target) this.updateItem(target.id, { inventoryPolicy: 'MULTI', inventoryInitialQuantity: 5, inventoryQuantity: 5, reservedQuantity: 0, isSold: false, listingStatus: 'ACTIVE' });
    }
    if (scenarioId === 'auction_outbid') {
      const target = this.state.items.find((item) => item.isAuction) ?? this.state.items[0];
      if (target) {
        const currentBid = target.currentBid ?? target.price;
        this.updateItem(target.id, { isAuction: true, currentBid, bidsCount: Math.max(1, target.bidsCount ?? 0), auctionEndsAt: addMilliseconds(BASE_NOW, 6 * 60 * 60 * 1000) });
        this.state.bids.push({ id: this.nextId('bid'), itemId: target.id, bidderId: 'buyer_01', amount: currentBid, createdAt: BASE_NOW });
      }
    }
    if (scenarioId === 'payment_timeout') this.state.pendingFailures = ['payment'];
    if (scenarioId === 'delivery_delay') this.state.pendingFailures = ['delivery'];
    if (scenarioId === 'listing_policy_blocked') this.state.currentActorId = 'seller_01';
    return resultOk({ scenarioId, seed: this.state.seed, now: this.state.now }, this.state.stateVersion);
  }

  public resetScenario(options?: AgentActionOptions & { scenarioId?: ScenarioId; seed?: string }): ActionResult<{ scenarioId: ScenarioId; seed: string; now: string }> {
    return this.loadScenario(options?.scenarioId ?? 'catalog_default', options ?? {});
  }

  public advanceClock(milliseconds: number, options?: AgentActionOptions): ActionResult<{ now: string; expiredPurchaseIntentIds: string[] }> {
    const invalid = this.validateControlOptions(options);
    if (invalid) return invalid as ActionResult<{ now: string; expiredPurchaseIntentIds: string[] }>;
    if (!isInteger(milliseconds) || milliseconds < 0 || milliseconds > 365 * 24 * 60 * 60 * 1000) return resultError('INVALID_INPUT', this.state.stateVersion, '時計は0〜365日分の整数ミリ秒で進めてください');
    this.state.now = addMilliseconds(this.state.now, milliseconds);
    const expiredPurchaseIntentIds: string[] = [];
    const controlActorId = this.actorFor(options)?.id ?? 'platform';
    const specs: EventSpec[] = [{ type: 'CLOCK_ADVANCED', aggregateType: 'system', aggregateId: 'sandbox-clock', actorId: controlActorId, payload: { milliseconds, now: this.state.now } }];
    const expired = this.releaseExpiredPurchaseIntents(controlActorId);
    expiredPurchaseIntentIds.push(...expired.ids);
    specs.push(...expired.specs);
    const auctionEvents = this.state.items
      .filter((item) => item.isAuction && item.auctionEndsAt && Date.parse(item.auctionEndsAt) <= Date.parse(this.state.now))
      .flatMap((item) => this.settleExpiredAuction(item.id));
    const events = [...auctionEvents, ...this.commit(specs)];
    expiredPurchaseIntentIds.forEach((intentId) => {
      const intent = this.state.purchaseIntents.find((candidate) => candidate.id === intentId);
      if (intent) this.addNotification(intent.buyerId, '購入予約の期限が切れました', '在庫予約を解放しました。もう一度購入手続きを開始してください。', events.at(-1)?.id);
    });
    return resultOk({ now: this.state.now, expiredPurchaseIntentIds }, this.state.stateVersion, events);
  }

  public injectFailure(failure: string, options?: AgentActionOptions): ActionResult<{ pendingFailures: string[] }> {
    const invalid = this.validateControlOptions(options);
    if (invalid) return invalid as ActionResult<{ pendingFailures: string[] }>;
    const actor = this.actorFor(options);
    if (!actor || (actor.role !== 'admin' && actor.role !== 'platform')) return resultError('FORBIDDEN', this.state.stateVersion, '障害注入はadmin/platformだけが実行できます');
    if (typeof failure !== 'string') return resultError('INVALID_INPUT', this.state.stateVersion, '障害名の形式が不正です');
    const normalized = normalize(failure);
    if (!['payment', 'delivery', 'notification'].includes(normalized)) return resultError('INVALID_INPUT', this.state.stateVersion, '対応する障害はpayment、delivery、notificationです');
    if (!this.state.pendingFailures.includes(normalized)) this.state.pendingFailures.push(normalized);
    const events = this.commit([{ type: 'FAILURE_INJECTED', aggregateType: 'system', aggregateId: normalized, actorId: actor.id, payload: { failure: normalized } }]);
    return resultOk({ pendingFailures: [...this.state.pendingFailures] }, this.state.stateVersion, events);
  }

  public markNotificationRead(notificationId: string): void {
    this.state.notifications = this.state.notifications.map((notification) => notification.id === notificationId ? { ...notification, isRead: true } : notification);
  }

  /**
   * Advance the aggregate version for deterministic client-side view/domain
   * state changes that do not produce a business event (navigation, likes,
   * view counters, and read markers). Keeping this on the engine means the
   * persisted snapshot and ActionResult metadata cannot drift apart.
   */
  public advanceViewState(): number {
    this.state.stateVersion += 1;
    return this.state.stateVersion;
  }

  public replaceItems(items: MercariItem[]): void {
    const incoming = new Map(clone(items).map((item) => [item.id, item]));
    this.state.items = this.state.items.map((current) => {
      const next = incoming.get(current.id);
      if (!next) return current;
      const commentsById = new Map(current.comments.map((comment) => [comment.id, comment]));
      next.comments.forEach((comment) => commentsById.set(comment.id, comment));
      return {
        ...current,
        isLiked: next.isLiked,
        likesCount: Math.max(0, next.likesCount),
        viewsCount: Math.max(current.viewsCount ?? 0, next.viewsCount ?? 0),
        viewedAt: [current.viewedAt, next.viewedAt].filter(Boolean).sort().at(-1),
        comments: [...commentsById.values()],
      };
    });
  }

  public replacePersistedInventory(items: MercariItem[]): void {
    const incoming = new Map(clone(items).map((item) => [item.id, item]));
    this.state.items = this.state.items.map((current) => {
      const next = incoming.get(current.id);
      if (!next || this.state.purchaseIntents.some((intent) => intent.itemId === current.id && intent.status === 'ACTIVE')) return current;
      const initialQuantity = Math.max(0, current.inventoryInitialQuantity ?? current.inventoryQuantity ?? 0);
      const quantity = Math.min(initialQuantity, Math.max(0, Math.floor(next.inventoryQuantity ?? initialQuantity)));
      return { ...current, inventoryQuantity: quantity, reservedQuantity: 0, isSold: quantity === 0, listingStatus: quantity === 0 ? 'SOLD' : 'ACTIVE' };
    });
  }

  public exportState(): string {
    return JSON.stringify(this.state);
  }

  public importState(serialized: string, options?: AgentActionOptions): ActionResult<{ stateVersion: number }> {
    const invalid = this.validateControlOptions(options);
    if (invalid) return invalid as ActionResult<{ stateVersion: number }>;
    if (typeof serialized !== 'string' || serialized.length > MAX_IMPORTED_STATE_BYTES) {
      return resultError('INVALID_INPUT', this.state.stateVersion, `Sandbox stateは${MAX_IMPORTED_STATE_BYTES.toLocaleString()}文字以内のJSONで指定してください`);
    }
    try {
      const candidate = JSON.parse(serialized) as Partial<SandboxEngineState>;
      const migrated = {
        ...candidate,
        sandboxId: candidate.sandboxId ?? this.sandboxId,
        returns: candidate.returns ?? [],
        messages: candidate.messages ?? [],
        supportTickets: candidate.supportTickets ?? [],
        profiles: candidate.profiles ?? [],
        follows: candidate.follows ?? [],
      };
      const requiredArrays = [migrated.actors, migrated.items, migrated.purchaseIntents, migrated.transactions, migrated.payments, migrated.shipments, migrated.bids, migrated.reviews, migrated.inventoryMovements, migrated.events, migrated.notifications, migrated.wallets, migrated.returns, migrated.messages, migrated.supportTickets, migrated.profiles, migrated.follows];
      const valid = migrated.version === '1'
        && migrated.sandboxId === this.sandboxId
        && SCENARIOS.includes(migrated.scenarioId as ScenarioId)
        && typeof migrated.seed === 'string'
        && typeof migrated.now === 'string' && Number.isFinite(Date.parse(migrated.now))
        && Number.isInteger(migrated.stateVersion) && (migrated.stateVersion ?? -1) >= 0
        && Number.isInteger(migrated.idCounter) && (migrated.idCounter ?? -1) >= 0
        && typeof migrated.currentActorId === 'string'
        && requiredArrays.every(Array.isArray)
        && (migrated.actors ?? []).some((actor) => actor && actor.id === migrated.currentActorId)
        && isRecord(migrated.drafts ?? {})
        && isRecord(migrated.draftOwners ?? {})
        && (migrated.items ?? []).every((item) => item && typeof item.id === 'string' && Number.isFinite(item.price) && item.price >= 0 && Number.isInteger(item.inventoryQuantity ?? 0) && Number.isInteger(item.reservedQuantity ?? 0));
      if (!valid) return resultError('INVALID_INPUT', this.state.stateVersion, 'Sandbox stateの形式が不正です');
      const normalizedItems = (migrated.items ?? []).map((item) => ({
        ...item,
        images: Array.isArray(item.images) && item.images.length ? item.images : ['/images/products/knit.jpg'],
      }));
      const normalizedDrafts = Object.fromEntries(Object.entries(migrated.drafts ?? {}).map(([draftId, fields]) => [draftId, {
        ...fields,
        images: Array.isArray(fields.images) ? fields.images : [],
      }])) as Record<string, Partial<MercariItem>>;
      const normalizedWallets = (migrated.wallets ?? []).map((wallet) => {
        const actor = (migrated.actors ?? []).find((candidate) => candidate?.id === wallet?.actorId);
        const openingBalance = Number.isInteger(wallet?.openingBalance) && (wallet?.openingBalance ?? 0) >= 0
          ? wallet.openingBalance
          : actor?.role === 'buyer' ? 200000 : 0;
        return { ...wallet, openingBalance, ledger: Array.isArray(wallet?.ledger) ? wallet.ledger : [] };
      });
      const previous = this.state;
      this.state = { ...clone({ ...migrated, sandboxId: this.sandboxId, items: normalizedItems, wallets: normalizedWallets, drafts: normalizedDrafts, follows: migrated.follows ?? [] } as SandboxEngineState), wallets: normalizedWallets, drafts: normalizedDrafts, draftOwners: migrated.draftOwners ?? {}, follows: migrated.follows ?? [], pendingFailures: migrated.pendingFailures ?? [] };
      const violations = this.assertInvariants();
      if (violations.length) {
        this.state = previous;
        return resultError('INVALID_INPUT', previous.stateVersion, 'Sandbox stateの整合性検証に失敗しました', { violations });
      }
      return resultOk({ stateVersion: this.state.stateVersion }, this.state.stateVersion);
    } catch {
      return resultError('INVALID_INPUT', this.state.stateVersion, 'Sandbox stateをJSONとして読み込めません');
    }
  }

  public assertInvariants(): string[] {
    const violations: string[] = [];
    const state = this.state as SandboxEngineState;
    const arrays: Array<[string, unknown]> = [
      ['actors', state.actors], ['items', state.items], ['purchase-intents', state.purchaseIntents],
      ['transactions', state.transactions], ['payments', state.payments], ['shipments', state.shipments],
      ['bids', state.bids], ['reviews', state.reviews], ['inventory-movements', state.inventoryMovements],
      ['events', state.events], ['notifications', state.notifications], ['wallets', state.wallets],
      ['returns', state.returns], ['messages', state.messages], ['support-tickets', state.supportTickets], ['profiles', state.profiles], ['follows', state.follows],
    ];
    arrays.forEach(([label, value]) => {
      if (!Array.isArray(value)) violations.push(`${label}-not-array`);
    });
    const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(isRecord) : [];
    const checkUniqueIds = (label: string, values: unknown[], field = 'id') => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        const id = isRecord(value) && typeof value[field] === 'string' ? String(value[field]) : '';
        if (!id) violations.push(`${label}-invalid-id:${index}`);
        else if (seen.has(id)) violations.push(`${label}-duplicate-id:${id}`);
        else seen.add(id);
      });
    };
    arrays.forEach(([label, value]) => checkUniqueIds(label, Array.isArray(value) ? value : [], ['wallets', 'profiles'].includes(label) ? 'actorId' : 'id'));

    const actors = records(state.actors);
    const actorIds = new Set(actors.map((actor) => String(actor.id)));
    const actorRoles = new Map(actors.map((actor) => [String(actor.id), actor.role]));
    const validRoles = new Set(['guest', 'buyer', 'seller', 'admin', 'platform']);
    actors.forEach((actor) => {
      if (typeof actor.id !== 'string' || !validRoles.has(String(actor.role)) || typeof actor.name !== 'string' || typeof actor.authenticated !== 'boolean') {
        violations.push(`actor-invalid:${String(actor.id)}`);
      }
    });
    if (!actorIds.has(state.currentActorId)) violations.push(`current-actor-missing:${state.currentActorId}`);

    const items = records(state.items);
    const itemIds = new Set(items.map((item) => String(item.id)));
    const validListingStatuses = new Set(['DRAFT', 'ACTIVE', 'HELD', 'RESERVED', 'SOLD', 'ARCHIVED']);
    items.forEach((item) => {
      const id = String(item.id);
      const quantity = item.inventoryQuantity;
      const reserved = item.reservedQuantity;
      const initialQuantity = item.inventoryInitialQuantity;
      if (!isInteger(item.price) || Number(item.price) < 0) violations.push(`item-price-invalid:${id}`);
      if (!isInteger(quantity) || Number(quantity) < 0) violations.push(`inventory-negative:${id}`);
      if (!isInteger(initialQuantity) || Number(initialQuantity) < 0) violations.push(`inventory-initial-invalid:${id}`);
      if (isInteger(quantity) && isInteger(initialQuantity) && Number(quantity) > Number(initialQuantity)) violations.push(`inventory-exceeds-initial:${id}`);
      if (!isInteger(reserved) || Number(reserved) < 0) violations.push(`reserved-negative:${id}`);
      if (isInteger(reserved) && isInteger(quantity) && Number(reserved) > Number(quantity)) violations.push(`reserved-exceeds-on-hand:${id}`);
      if (Number(quantity ?? 0) === 0 && item.isSold !== true) violations.push(`zero-quantity-not-sold:${id}`);
      if (item.isSold === true && Number(quantity ?? 0) > 0) violations.push(`sold-with-quantity:${id}`);
      if (typeof item.sellerId !== 'string' || !actorIds.has(item.sellerId) || actorRoles.get(item.sellerId) !== 'seller') violations.push(`item-seller-missing:${id}`);
      if (item.listingStatus !== undefined && !validListingStatuses.has(String(item.listingStatus))) violations.push(`listing-status-invalid:${id}`);
    });

    const intents = records(state.purchaseIntents);
    const intentIds = new Set(intents.map((intent) => String(intent.id)));
    const intentById = new Map(intents.map((intent) => [String(intent.id), intent]));
    const validReservationStatuses = new Set(['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED']);
    intents.forEach((intent) => {
      const id = String(intent.id);
      if (!itemIds.has(String(intent.itemId))) violations.push(`intent-item-missing:${id}`);
      if (!actorIds.has(String(intent.buyerId)) || actorRoles.get(String(intent.buyerId)) !== 'buyer') violations.push(`intent-buyer-invalid:${id}`);
      if (!isInteger(intent.quantity) || Number(intent.quantity) <= 0) violations.push(`intent-quantity-invalid:${id}`);
      if (!isInteger(intent.quote) || Number(intent.quote) < 0) violations.push(`intent-quote-invalid:${id}`);
      if (!validReservationStatuses.has(String(intent.status)) || !isIsoDate(intent.createdAt) || !isIsoDate(intent.expiresAt)) violations.push(`intent-shape-invalid:${id}`);
    });

    const transactions = records(state.transactions);
    const transactionIds = new Set(transactions.map((transaction) => String(transaction.id)));
    const transactionById = new Map(transactions.map((transaction) => [String(transaction.id), transaction]));
    const orderIds = new Set<string>();
    const validTransactionStatuses = new Set(['CREATED', 'PAYMENT_PENDING', 'PAID', 'AWAITING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'BUYER_REVIEWED', 'SELLER_REVIEWED', 'COMPLETED', 'CANCEL_REQUESTED', 'CANCELED', 'REFUNDED']);
    transactions.forEach((transaction) => {
      const id = String(transaction.id);
      if (typeof transaction.orderId !== 'string' || orderIds.has(transaction.orderId)) violations.push(`transaction-order-duplicate:${id}`);
      if (typeof transaction.orderId === 'string') orderIds.add(transaction.orderId);
      if (!itemIds.has(String(transaction.itemId))) violations.push(`transaction-item-missing:${id}`);
      if (!actorIds.has(String(transaction.buyerId)) || actorRoles.get(String(transaction.buyerId)) !== 'buyer') violations.push(`transaction-buyer-invalid:${id}`);
      if (!actorIds.has(String(transaction.sellerId)) || actorRoles.get(String(transaction.sellerId)) !== 'seller') violations.push(`transaction-seller-invalid:${id}`);
      if (!intentIds.has(String(transaction.reservationId))) violations.push(`transaction-reservation-missing:${id}`);
      if (!isIsoDate(transaction.createdAt) || !isIsoDate(transaction.updatedAt) || !validTransactionStatuses.has(String(transaction.status))) violations.push(`transaction-shape-invalid:${id}`);
      const intent = intentById.get(String(transaction.reservationId));
      if (intent && (String(intent.transactionId) !== id || String(intent.itemId) !== String(transaction.itemId) || String(intent.buyerId) !== String(transaction.buyerId))) violations.push(`transaction-intent-mismatch:${id}`);
    });

    const payments = records(state.payments);
    const paymentIds = new Set(payments.map((payment) => String(payment.id)));
    const paymentById = new Map(payments.map((payment) => [String(payment.id), payment]));
    payments.forEach((payment) => {
      const id = String(payment.id);
      if (!transactionIds.has(String(payment.transactionId))) violations.push(`payment-transaction-missing:${id}`);
      if (!isInteger(payment.amount) || Number(payment.amount) < 0 || !isIsoDate(payment.createdAt) || !isIsoDate(payment.updatedAt)) violations.push(`payment-shape-invalid:${id}`);
    });
    const shipments = records(state.shipments);
    const shipmentIds = new Set(shipments.map((shipment) => String(shipment.id)));
    const shipmentById = new Map(shipments.map((shipment) => [String(shipment.id), shipment]));
    shipments.forEach((shipment) => {
      const id = String(shipment.id);
      if (!transactionIds.has(String(shipment.transactionId))) violations.push(`shipment-transaction-missing:${id}`);
      if (!isIsoDate(shipment.createdAt) || !isIsoDate(shipment.updatedAt)) violations.push(`shipment-shape-invalid:${id}`);
    });
    transactions.forEach((transaction) => {
      const id = String(transaction.id);
      const payment = paymentById.get(String(transaction.paymentId));
      const shipment = shipmentById.get(String(transaction.shipmentId));
      if (!payment || String(payment.transactionId) !== id) violations.push(`transaction-payment-mismatch:${id}`);
      if (!shipment || String(shipment.transactionId) !== id) violations.push(`transaction-shipment-mismatch:${id}`);
      const capturedStatuses = new Set(['PAID', 'AWAITING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'BUYER_REVIEWED', 'SELLER_REVIEWED', 'COMPLETED', 'CANCEL_REQUESTED']);
      if (capturedStatuses.has(String(transaction.status)) && payment?.status !== 'CAPTURED') violations.push(`captured-status-without-captured-payment:${id}`);
      if (transaction.status === 'COMPLETED' && payment?.status !== 'CAPTURED') violations.push(`completed-without-captured-payment:${id}`);
      if (transaction.status === 'REFUNDED' && !['REFUNDED', 'PARTIALLY_REFUNDED'].includes(String(payment?.status))) violations.push(`refunded-without-refunded-payment:${id}`);
      if (transaction.status === 'CANCEL_REQUESTED' && payment?.status !== 'CAPTURED') violations.push(`cancel-request-without-captured-payment:${id}`);
    });

    items.forEach((item) => {
      const expectedReserved = intents.filter((intent) => String(intent.itemId) === String(item.id) && intent.status === 'ACTIVE').reduce((sum, intent) => sum + Number(intent.quantity ?? 0), 0);
      if (expectedReserved !== Number(item.reservedQuantity ?? 0)) violations.push(`reserved-does-not-match-active-intents:${String(item.id)}`);
    });

    const bids = records(state.bids);
    bids.forEach((bid) => {
      const id = String(bid.id);
      if (!itemIds.has(String(bid.itemId)) || !actorIds.has(String(bid.bidderId)) || actorRoles.get(String(bid.bidderId)) !== 'buyer' || !isInteger(bid.amount) || Number(bid.amount) <= 0 || !isIsoDate(bid.createdAt)) violations.push(`bid-invalid:${id}`);
    });
    const reviews = records(state.reviews);
    reviews.forEach((review) => {
      const id = String(review.id);
      const transaction = transactionById.get(String(review.transactionId));
      if (!transaction || ![String(transaction.buyerId), String(transaction.sellerId)].includes(String(review.reviewerId)) || !isInteger(review.rating) || Number(review.rating) < 1 || Number(review.rating) > 5) violations.push(`review-invalid:${id}`);
    });
    const returns = records(state.returns);
    const validReturnStatuses = new Set(['REQUESTED', 'APPROVED', 'DECLINED', 'IN_TRANSIT', 'RECEIVED', 'REFUND_COMPLETED']);
    returns.forEach((returnCase) => {
      const id = String(returnCase.id);
      const transaction = transactionById.get(String(returnCase.transactionId));
      if (!transaction || String(transaction.buyerId) !== String(returnCase.requesterId) || !validReturnStatuses.has(String(returnCase.status)) || !isIsoDate(returnCase.requestedAt)) violations.push(`return-invalid:${id}`);
      if (returnCase.decidedAt !== undefined && !isIsoDate(returnCase.decidedAt)) violations.push(`return-decision-date-invalid:${id}`);
      if (returnCase.receivedAt !== undefined && !isIsoDate(returnCase.receivedAt)) violations.push(`return-received-date-invalid:${id}`);
      if (returnCase.refundedAt !== undefined && !isIsoDate(returnCase.refundedAt)) violations.push(`return-refunded-date-invalid:${id}`);
    });
    const messages = records(state.messages);
    messages.forEach((message) => {
      const id = String(message.id);
      const transaction = transactionById.get(String(message.transactionId));
      const participants = transaction ? [String(transaction.buyerId), String(transaction.sellerId), 'admin_01', 'platform'] : [];
      if (!transaction || !participants.includes(String(message.senderId)) || typeof message.body !== 'string' || message.body.length === 0 || message.body.length > 1000 || !Array.isArray(message.readBy) || message.readBy.some((reader) => !actorIds.has(String(reader))) || !isIsoDate(message.createdAt)) violations.push(`message-invalid:${id}`);
    });
    const supportTickets = records(state.supportTickets);
    const validTicketStatuses = new Set(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']);
    supportTickets.forEach((ticket) => {
      const id = String(ticket.id);
      if (!actorIds.has(String(ticket.reporterId)) || (ticket.transactionId !== undefined && !transactionIds.has(String(ticket.transactionId))) || !['TRANSACTION', 'LISTING', 'PAYMENT', 'DELIVERY', 'SAFETY'].includes(String(ticket.category)) || typeof ticket.subject !== 'string' || typeof ticket.body !== 'string' || !Array.isArray(ticket.evidence) || ticket.evidence.some((evidence) => typeof evidence !== 'string' || evidence.length > 2_000_000) || !validTicketStatuses.has(String(ticket.status)) || !isIsoDate(ticket.createdAt) || !isIsoDate(ticket.updatedAt)) violations.push(`support-ticket-invalid:${id}`);
    });
    const profiles = records(state.profiles);
    profiles.forEach((profile) => {
      const id = String(profile.actorId);
      if (!actorIds.has(id) || typeof profile.displayName !== 'string' || typeof profile.bio !== 'string' || typeof profile.avatar !== 'string' || (profile.avatarRef !== undefined && (typeof profile.avatarRef !== 'string' || !/^media_[A-Za-z0-9_-]+$/u.test(profile.avatarRef))) || !isInteger(profile.rating) || Number(profile.rating) < 0 || Number(profile.rating) > 5 || !isInteger(profile.ratingsCount) || Number(profile.ratingsCount) < 0 || !isInteger(profile.completedSales) || Number(profile.completedSales) < 0 || !isInteger(profile.completedPurchases) || Number(profile.completedPurchases) < 0 || typeof profile.isVerified !== 'boolean' || !isIsoDate(profile.updatedAt)) violations.push(`profile-invalid:${id}`);
    });
    const follows = records(state.follows);
    const followPairs = new Set<string>();
    follows.forEach((follow) => {
      const id = String(follow.id);
      const followerId = String(follow.followerId);
      const followeeId = String(follow.followeeId);
      const pair = `${followerId}:${followeeId}`;
      if (!actorIds.has(followerId) || actorRoles.get(followerId) === 'guest' || !actorIds.has(followeeId) || actorRoles.get(followeeId) === 'guest') violations.push(`follow-actor-invalid:${id}`);
      if (followerId === followeeId) violations.push(`follow-self:${id}`);
      if (followPairs.has(pair)) violations.push(`follow-duplicate-pair:${pair}`);
      followPairs.add(pair);
      if (!isIsoDate(follow.createdAt)) violations.push(`follow-date-invalid:${id}`);
    });
    records(state.inventoryMovements).forEach((movement) => {
      const id = String(movement.id);
      if (!itemIds.has(String(movement.itemId)) || !isInteger(movement.quantity) || Number(movement.quantity) <= 0 || !isIsoDate(movement.at)) violations.push(`inventory-movement-invalid:${id}`);
    });

    const wallets = records(state.wallets);
    const walletActorIds = new Set<string>();
    wallets.forEach((wallet) => {
      const actorId = String(wallet.actorId);
      if (walletActorIds.has(actorId)) violations.push(`wallet-duplicate:${actorId}`);
      walletActorIds.add(actorId);
      if (!actorIds.has(actorId) || actorRoles.get(actorId) === 'guest') violations.push(`wallet-actor-invalid:${actorId}`);
      if (!isInteger(wallet.openingBalance) || Number(wallet.openingBalance) < 0) violations.push(`wallet-opening-negative:${actorId}`);
      if (!isInteger(wallet.availableBalance) || Number(wallet.availableBalance) < 0) violations.push(`wallet-available-negative:${actorId}`);
      if (!isInteger(wallet.heldBalance) || Number(wallet.heldBalance) < 0) violations.push(`wallet-held-negative:${actorId}`);
      if (!isInteger(wallet.points) || Number(wallet.points) < 0 || !Array.isArray(wallet.ledger)) violations.push(`wallet-shape-invalid:${actorId}`);
      let derivedAvailable = Number(wallet.openingBalance);
      let derivedHeld = 0;
      const ledgerIds = new Set<string>();
      (Array.isArray(wallet.ledger) ? wallet.ledger : []).forEach((entry) => {
        const ledger = isRecord(entry) ? entry : {};
        const entryId = typeof ledger.id === 'string' ? ledger.id : '';
        const entryType = String(ledger.type);
        const amount = ledger.amount;
        if (!entryId || ledgerIds.has(entryId) || !['DEPOSIT', 'WITHDRAWAL', 'HOLD', 'CAPTURE', 'REFUND', 'SALE', 'FEE'].includes(entryType) || !isInteger(amount) || Number(amount) <= 0 || typeof ledger.referenceId !== 'string' || !isIsoDate(ledger.at)) {
          violations.push(`wallet-ledger-invalid:${actorId}`);
          return;
        }
        ledgerIds.add(entryId);
        if (entryType === 'DEPOSIT') derivedAvailable += Number(amount);
        if (entryType === 'WITHDRAWAL') derivedAvailable -= Number(amount);
        if (entryType === 'HOLD') { derivedAvailable -= Number(amount); derivedHeld += Number(amount); }
        if (entryType === 'CAPTURE') derivedHeld -= Number(amount);
        if (entryType === 'REFUND') { derivedHeld -= Number(amount); derivedAvailable += Number(amount); }
        if (entryType === 'SALE') derivedAvailable += Number(amount);
        if (entryType === 'FEE') derivedAvailable -= Number(amount);
      });
      if (derivedAvailable !== Number(wallet.availableBalance) || derivedHeld !== Number(wallet.heldBalance) || derivedAvailable < 0 || derivedHeld < 0) violations.push(`wallet-ledger-balance-mismatch:${actorId}`);
    });

    const events = records(state.events);
    let previousEventVersion = 0;
    const correlationIds = new Set<string>();
    events.forEach((event) => {
      const id = String(event.id);
      const version = event.stateVersion;
      if (!actorIds.has(String(event.actorId)) || !isInteger(version) || Number(version) <= 0 || Number(version) > state.stateVersion || Number(version) < previousEventVersion || !isIsoDate(event.at) || typeof event.correlationId !== 'string' || !event.correlationId) violations.push(`event-invalid:${id}`);
      previousEventVersion = Math.max(previousEventVersion, Number(version ?? 0));
      if (typeof event.correlationId === 'string') correlationIds.add(event.correlationId);
      const isDraftEvent = ['LISTING_DRAFT_CREATED', 'LISTING_DRAFT_UPDATED'].includes(String(event.type));
      if (!isDraftEvent && ['listing', 'inventory', 'auction'].includes(String(event.aggregateType)) && !itemIds.has(String(event.aggregateId))) violations.push(`event-item-missing:${id}`);
      if (['transaction'].includes(String(event.aggregateType)) && !transactionIds.has(String(event.aggregateId))) violations.push(`event-transaction-missing:${id}`);
      if (['payment'].includes(String(event.aggregateType)) && !paymentIds.has(String(event.aggregateId))) violations.push(`event-payment-missing:${id}`);
      if (['shipment'].includes(String(event.aggregateType)) && !shipmentIds.has(String(event.aggregateId))) violations.push(`event-shipment-missing:${id}`);
    });
    records(state.notifications).forEach((notification) => {
      if (notification.actorId !== undefined && (!actorIds.has(String(notification.actorId)) || actorRoles.get(String(notification.actorId)) === 'guest')) violations.push(`notification-actor-invalid:${String(notification.id)}`);
    });

    if (!isRecord(state.drafts)) violations.push('drafts-not-object');
    if (!isRecord(state.draftOwners)) violations.push('draft-owners-not-object');
    const drafts = isRecord(state.drafts) ? state.drafts : {};
    const draftOwners = isRecord(state.draftOwners) ? state.draftOwners : {};
    Object.keys(drafts).forEach((draftId) => {
      if (!Object.prototype.hasOwnProperty.call(draftOwners, draftId) || !actorIds.has(String(draftOwners[draftId])) || !isRecord(drafts[draftId])) violations.push(`draft-reference-invalid:${draftId}`);
    });
    Object.keys(draftOwners).forEach((draftId) => {
      if (!Object.prototype.hasOwnProperty.call(drafts, draftId)) violations.push(`draft-owner-without-draft:${draftId}`);
    });
    if (!Array.isArray(state.pendingFailures) || state.pendingFailures.some((failure) => !['payment', 'delivery', 'notification'].includes(String(failure)))) violations.push('pending-failures-invalid');
    return violations;
  }
}

export const SANDBOX_SCENARIOS = [...SCENARIOS];
