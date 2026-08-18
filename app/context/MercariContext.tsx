'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  ActionResult,
  ActionPreview,
  ActorProfile,
  AgentActionOptions,
  CatalogListInput,
  CatalogListResult,
  FollowDirection,
  FollowListResult,
  FollowMutationResult,
  FollowSummary,
  HomeTab,
  InventoryMovement,
  ListingDraftSummary,
  MainTab,
  MyPagePanel,
  MercariAgentAPI,
  MercariAgentSnapshot,
  MercariItem,
  NotificationItem,
  PurchasePricing,
  PreviewCommand,
  SandboxActor,
  SandboxSnapshot,
  SaveListingDraftInput,
  ScenarioId,
  TransactionRecord,
  UserProfile,
  WalletSnapshot,
} from '../types/mercari';
import { CATALOG_ITEMS } from '../data/catalogData';
import { INITIAL_NOTIFICATIONS, INITIAL_USER } from '../data/initialData';
import { searchCatalogItems } from '../components/searchUtils';
import { SandboxEngine, createTrustedPrincipal, type ConfirmPurchaseResult, type StartPurchaseResult } from '../domain/sandboxEngine';
import { SandboxCommandBus, compactImagePayloadForFingerprint, fingerprint } from '../domain/commandBus';
import { applyPreviewOperation } from '../domain/previewOperations';
import { IndexedDbSandboxStateStore } from '../domain/sandboxIdbStore';
import type { SandboxCommandRecord, SandboxPreviewRecord, SandboxStateRecord } from '../domain/sandboxStore';

const PREFERENCES_STORAGE_KEY = 'shop-ui-preferences-v1';
const INVENTORY_STORAGE_KEY = 'shop-inventory-v1';
const SANDBOX_STATE_STORAGE_KEY = 'furima-sandbox-state-v2';
const REMOTE_SANDBOX_STATE_ID = 'furima-demo-catalog-50';
// The browser never receives the D1 bearer/control secret. Until a signed
// session adapter is installed, D1 remains an operator API and browser state
// stays on IndexedDB (with an explicit volatile diagnostic fallback).
const REMOTE_STATE_ENABLED = false;
const scopedStorageKey = (base: string, actorId: string): string => `${base}:${REMOTE_SANDBOX_STATE_ID}:${actorId}`;
const SANDBOX_CONTROL_PRINCIPAL = createTrustedPrincipal({ subjectId: 'local-sandbox-inspector', actorId: 'platform', roles: ['platform'], scopes: ['sandbox-control', 'operator'] });
const SANDBOX_CONTROL_OPTIONS = { principal: SANDBOX_CONTROL_PRINCIPAL } as const satisfies AgentActionOptions;
const READY_TIMEOUT_MS = 15_000;
const PERSIST_DEBOUNCE_MS = 250;
const READ_COMMANDS = new Set(['getWallet', 'getListingDrafts', 'catalog.list', 'catalog.get', 'getFollowList', 'getFollowSummary', 'getSnapshot', 'getState']);
const MAX_DURABLE_RESULT_BYTES = 64 * 1024;

const durableCommandResult = <T,>(result: ActionResult<T>): string => {
  const serialized = JSON.stringify(result);
  if (new TextEncoder().encode(serialized).byteLength <= MAX_DURABLE_RESULT_BYTES) return serialized;
  return JSON.stringify(result.ok ? { ...result, data: { truncated: true, reason: 'RESULT_TOO_LARGE' } } : { ...result, details: undefined });
};

// The public UI starts from the curated catalog. INITIAL_ITEMS remains a
// legacy fixture for isolated sandbox tests and is intentionally not merged
// into the customer-facing catalog.
const INITIAL_CATALOG_ITEMS = [...CATALOG_ITEMS];
const ITEM_ROUTE_PREFIX = '#item=';

interface ItemRouteOrigin {
  mainTab: MainTab;
  homeTab: HomeTab;
  categoryName: string | null;
  myPagePanel: MyPagePanel | null;
  isSearchOpen: boolean;
  searchQuery: string;
}

interface ItemHistoryState {
  furimaItemId?: string;
  furimaOrigin?: ItemRouteOrigin;
}

const readItemRoute = (): string | null => {
  if (typeof window === 'undefined' || !window.location.hash.startsWith(ITEM_ROUTE_PREFIX)) return null;
  try {
    const itemId = decodeURIComponent(window.location.hash.slice(ITEM_ROUTE_PREFIX.length));
    return itemId.trim() || null;
  } catch {
    return null;
  }
};

const replaceItemRoute = () => {
  if (typeof window === 'undefined' || !readItemRoute()) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
};

const itemHistoryState = (): ItemHistoryState => {
  if (typeof window === 'undefined' || !window.history.state || typeof window.history.state !== 'object') return {};
  return window.history.state as ItemHistoryState;
};

interface PersistedPreferences {
  likedItemIds?: string[];
  searchHistory?: string[];
  recentlyViewedIds?: string[];
  savedItemIds?: string[];
}

interface PersistedInventory {
  soldItemIds?: string[];
  inventoryQuantities?: Record<string, number>;
}

const readPersistedPreferences = (actorId = 'buyer_01'): PersistedPreferences => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(PREFERENCES_STORAGE_KEY, actorId)) ?? window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return raw ? JSON.parse(raw) as PersistedPreferences : {};
  } catch {
    return {};
  }
};

const readPersistedInventory = (actorId = 'buyer_01'): PersistedInventory => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(INVENTORY_STORAGE_KEY, actorId)) ?? window.localStorage.getItem(INVENTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) as PersistedInventory : {};
  } catch {
    return {};
  }
};

const INITIAL_SEARCH_HISTORY = ['ゲーム・おもちゃ・グッズ', '本・雑誌・漫画', 'ファッション, メンズ', 'ノートPC', 'PC', 'ゲーム', '本・マンガ', 'ファッション'];
const INITIAL_RECENTLY_VIEWED_IDS = CATALOG_ITEMS.slice(0, 6).map((item) => item.id);

const isMainTabValue = (value: unknown): value is MainTab => ['home', 'category', 'notifications', 'sell', 'mypage'].includes(value as string);
const isHomeTabValue = (value: unknown): value is HomeTab => ['recommend', 'mylist', 'auction'].includes(value as string);

const cloneItem = (item: MercariItem): MercariItem => ({
  ...item,
  images: [...item.images],
  category: [...item.category],
  searchTags: item.searchTags ? [...item.searchTags] : undefined,
  attributes: item.attributes ? { ...item.attributes } : undefined,
  seller: { ...item.seller },
  comments: item.comments.map((comment) => ({ ...comment })),
});
const cloneItems = (items: MercariItem[]) => items.map(cloneItem);
const cloneNotifications = (items: NotificationItem[]) => items.map((item) => ({ ...item }));
const notificationsForActor = (items: NotificationItem[], actor: SandboxActor): NotificationItem[] => {
  if (actor.role === 'admin' || actor.role === 'platform') return cloneNotifications(items);
  return cloneNotifications(items.filter((item) => !item.actorId || item.actorId === actor.id));
};
const SYNTHETIC_BRANDS = ['Apple', 'ASUS', 'MSI', 'Nintendo', 'SONY', 'UNIQLO', '無印良品'];
const SYNTHETIC_COLORS = ['ブラック', 'ホワイト', 'グレー', 'ブラウン', 'レッド', 'ブルー', 'グリーン'];
const createInitialItems = () => cloneItems(INITIAL_CATALOG_ITEMS).map((item, index) => ({
  ...item,
  isLiked: false,
  inventoryPolicy: item.inventoryPolicy ?? 'SINGLE',
  inventoryQuantity: item.isSold ? 0 : item.inventoryQuantity ?? 1,
  reservedQuantity: item.reservedQuantity ?? 0,
  listingStatus: item.isSold ? 'SOLD' as const : item.listingStatus ?? 'ACTIVE' as const,
  createdAt: item.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, index % 24, 0)).toISOString(),
  updatedAt: item.updatedAt ?? item.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, index % 24, 0)).toISOString(),
  isCouponEligible: item.isCouponEligible ?? index % 7 === 0,
  discountRate: item.discountRate ?? (index % 5 === 0 ? 10 : 0),
  isTimeSale: item.isTimeSale ?? index % 5 === 0,
  isGuaranteeEligible: item.isGuaranteeEligible ?? (Boolean(item.isAuthenticityEligible) || index % 11 === 0),
  brand: item.brand ?? SYNTHETIC_BRANDS.find((brand) => item.title.toLocaleLowerCase('ja-JP').includes(brand.toLocaleLowerCase('ja-JP'))),
  size: item.size ?? (item.category.some((value) => /ファッション|レディース|メンズ/u.test(value)) ? ['S', 'M', 'L'][index % 3] : undefined),
  color: item.color ?? SYNTHETIC_COLORS[index % SYNTHETIC_COLORS.length],
  sellerType: item.sellerType ?? (item.seller.name.toLocaleLowerCase('ja-JP').includes('shop') || item.seller.name.toLocaleLowerCase('ja-JP').includes('store') ? 'shop' : 'individual'),
  isAnonymousShipping: item.isAnonymousShipping ?? true,
  seller: { ...item.seller, avatar: item.seller.avatar.startsWith('http') ? '/favicon.svg' : item.seller.avatar },
  qualityTier: item.qualityTier ?? (item.isDemo ? 'gold' : 'synthetic'),
  auctionEndsAt: item.isAuction ? item.auctionEndsAt ?? '2026-01-02T00:00:00.000Z' : undefined,
}));
const createInitialInventoryMovements = (): InventoryMovement[] => INITIAL_CATALOG_ITEMS.flatMap((item) => {
  const importedAt = '2026-01-01T00:00:00.000Z';
  const initialQuantity = item.inventoryInitialQuantity ?? item.inventoryQuantity ?? 1;
  const initialIn: InventoryMovement = {
    id: `seed-in-${item.id}`,
    itemId: item.id,
    sku: item.sku,
    type: 'IN',
    quantity: initialQuantity,
    reason: item.isDemo ? 'デモカタログ初期インポート' : '初期在庫',
    at: importedAt,
  };
  if (!item.isSold) return [initialIn];
  return [initialIn, {
    id: `seed-out-${item.id}`,
    itemId: item.id,
    sku: item.sku,
    type: 'OUT',
    quantity: initialQuantity,
    reason: '初期SOLD状態',
    at: importedAt,
  }];
});
const digestText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};


const stripImagePayloadsForPersistence = (serialized: string): string => {
  if (!serialized.includes('data:image/') && !serialized.includes('blob:')) return serialized;
  const isMediaField = (key: string): boolean => /^(?:images?|avatar|thumbnail|preview|imageData|sourceFile)$/iu.test(key) || /(?:image|avatar|thumbnail|blob)/iu.test(key);
  const strip = (value: unknown, seen: WeakSet<object>, mediaField = false): unknown => {
    if (typeof value === 'string') return mediaField && (value.startsWith('data:image/') || value.startsWith('blob:')) ? undefined : value;
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map((entry) => strip(entry, seen, mediaField)).filter((entry): entry is unknown => entry !== undefined);
      seen.delete(value);
      return result;
    }
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      const next = strip(child, seen, isMediaField(key));
      if (next !== undefined) result[key] = next;
    });
    seen.delete(value);
    return result;
  };
  return JSON.stringify(strip(JSON.parse(serialized) as unknown, new WeakSet<object>()));
};

const success = <T,>(data: T, stateVersion: number): ActionResult<T> => ({ ok: true, data, stateVersion });
const failure = <T,>(error: Exclude<ActionResult<T>, { ok: true }>['error'], stateVersion: number, message?: string, details?: unknown): ActionResult<T> => ({
  ok: false,
  error,
  stateVersion,
  ...(message ? { message } : {}),
  ...(details === undefined ? {} : { details }),
});

interface MercariContextType {
  isAuthenticated: boolean;
  activeActor: SandboxActor;
  sandboxSnapshot: SandboxSnapshot;
  isSandboxReady: boolean;
  isLoginPromptOpen: boolean;
  loginPromptReason: string;
  requestLogin: (reason?: string) => void;
  closeLoginPrompt: () => void;
  mainTab: MainTab;
  setMainTab: (tab: MainTab) => void;
  myPagePanel: MyPagePanel | null;
  setMyPagePanel: (panel: MyPagePanel | null) => void;
  openMyPagePanel: (panel: MyPagePanel | null) => void;
  homeTab: HomeTab;
  setHomeTab: (tab: HomeTab) => void;
  navigateToTab: (tab: MainTab) => void;
  categoryName: string | null;
  setCategoryName: (category: string | null) => void;
  openCategory: (category: string) => ActionResult<undefined>;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchHistory: string[];
  addSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;
  selectedItemId: string | null;
  setSelectedItemId: (itemId: string | null) => void;
  selectedItem: MercariItem | null;
  setSelectedItem: (item: MercariItem | null) => void;
  openItem: (itemId: string) => ActionResult<undefined>;
  closeItem: () => void;
  buyingItemId: string | null;
  setBuyingItemId: (itemId: string | null) => void;
  buyingItem: MercariItem | null;
  setBuyingItem: (item: MercariItem | null) => void;
  startPurchase: (itemId: string) => ActionResult<StartPurchaseResult>;
  purchaseItem: (itemId: string, pricing?: PurchasePricing) => ActionResult<ConfirmPurchaseResult>;
  placeBid: (itemId: string, amount: number) => ActionResult<{ currentBid: number; bidsCount: number }>;
  isPurchaseCompleteOpen: boolean;
  setIsPurchaseCompleteOpen: (open: boolean) => void;
  isListingModalOpen: boolean;
  setIsListingModalOpen: (open: boolean) => void;
  items: MercariItem[];
  toggleLikeItem: (itemId: string) => void;
  setLiked: (itemId: string, liked: boolean) => ActionResult<undefined>;
  addNewItem: (item: Partial<MercariItem>) => ActionResult<MercariItem>;
  createListingDraft: (item: Partial<MercariItem>) => ActionResult<{ draftId: string }>;
  updateListingDraft: (draftId: string, item: Partial<MercariItem>) => ActionResult<{ draftId: string }>;
  getListingDrafts: () => ListingDraftSummary[];
  deleteListingDraft: (draftId: string) => ActionResult<{ draftId: string }>;
  submitListing: (draftId: string) => ActionResult<{ itemId: string }>;
  updateListing: (itemId: string, input: Partial<MercariItem>) => ReturnType<SandboxEngine['updateListing']>;
  pauseListing: (itemId: string) => ReturnType<SandboxEngine['pauseListing']>;
  resumeListing: (itemId: string) => ReturnType<SandboxEngine['resumeListing']>;
  relistItem: (itemId: string) => ReturnType<SandboxEngine['relistItem']>;
  addComment: (itemId: string, text: string) => ActionResult<undefined>;
  recentlyViewedIds: string[];
  savedItemIds: string[];
  setSaved: (itemId: string, saved: boolean) => ActionResult<undefined>;
  user: UserProfile;
  profile: ActorProfile | undefined;
  wallet: WalletSnapshot | undefined;
  getWallet: () => ActionResult<WalletSnapshot>;
  depositWallet: (amount: number) => ActionResult<WalletSnapshot>;
  withdrawWallet: (amount: number) => ActionResult<WalletSnapshot>;
  updateProfile: (input: Partial<ActorProfile>) => ActionResult<ActorProfile>;
  getFollowList: (direction: FollowDirection) => ActionResult<FollowListResult>;
  getFollowSummary: (actorId?: string) => ActionResult<FollowSummary>;
  followUser: (actorId: string) => ActionResult<FollowMutationResult>;
  unfollowUser: (actorId: string) => ActionResult<FollowMutationResult>;
  notifications: NotificationItem[];
  activeNotification: NotificationItem | null;
  openNotification: (notificationId: string) => void;
  setActiveNotification: (notification: NotificationItem | null) => void;
  isDeviceFrame: boolean;
  setIsDeviceFrame: (frame: boolean) => void;
  switchActor: (actorId: string) => ActionResult<SandboxActor>;
  loadScenario: (scenarioId: ScenarioId) => ActionResult<{ scenarioId: ScenarioId; seed: string; now: string }>;
  advanceClock: (milliseconds: number) => ActionResult<{ now: string; expiredPurchaseIntentIds: string[] }>;
  getTransactions: (actorId?: string) => TransactionRecord[];
  getDomainEvents: () => ReturnType<SandboxEngine['getDomainEvents']>;
  shipOrder: (transactionId: string) => ReturnType<SandboxEngine['shipOrder']>;
  markDelivered: (transactionId: string) => ReturnType<SandboxEngine['markDelivered']>;
  reviewOrder: (transactionId: string, rating: 1 | 2 | 3 | 4 | 5, comment?: string) => ReturnType<SandboxEngine['reviewOrder']>;
  cancelOrder: (transactionId: string, reason: string) => ReturnType<SandboxEngine['cancelOrder']>;
}

const MercariContext = createContext<MercariContextType | undefined>(undefined);

export const MercariProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mainTab, setMainTab] = useState<MainTab>('home');
  const [myPagePanel, setMyPagePanel] = useState<MyPagePanel | null>(null);
  const [homeTab, setHomeTabState] = useState<HomeTab>('recommend');
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpenState] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(INITIAL_SEARCH_HISTORY);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => readItemRoute());
  const [buyingItemId, setBuyingItemId] = useState<string | null>(null);
  const [isPurchaseCompleteOpen, setIsPurchaseCompleteOpen] = useState(false);
  const [isListingModalOpen, setIsListingModalOpenState] = useState(false);
  const [items, setItems] = useState<MercariItem[]>(createInitialItems);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => cloneNotifications(INITIAL_NOTIFICATIONS));
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(INITIAL_RECENTLY_VIEWED_IDS);
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);
  const [isPreferencesHydrated, setIsPreferencesHydrated] = useState(false);
  const [isInventoryHydrated, setIsInventoryHydrated] = useState(false);
  const [isDeviceFrame, setIsDeviceFrame] = useState(false);
  const [isSandboxReady, setIsSandboxReady] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [loginPromptReason, setLoginPromptReason] = useState('Furima Sandboxはログイン不要のモックモードです。');
  const [sandboxEngine] = useState(() => new SandboxEngine(items, { sandboxId: REMOTE_SANDBOX_STATE_ID, notifications: INITIAL_NOTIFICATIONS, seed: 'catalog-seed-v1' }));
  const liveSnapshot = sandboxEngine.getSnapshot();
  const [activeActorId, setActiveActorId] = useState(() => sandboxEngine.getCurrentActor().id);
  const activeActor = liveSnapshot.actors.find((actor) => actor.id === activeActorId) ?? liveSnapshot.actors.find((actor) => actor.id === liveSnapshot.currentActor.id) ?? sandboxEngine.getCurrentActor();
  const isAuthenticated = activeActor.authenticated;
  const profile = sandboxEngine.getProfile(activeActor.id);
  const wallet = liveSnapshot.wallets.find((candidate) => candidate.actorId === activeActor.id);
  const user: UserProfile = {
    name: profile?.displayName ?? (activeActor.id === 'buyer_01' ? INITIAL_USER.name : activeActor.name),
    avatar: profile?.avatar ?? INITIAL_USER.avatar,
    avatarRef: profile?.avatarRef,
    rating: profile?.rating ?? INITIAL_USER.rating,
    ratingsCount: profile?.ratingsCount ?? INITIAL_USER.ratingsCount,
    isVerified: profile?.isVerified ?? activeActor.authenticated,
    salesBalance: wallet?.availableBalance ?? (activeActor.id === 'buyer_01' ? INITIAL_USER.salesBalance : 0),
    points: wallet?.points ?? (activeActor.id === 'buyer_01' ? INITIAL_USER.points : 0),
    hasDPointLinked: activeActor.authenticated,
  };

  const stateVersionRef = useRef(sandboxEngine.getStateVersion());
  const [commandBus] = useState(() => new SandboxCommandBus({
    getContext: () => ({
      sandboxId: sandboxEngine.getSandboxId(),
      actorId: sandboxEngine.getCurrentActor().id,
      stateVersion: sandboxEngine.getStateVersion(),
    }),
  }));
  const previewCacheRef = useRef(new Map<string, { command: PreviewCommand; payload: unknown; actorId: string; sandboxId: string; stateVersion: number; expiresAt: number; summary: Record<string, unknown> }>());
  const pendingPreviewRecordsRef = useRef(new Map<string, SandboxPreviewRecord>());
  const previewCounterRef = useRef(0);
  const [browserSandboxStore] = useState(() => new IndexedDbSandboxStateStore());
  const durableCommandCacheRef = useRef(new Map<string, SandboxCommandRecord>());
  const localPersistChainRef = useRef(Promise.resolve());
  const persistTimerRef = useRef<number | null>(null);
  const localPersistedStateVersionRef = useRef<number | null>(null);
  const readyWaitersRef = useRef<Array<{ resolve: (result: ActionResult<{ sandboxId: string; stateVersion: number }>) => void; timeoutId: number }>>([]);
  const listingDraftsRef = useRef(new Map<string, Partial<MercariItem>>());
  const [initialInventoryMovements] = useState<InventoryMovement[]>(createInitialInventoryMovements);
  const inventoryMovementsRef = useRef<InventoryMovement[]>(initialInventoryMovements);
  const stateRef = useRef<MercariAgentSnapshot | null>(null);
  const itemRouteOriginRef = useRef<ItemRouteOrigin | null>(null);
  const sandboxHydratedRef = useRef(false);
  const sandboxLoadedFromStorageRef = useRef(false);
  const remoteStateVersionRef = useRef<number | null>(null);
  const remotePersistChainRef = useRef(Promise.resolve());
  const catalogLoadRef = useRef<Promise<void>>(Promise.resolve());
  const loadedCatalogItemsRef = useRef<MercariItem[]>([]);
  const agentExecutionDepthRef = useRef(0);

  const readyResult = (): ActionResult<{ sandboxId: string; stateVersion: number }> => success({ sandboxId: sandboxEngine.getSandboxId(), stateVersion: sandboxEngine.getStateVersion() }, sandboxEngine.getStateVersion());
  const waitForReady = (): Promise<ActionResult<{ sandboxId: string; stateVersion: number }>> => {
    if (sandboxHydratedRef.current) return Promise.resolve(readyResult());
    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        readyWaitersRef.current = readyWaitersRef.current.filter((waiter) => waiter.resolve !== resolve);
        resolve(failure('SANDBOX_NOT_READY', sandboxEngine.getStateVersion(), 'Sandboxの復元がタイムアウトしました。ページを再読み込みしてください。'));
      }, READY_TIMEOUT_MS);
      readyWaitersRef.current.push({ resolve, timeoutId });
    });
  };
  const resolveReady = () => {
    if (!sandboxHydratedRef.current) return;
    const result = readyResult();
    const waiters = readyWaitersRef.current.splice(0, readyWaitersRef.current.length);
    waiters.forEach(({ resolve, timeoutId }) => { window.clearTimeout(timeoutId); resolve(result); });
  };
  const failReadyWaiters = () => {
    const waiters = readyWaitersRef.current.splice(0, readyWaitersRef.current.length);
    waiters.forEach(({ resolve, timeoutId }) => { window.clearTimeout(timeoutId); resolve(failure('SANDBOX_NOT_READY', sandboxEngine.getStateVersion(), 'Sandboxの復元処理が中断されました。ページを再読み込みしてください。')); });
  };

  // React state is the rendering source, while this ref is the synchronous source
  // for the agent bridge. Keep both sides aligned inside each domain action so an
  // agent can read the new snapshot immediately after an action resolves.
  const sandboxStateRecord = (updatedAt = new Date().toISOString(), serialized?: string): SandboxStateRecord => {
    const snapshot = sandboxEngine.getSnapshot();
    return {
      id: sandboxEngine.getSandboxId(),
      scenarioId: snapshot.scenarioId,
      seed: snapshot.seed,
      stateVersion: snapshot.stateVersion,
      virtualNow: snapshot.now,
      payload: serialized ?? stripImagePayloadsForPersistence(sandboxEngine.exportState()),
      updatedAt,
    };
  };

  const persistSandboxStateNow = () => {
    if (!sandboxHydratedRef.current || typeof window === 'undefined') return;
    let serialized: string;
    try {
      serialized = stripImagePayloadsForPersistence(sandboxEngine.exportState());
    } catch {
      return;
    }
    const record = sandboxStateRecord(new Date().toISOString(), serialized);
    localPersistChainRef.current = localPersistChainRef.current.then(async () => {
      const expected = localPersistedStateVersionRef.current ?? undefined;
      const write = await browserSandboxStore.put(record, expected, false);
      if (write.ok) localPersistedStateVersionRef.current = record.stateVersion;
      const diagnostics = browserSandboxStore.getDiagnostics();
      window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...diagnostics, ...(diagnostics.fallbackReason ? { localPersistenceError: diagnostics.fallbackReason } : {}) };
    }).catch(() => {
      browserSandboxStore.recordFailure('UNAVAILABLE');
      window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), localPersistenceError: 'UNAVAILABLE' };
    });
    if (!REMOTE_STATE_ENABLED) return;
    remotePersistChainRef.current = remotePersistChainRef.current.then(async () => {
      try {
        const headers: HeadersInit = { accept: 'application/json', 'content-type': 'application/json' };
        if (remoteStateVersionRef.current !== null) headers['if-match-state-version'] = String(remoteStateVersionRef.current);
        const response = await fetch(`/api/sandbox/state?id=${REMOTE_SANDBOX_STATE_ID}`, { method: 'PUT', headers, body: serialized, keepalive: true, credentials: 'include' });
        if (response.ok) {
          const result = await response.json() as { stateVersion?: number };
          if (typeof result.stateVersion === 'number') remoteStateVersionRef.current = result.stateVersion;
        } else if (response.status === 401 || response.status === 403) {
          window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), remoteStateError: response.status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN' };
        } else if (response.status >= 500) {
          window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), remoteStateError: 'D1_UNAVAILABLE' };
        }
      } catch {
        window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), remoteStateError: 'D1_UNAVAILABLE' };
      }
    });
  };

  const persistSandboxState = () => {
    if (typeof window === 'undefined') return;
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      persistSandboxStateNow();
    }, PERSIST_DEBOUNCE_MS);
  };

  const patchStateRef = (patch: Partial<MercariAgentSnapshot>) => {
    if (!stateRef.current) return;
    stateRef.current = {
      ...stateRef.current,
      ...patch,
      stateVersion: stateVersionRef.current,
      searchHistory: patch.searchHistory ? [...patch.searchHistory] : stateRef.current.searchHistory,
      recentlyViewedIds: patch.recentlyViewedIds ? [...patch.recentlyViewedIds] : stateRef.current.recentlyViewedIds,
      savedItemIds: patch.savedItemIds ? [...patch.savedItemIds] : stateRef.current.savedItemIds,
      items: patch.items ? cloneItems(patch.items) : stateRef.current.items,
    };
  };

  const restoreItemRouteOrigin = () => {
    const origin = itemRouteOriginRef.current;
    itemRouteOriginRef.current = null;
    if (!origin) return;
    setMainTab(origin.mainTab);
    setHomeTabState(origin.homeTab);
    setCategoryName(origin.categoryName);
    setMyPagePanel(origin.myPagePanel);
    setIsSearchOpenState(origin.isSearchOpen);
    setSearchQuery(origin.searchQuery);
    setBuyingItemId(null);
    patchStateRef({
      currentMainTab: origin.mainTab,
      currentHomeTab: origin.homeTab,
      currentCategory: origin.categoryName,
      selectedItemId: null,
      buyingItemId: null,
      searchQuery: origin.searchQuery,
    });
  };

  const syncFromEngine = () => {
    const nextItems = sandboxEngine.getItems();
    const nextMovements = sandboxEngine.getInventoryMovements();
    const nextSandbox = sandboxEngine.getSnapshot();
    const nextNotifications = notificationsForActor(sandboxEngine.getNotifications(), nextSandbox.currentActor);
    setActiveActorId(nextSandbox.currentActor.id);
    setItems(nextItems);
    setNotifications(nextNotifications);
    inventoryMovementsRef.current = nextMovements;
    stateVersionRef.current = nextSandbox.stateVersion;
    patchStateRef({ items: nextItems, inventoryMovements: nextMovements, sandbox: nextSandbox });
    persistSandboxState();
    return nextSandbox;
  };

  const runUiCommand = <T,>(command: string, payload: unknown, operation: () => ActionResult<T>): ActionResult<T> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。準備完了後にもう一度お試しください。');
    if (agentExecutionDepthRef.current > 0) return operation();
    const stateVersionBefore = sandboxEngine.getStateVersion();
    const options = { actorId: sandboxEngine.getCurrentActor().id } as AgentActionOptions;
    const result = commandBus.execute(command, payload, options, operation);
    persistAgentCommand(command, payload, options, result, stateVersionBefore);
    return result;
  };

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const buyingItem = items.find((item) => item.id === buyingItemId) ?? null;
  const activeNotification = notifications.find((item) => item.id === activeNotificationId) ?? null;

  const requestLogin = (reason = 'この操作にはログインが必要です。') => {
    setLoginPromptReason(reason);
    setIsLoginPromptOpen(true);
  };
  const closeLoginPrompt = () => setIsLoginPromptOpen(false);
  const setHomeTab = (tab: HomeTab) => {
    setHomeTabState(tab);
    patchStateRef({ currentHomeTab: tab });
  };

  const setIsSearchOpen = (open: boolean) => {
    setIsSearchOpenState(open);
    if (open) {
      replaceItemRoute();
      setSelectedItemId(null);
      setBuyingItemId(null);
      setIsListingModalOpenState(false);
      patchStateRef({ selectedItemId: null, buyingItemId: null });
    }
  };

  const navigateToTab = (tab: MainTab) => {
    if (!sandboxEngine.getCurrentActor().authenticated && (tab === 'mypage' || tab === 'notifications' || tab === 'sell')) {
      requestLogin(tab === 'mypage' ? 'マイページを見るにはログインが必要です。' : tab === 'notifications' ? 'お知らせを見るにはログインが必要です。' : '出品をはじめるにはログインが必要です。');
      return;
    }
    setMainTab(tab);
    if (tab !== 'mypage') setMyPagePanel(null);
    setCategoryName(null);
    setIsSearchOpenState(false);
    replaceItemRoute();
    setSelectedItemId(null);
    setBuyingItemId(null);
    setIsListingModalOpenState(false);
    setActiveNotificationId(null);
    patchStateRef({
      currentMainTab: tab,
      currentCategory: null,
      selectedItemId: null,
      buyingItemId: null,
    });
  };

  const openMyPagePanel = (panel: MyPagePanel | null) => {
    if (!sandboxEngine.getCurrentActor().authenticated) {
      requestLogin('マイページの機能を利用するにはログインが必要です。');
      return;
    }
    setMyPagePanel(panel);
    navigateToTab('mypage');
  };

  const setIsListingModalOpen = (open: boolean) => {
    if (open && !sandboxEngine.getCurrentActor().authenticated) {
      requestLogin('出品をはじめるにはログインが必要です。');
      return;
    }
    setIsListingModalOpenState(open);
    if (open) {
      replaceItemRoute();
      setIsSearchOpenState(false);
      setSelectedItemId(null);
      setBuyingItemId(null);
      patchStateRef({ selectedItemId: null, buyingItemId: null });
    }
  };

  useEffect(() => {
    stateRef.current = {
      version: '1',
      sandboxId: sandboxEngine.getSandboxId(),
      stateVersion: stateVersionRef.current,
      currentMainTab: mainTab,
      currentHomeTab: homeTab,
      currentCategory: categoryName,
      searchQuery,
      selectedItemId,
      buyingItemId,
      searchHistory: [...searchHistory],
      recentlyViewedIds: [...recentlyViewedIds],
      savedItemIds: [...savedItemIds],
      itemsCount: items.length,
      items: cloneItems(items),
      inventoryMovements: sandboxEngine.getInventoryMovements(),
      sandbox: sandboxEngine.getSnapshot(),
    };
  }, [mainTab, homeTab, categoryName, searchQuery, selectedItemId, buyingItemId, searchHistory, recentlyViewedIds, savedItemIds, items, sandboxEngine]);

  // The callbacks intentionally close over the single stable engine instance.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let cancelled = false;
    const fetchCatalogPage = async (offset: number, limit = 40): Promise<{ items: MercariItem[]; total: number }> => {
      const response = await fetch(`/api/catalog?offset=${offset}&limit=${limit}`, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
      const items = await response.json() as unknown;
      if (!Array.isArray(items)) throw new Error('catalog response is not an array');
      const total = Number(response.headers.get('x-catalog-total') ?? items.length);
      return { items: items as MercariItem[], total: Number.isFinite(total) ? total : items.length };
    };
    const catalogLoad = fetchCatalogPage(0).then(async (firstPage) => {
      const pageSize = 40;
      const remainingOffsets = Array.from({ length: Math.max(0, Math.ceil((firstPage.total - firstPage.items.length) / pageSize)) }, (_, index) => (index + 1) * pageSize);
      const remaining = await Promise.all(remainingOffsets.map((offset) => fetchCatalogPage(offset, pageSize)));
      return [firstPage.items, ...remaining.map((page) => page.items)].flat();
    }).then((catalogItems) => {
      if (cancelled || !Array.isArray(catalogItems)) return;
      loadedCatalogItemsRef.current = catalogItems;
      sandboxEngine.mergeCatalogItems(catalogItems);
      syncFromEngine();
    }).catch(() => {
      // The curated 50-item catalog remains usable when the optional catalog
      // request cannot be loaded in an offline or restricted preview.
    });
    catalogLoadRef.current = catalogLoad;
    return () => { cancelled = true; };
  }, [sandboxEngine]);

  useEffect(() => {
    const syncItemRoute = () => {
      const itemId = readItemRoute();
      if (!itemId) {
        setSelectedItemId(null);
        restoreItemRouteOrigin();
        return;
      }
      const routeState = itemHistoryState();
      if (routeState.furimaOrigin) itemRouteOriginRef.current = routeState.furimaOrigin;
      if (stateRef.current?.items.some((item) => item.id === itemId)) {
        setMyPagePanel(null);
        setSelectedItemId(itemId);
      }
    };
    syncItemRoute();
    window.addEventListener('popstate', syncItemRoute);
    window.addEventListener('hashchange', syncItemRoute);
    return () => {
      window.removeEventListener('popstate', syncItemRoute);
      window.removeEventListener('hashchange', syncItemRoute);
    };
  }, [sandboxEngine]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        let restored = false;
        try {
          await catalogLoadRef.current;
          const storageDiagnostics = await browserSandboxStore.ready();
          window.__FURIMA_SANDBOX_DIAGNOSTICS__ = storageDiagnostics;
          await browserSandboxStore.purgeExpired(new Date().toISOString());
          const localRecord = await browserSandboxStore.get(REMOTE_SANDBOX_STATE_ID);
          if (localRecord) {
            const result = sandboxEngine.importState(localRecord.payload, SANDBOX_CONTROL_OPTIONS);
            if (result.ok) {
              sandboxEngine.mergeCatalogItems(loadedCatalogItemsRef.current);
              localPersistedStateVersionRef.current = localRecord.stateVersion;
              restored = true;
              sandboxLoadedFromStorageRef.current = true;
              syncFromEngine();
            } else {
              browserSandboxStore.recordFailure('CORRUPTED');
            }
          }
          const persistedPreviews = await browserSandboxStore.listPreviews(REMOTE_SANDBOX_STATE_ID);
          let highestPreviewSequence = 0;
          persistedPreviews.filter((preview) => preview.status === 'PENDING').forEach((preview) => {
            try {
              if (Date.parse(preview.virtualExpiresAt) <= Date.parse(sandboxEngine.getNow()) || Date.parse(preview.retentionExpiresAt) <= Date.now()) return;
              const payload = JSON.parse(preview.payload) as unknown;
              const summary = JSON.parse(preview.summary) as Record<string, unknown>;
              previewCacheRef.current.set(preview.previewId, {
                command: preview.command as PreviewCommand,
                payload,
                actorId: preview.actorId,
                sandboxId: preview.sandboxId,
                stateVersion: preview.baseStateVersion,
                expiresAt: Date.parse(preview.virtualExpiresAt),
                summary,
              });
              const suffix = Number(preview.previewId.match(/-(\d+)$/u)?.[1] ?? 0);
              highestPreviewSequence = Math.max(highestPreviewSequence, Number.isFinite(suffix) ? suffix : 0);
            } catch {
              // Corrupted preview records are ignored and remain visible in
              // the adapter diagnostics instead of being used for commits.
              browserSandboxStore.recordFailure('CORRUPTED');
            }
          });
          previewCounterRef.current = highestPreviewSequence;
          const persistedCommands = await browserSandboxStore.listCommands(REMOTE_SANDBOX_STATE_ID);
          persistedCommands.forEach((command) => durableCommandCacheRef.current.set(command.idempotencyKey ?? command.operationId, command));
        } catch {
          // IndexedDB is optional in private browsing and embedded previews.
        }
        if (!restored && REMOTE_STATE_ENABLED) {
          try {
            const response = await fetch(`/api/sandbox/state?id=${REMOTE_SANDBOX_STATE_ID}`, { headers: { accept: 'application/json' }, credentials: 'include' });
            if (response.ok) {
              const serialized = await response.text();
              const result = sandboxEngine.importState(serialized, SANDBOX_CONTROL_OPTIONS);
              if (result.ok) {
                sandboxEngine.mergeCatalogItems(loadedCatalogItemsRef.current);
                const parsed = JSON.parse(serialized) as { stateVersion?: number };
                remoteStateVersionRef.current = typeof parsed.stateVersion === 'number' ? parsed.stateVersion : null;
                restored = true;
                sandboxLoadedFromStorageRef.current = true;
                localPersistedStateVersionRef.current = typeof parsed.stateVersion === 'number' ? parsed.stateVersion : null;
                await browserSandboxStore.put(sandboxStateRecord(), undefined, true);
                syncFromEngine();
              }
            } else if (response.status === 401 || response.status === 403) {
              window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), remoteStateError: response.status === 401 ? 'AUTH_REQUIRED' : 'FORBIDDEN' };
            } else if (response.status >= 500) {
              window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), remoteStateError: 'D1_UNAVAILABLE' };
            }
          } catch {
            window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), remoteStateError: 'D1_UNAVAILABLE' };
          }
        }
        if (!restored) {
          try {
            const serialized = window.localStorage.getItem(SANDBOX_STATE_STORAGE_KEY);
            if (serialized) {
              const result = sandboxEngine.importState(serialized, SANDBOX_CONTROL_OPTIONS);
              if (result.ok) {
                sandboxEngine.mergeCatalogItems(loadedCatalogItemsRef.current);
                sandboxLoadedFromStorageRef.current = true;
                localPersistedStateVersionRef.current = sandboxEngine.getStateVersion();
                await browserSandboxStore.put(sandboxStateRecord(), undefined, true);
                browserSandboxStore.markLegacyMigration();
                window.localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
                syncFromEngine();
              } else {
                window.localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
              }
            }
          } catch {
            browserSandboxStore.recordFailure('CORRUPTED');
            // Ignore malformed or unavailable browser storage and start a clean sandbox.
          }
        }
        if (!cancelled) {
          sandboxHydratedRef.current = true;
          setIsSandboxReady(true);
          window.__FURIMA_SANDBOX_DIAGNOSTICS__ = browserSandboxStore.getDiagnostics();
          persistSandboxState();
          resolveReady();
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timeoutId); failReadyWaiters(); };
  }, [sandboxEngine]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const persisted = readPersistedPreferences(activeActor.id);
      if (!sandboxLoadedFromStorageRef.current && persisted.searchHistory) setSearchHistory(persisted.searchHistory);
      if (!sandboxLoadedFromStorageRef.current && persisted.recentlyViewedIds) setRecentlyViewedIds(persisted.recentlyViewedIds);
      if (!sandboxLoadedFromStorageRef.current && isAuthenticated && persisted.savedItemIds) setSavedItemIds(persisted.savedItemIds);
      if (!sandboxLoadedFromStorageRef.current && isAuthenticated && persisted.likedItemIds) {
        const likedItemIds = new Set(persisted.likedItemIds);
        setItems((previous) => {
          const nextItems = previous.map((item) => {
          const liked = likedItemIds.has(item.id);
          const baseLiked = Boolean(item.isLiked);
          return { ...item, isLiked: liked, likesCount: Math.max(0, item.likesCount + (liked === baseLiked ? 0 : liked ? 1 : -1)) };
          });
          sandboxEngine.replaceItems(nextItems);
          return nextItems;
        });
      }
      setIsPreferencesHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeActor.id, isAuthenticated, sandboxEngine]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const persisted = readPersistedInventory(activeActor.id);
      if (sandboxLoadedFromStorageRef.current) {
        setIsInventoryHydrated(true);
        return;
      }
      const persistedSoldIds = new Set(persisted.soldItemIds ?? []);
      const persistedQuantities = persisted.inventoryQuantities ?? {};
      if (persistedSoldIds.size > 0 || Object.keys(persistedQuantities).length > 0) {
        setItems((previous) => {
          const nextItems = previous.map((item) => {
          const rawQuantity = persistedQuantities[item.id];
          const hasQuantityOverride = typeof rawQuantity === 'number' && Number.isFinite(rawQuantity);
          if (!item.isSold && !persistedSoldIds.has(item.id) && !hasQuantityOverride) return item;
          const quantity = persistedSoldIds.has(item.id)
            ? 0
            : hasQuantityOverride
              ? Math.max(0, Math.floor(rawQuantity))
              : item.isSold
                ? 0
                : item.inventoryQuantity ?? 1;
          const isSold = quantity === 0;
          return {
            ...item,
            isSold,
            inventoryQuantity: quantity,
            reservedQuantity: item.reservedQuantity ?? 0,
            listingStatus: item.listingStatus,
          };
          });
          sandboxEngine.replacePersistedInventory(nextItems);
          return nextItems;
        });
      }
      setIsInventoryHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeActor.id, sandboxEngine]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isPreferencesHydrated) return;
    try {
      window.localStorage.setItem(scopedStorageKey(PREFERENCES_STORAGE_KEY, activeActor.id), JSON.stringify({
        likedItemIds: items.filter((item) => item.isLiked).map((item) => item.id),
        searchHistory,
        recentlyViewedIds,
        savedItemIds,
      } satisfies PersistedPreferences));
    } catch {
      // Storage can be unavailable in private browsing or embedded previews.
    }
  }, [activeActor.id, isPreferencesHydrated, items, searchHistory, recentlyViewedIds, savedItemIds]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isInventoryHydrated) return;
    try {
      window.localStorage.setItem(scopedStorageKey(INVENTORY_STORAGE_KEY, activeActor.id), JSON.stringify({
        soldItemIds: items.filter((item) => item.isSold).map((item) => item.id),
        inventoryQuantities: Object.fromEntries(items.map((item) => [item.id, item.inventoryQuantity ?? (item.isSold ? 0 : 1)])),
      } satisfies PersistedInventory));
    } catch {
      // Storage can be unavailable in private browsing or embedded previews.
    }
  }, [activeActor.id, isInventoryHydrated, items]);

  const bumpStateVersion = (patch: Partial<MercariAgentSnapshot> = {}) => {
    sandboxEngine.advanceViewState();
    stateVersionRef.current = sandboxEngine.getStateVersion();
    patchStateRef(patch);
    persistSandboxState();
    return stateVersionRef.current;
  };

  const addSearchHistory = (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;
    const nextSearchHistory = [normalizedQuery, ...(stateRef.current?.searchHistory ?? searchHistory).filter((item) => item !== normalizedQuery)].slice(0, 10);
    setSearchHistory(nextSearchHistory);
    patchStateRef({ searchHistory: nextSearchHistory });
  };
  const clearSearchHistory = () => {
    setSearchHistory([]);
    patchStateRef({ searchHistory: [] });
  };

  const openCategory = (category: string): ActionResult<undefined> => {
    const normalizedCategory = category.trim();
    if (!normalizedCategory) return failure('INVALID_INPUT', stateVersionRef.current, 'カテゴリを指定してください');
    setCategoryName(normalizedCategory);
    setMainTab('category');
    setIsSearchOpenState(false);
    setSelectedItemId(null);
    setBuyingItemId(null);
    setIsListingModalOpenState(false);
    setActiveNotificationId(null);
    return success(undefined, bumpStateVersion({
      currentMainTab: 'category',
      currentCategory: normalizedCategory,
      selectedItemId: null,
      buyingItemId: null,
    }));
  };

  const setLiked = (itemId: string, liked: boolean): ActionResult<undefined> => runUiCommand('setLiked', { itemId, liked }, () => {
    if (typeof itemId !== 'string' || typeof liked !== 'boolean') return failure('INVALID_INPUT', stateVersionRef.current, 'いいね入力の形式が不正です');
    if (!sandboxEngine.getCurrentActor().authenticated) {
      requestLogin('いいねするにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, 'いいねするにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (target.isLiked === liked) return success(undefined, stateVersionRef.current);
    const nextItems = (stateRef.current?.items ?? []).map((item) => item.id !== itemId ? item : ({
      ...item,
      isLiked: liked,
      likesCount: liked ? item.likesCount + 1 : Math.max(0, item.likesCount - 1),
    }));
    setItems(nextItems);
    sandboxEngine.replaceItems(nextItems);
    return success(undefined, bumpStateVersion({ items: nextItems }));
  });

  const setSaved = (itemId: string, saved: boolean): ActionResult<undefined> => runUiCommand('setSaved', { itemId, saved }, () => {
    if (typeof itemId !== 'string' || typeof saved !== 'boolean') return failure('INVALID_INPUT', stateVersionRef.current, '保存入力の形式が不正です');
    if (!sandboxEngine.getCurrentActor().authenticated) {
      requestLogin('商品を保存するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '商品を保存するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    const liveSavedItemIds = stateRef.current?.savedItemIds ?? savedItemIds;
    const alreadySaved = liveSavedItemIds.includes(itemId);
    if (alreadySaved === saved) return success(undefined, stateVersionRef.current);
    const nextSavedItemIds = saved ? [...liveSavedItemIds, itemId] : liveSavedItemIds.filter((id) => id !== itemId);
    setSavedItemIds(nextSavedItemIds);
    return success(undefined, bumpStateVersion({ savedItemIds: nextSavedItemIds }));
  });

  const toggleLikeItem = (itemId: string) => {
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (target) setLiked(itemId, !target.isLiked);
  };

  const openItem = (itemId: string): ActionResult<undefined> => runUiCommand('openItem', { itemId }, () => {
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    const nextItems = (stateRef.current?.items ?? []).map((item) => item.id === itemId ? {
      ...item,
      viewsCount: (item.viewsCount ?? 0) + 1,
      viewedAt: sandboxEngine.getNow(),
    } : item);
    sandboxEngine.replaceItems(nextItems);
    setItems(nextItems);
    setBuyingItemId(null);
    if (typeof window !== 'undefined') {
      const currentHistory = itemHistoryState();
      const origin: ItemRouteOrigin = currentHistory.furimaOrigin ?? itemRouteOriginRef.current ?? {
        mainTab,
        homeTab,
        categoryName,
        myPagePanel,
        isSearchOpen,
        searchQuery,
      };
      itemRouteOriginRef.current = origin;
      const itemHash = `${ITEM_ROUTE_PREFIX}${encodeURIComponent(itemId)}`;
      if (window.location.hash !== itemHash) {
        window.history.pushState({ ...(window.history.state ?? {}), furimaItemId: itemId, furimaOrigin: origin }, '', `${window.location.pathname}${window.location.search}${itemHash}`);
      }
    }
    setMyPagePanel(null);
    setSelectedItemId(itemId);
    const nextRecentlyViewedIds = [itemId, ...(stateRef.current?.recentlyViewedIds ?? recentlyViewedIds).filter((id) => id !== itemId)].slice(0, 12);
    setRecentlyViewedIds(nextRecentlyViewedIds);
    return success(undefined, bumpStateVersion({
      selectedItemId: itemId,
      buyingItemId: null,
      recentlyViewedIds: nextRecentlyViewedIds,
      items: nextItems,
    }));
  });
  const closeItem = (): ActionResult<undefined> => runUiCommand('closeItem', {}, () => {
    setSelectedItemId(null);
    patchStateRef({ selectedItemId: null });
    if (typeof window !== 'undefined' && readItemRoute()) {
      const historyState = itemHistoryState();
      if (historyState.furimaItemId && historyState.furimaOrigin) window.history.back();
      else replaceItemRoute();
      if (!historyState.furimaOrigin) restoreItemRouteOrigin();
    }
    return success(undefined, bumpStateVersion({ selectedItemId: null }));
  });

  const startPurchase = (itemId: string): ActionResult<StartPurchaseResult> => runUiCommand('startPurchase', { itemId }, () => {
    const result = sandboxEngine.startPurchase(itemId, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('購入・入札するにはログインが必要です。');
      return result;
    }
    setBuyingItemId(itemId);
    syncFromEngine();
    return result;
  });

  const purchaseItem = (itemId: string, pricing?: PurchasePricing): ActionResult<ConfirmPurchaseResult> => runUiCommand('purchaseItem', { itemId, pricing }, () => {
    const result = sandboxEngine.purchaseItemWithPricing(itemId, pricing, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('購入・入札するにはログインが必要です。');
      return result;
    }
    syncFromEngine();
    return result;
  });

  const placeBid = (itemId: string, amount: number): ActionResult<{ currentBid: number; bidsCount: number }> => runUiCommand('placeBid', { itemId, amount }, () => {
    const result = sandboxEngine.placeBid(itemId, amount, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('購入・入札するにはログインが必要です。');
      return result;
    }
    syncFromEngine();
    return result;
  });

  const getWallet = (): ActionResult<WalletSnapshot> => runUiCommand('getWallet', {}, () => sandboxEngine.getWallet({ actorId: activeActor.id }));
  const depositWallet = (amount: number): ActionResult<WalletSnapshot> => runUiCommand('depositWallet', { amount }, () => {
    const result = sandboxEngine.depositWallet(amount, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const withdrawWallet = (amount: number): ActionResult<WalletSnapshot> => runUiCommand('withdrawWallet', { amount }, () => {
    const result = sandboxEngine.withdrawWallet(amount, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const updateProfile = (input: Partial<ActorProfile>): ActionResult<ActorProfile> => runUiCommand('updateProfile', input, () => {
    const result = sandboxEngine.updateProfile(input, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const getFollowList = (direction: FollowDirection): ActionResult<FollowListResult> => sandboxEngine.getFollowList(direction, { actorId: activeActor.id });
  const getFollowSummary = (actorId?: string): ActionResult<FollowSummary> => sandboxEngine.getFollowSummary(actorId, { actorId: activeActor.id });
  const followUser = (actorId: string): ActionResult<FollowMutationResult> => runUiCommand('followUser', { actorId }, () => {
    const result = sandboxEngine.followUser(actorId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const unfollowUser = (actorId: string): ActionResult<FollowMutationResult> => runUiCommand('unfollowUser', { actorId }, () => {
    const result = sandboxEngine.unfollowUser(actorId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });

  const addNewItem = (newItemData: Partial<MercariItem>): ActionResult<MercariItem> => runUiCommand('listItem', newItemData, () => {
    const result = sandboxEngine.listItem(newItemData, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('出品を確定するにはログインが必要です。');
      return result;
    }
    setIsListingModalOpen(false);
    syncFromEngine();
    return result;
  });

  const createListingDraft = (draft: Partial<MercariItem>): ActionResult<{ draftId: string }> => runUiCommand('createListingDraft', draft, () => {
    const result = sandboxEngine.createListingDraft(draft, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });

  const updateListingDraft = (draftId: string, draft: Partial<MercariItem>): ActionResult<{ draftId: string }> => runUiCommand('updateListingDraft', { draftId, draft }, () => {
    const result = sandboxEngine.updateListingDraft(draftId, draft, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });

  const deleteListingDraft = (draftId: string): ActionResult<{ draftId: string }> => runUiCommand('deleteListingDraft', { draftId }, () => {
    const result = sandboxEngine.deleteListingDraft(draftId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });

  const submitListing = (draftId: string): ActionResult<{ itemId: string }> => runUiCommand('submitListing', { draftId }, () => {
    const result = sandboxEngine.submitListing(draftId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });

  const addComment = (itemId: string, text: string): ActionResult<undefined> => runUiCommand('addComment', { itemId, text }, () => {
    const actor = sandboxEngine.getCurrentActor();
    const result = sandboxEngine.addComment(itemId, text, { actorId: actor.id });
    if (!result.ok && result.error === 'AUTH_REQUIRED') {
      requestLogin('コメントするにはログインが必要です。');
    }
    if (result.ok) syncFromEngine();
    return result;
  });

  const openNotification = (notificationId: string) => {
    void runUiCommand('openNotification', { notificationId }, () => {
      if (!notifications.some((notification) => notification.id === notificationId)) return failure('ITEM_NOT_FOUND', stateVersionRef.current, 'お知らせが見つかりません');
      sandboxEngine.markNotificationRead(notificationId);
      const nextNotifications = notificationsForActor(sandboxEngine.getNotifications(), sandboxEngine.getCurrentActor());
      setNotifications(nextNotifications);
      patchStateRef({ sandbox: sandboxEngine.getSnapshot() });
      setActiveNotificationId(notificationId);
      return success(undefined, bumpStateVersion({ sandbox: sandboxEngine.getSnapshot() }));
    });
  };
  const setActiveNotification = (notification: NotificationItem | null) => notification ? openNotification(notification.id) : setActiveNotificationId(null);
  const setSelectedItem = (item: MercariItem | null) => item ? openItem(item.id) : closeItem();
  const setBuyingItem = (item: MercariItem | null) => item ? startPurchase(item.id) : setBuyingItemId(null);

  const getSnapshot = (): MercariAgentSnapshot => {
    const current = stateRef.current;
    const currentItems = sandboxEngine.getItems();
    return {
      version: '1',
      sandboxId: sandboxEngine.getSandboxId(),
      stateVersion: sandboxEngine.getStateVersion(),
      currentMainTab: current?.currentMainTab ?? mainTab,
      currentHomeTab: current?.currentHomeTab ?? homeTab,
      currentCategory: current?.currentCategory ?? categoryName,
      searchQuery: current?.searchQuery ?? searchQuery,
      selectedItemId: current?.selectedItemId ?? selectedItemId,
      buyingItemId: current?.buyingItemId ?? buyingItemId,
      searchHistory: [...(current?.searchHistory ?? searchHistory)],
      recentlyViewedIds: [...(current?.recentlyViewedIds ?? recentlyViewedIds)],
      savedItemIds: [...(current?.savedItemIds ?? savedItemIds)],
      items: currentItems,
      itemsCount: currentItems.length,
      inventoryMovements: sandboxEngine.getVisibleInventoryMovements().slice(-100),
      sandbox: sandboxEngine.getScopedSnapshot(),
    };
  };

  const durableKeyFor = (options: AgentActionOptions | undefined, operationId: string): string => options?.idempotencyKey ?? options?.requestId ?? options?.commandId ?? operationId;
  const parseDurableResult = <T,>(record: SandboxCommandRecord): ActionResult<T> | null => {
    try {
      const result = JSON.parse(record.result) as ActionResult<T>;
      return result && typeof result === 'object' && typeof result.stateVersion === 'number' ? result : null;
    } catch {
      return null;
    }
  };
  const persistAgentCommand = <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, result: ActionResult<T>, stateVersionBefore: number, rollbackState?: string) => {
    if (READ_COMMANDS.has(action)) return;
    if (typeof window !== 'undefined' && persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const metadata = result.meta;
    if (!metadata) return;
    const createdAt = new Date().toISOString();
    const record: SandboxCommandRecord = {
      operationId: metadata.operationId,
      sandboxId: metadata.sandboxId,
      actorId: metadata.actorId,
      command: action,
      mode: metadata.mode,
      idempotencyKey: durableKeyFor(options, metadata.operationId),
      ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
      ...(metadata.commandId ? { commandId: metadata.commandId } : {}),
      payloadHash: fingerprint({ sandboxId: metadata.sandboxId, actorId: metadata.actorId, command: action, mode: metadata.mode, payload: compactImagePayloadForFingerprint(payload) }) ?? 'invalid-payload',
      stateVersionBefore,
      stateVersionAfter: result.stateVersion,
      status: result.ok ? 'SUCCEEDED' : 'FAILED',
      result: durableCommandResult(result),
      createdAt,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    durableCommandCacheRef.current.set(record.idempotencyKey ?? record.operationId, record);
    const previewId = action === 'commitPreview' && payload && typeof payload === 'object' && typeof (payload as { previewId?: unknown }).previewId === 'string'
      ? String((payload as unknown as { previewId: string }).previewId)
      : undefined;
    const state = sandboxStateRecord(createdAt);
    localPersistChainRef.current = localPersistChainRef.current.then(async () => {
      const expectedStateVersion = localPersistedStateVersionRef.current ?? stateVersionBefore;
      const pendingPreview = result.ok && result.data && typeof result.data === 'object' && typeof (result.data as { previewId?: unknown }).previewId === 'string'
        ? pendingPreviewRecordsRef.current.get(String((result.data as unknown as { previewId: string }).previewId))
        : undefined;
      const write = pendingPreview
        ? await browserSandboxStore.putPreviewAndCommand(pendingPreview, record, state, expectedStateVersion)
        : await browserSandboxStore.commitCommand(record, state, expectedStateVersion, previewId);
      if (write.ok) {
        if (pendingPreview) pendingPreviewRecordsRef.current.delete(pendingPreview.previewId);
        localPersistedStateVersionRef.current = state.stateVersion;
        if (write.durability === 'volatile') {
          window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), localPersistenceError: browserSandboxStore.getDiagnostics().fallbackReason ?? 'UNAVAILABLE' };
        }
        return;
      }
      durableCommandCacheRef.current.delete(record.idempotencyKey ?? record.operationId);
      window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), localPersistenceError: write.error === 'CONFLICT' ? 'CORRUPTED' : 'UNAVAILABLE' };
      if (result.ok && rollbackState && sandboxEngine.getStateVersion() === result.stateVersion) {
        const restored = sandboxEngine.importState(rollbackState, SANDBOX_CONTROL_OPTIONS);
        if (restored.ok) syncFromEngine();
      }
    }).catch(() => {
      durableCommandCacheRef.current.delete(record.idempotencyKey ?? record.operationId);
      browserSandboxStore.recordFailure('UNAVAILABLE');
      window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), localPersistenceError: 'UNAVAILABLE' };
      if (result.ok && rollbackState && sandboxEngine.getStateVersion() === result.stateVersion) {
        const restored = sandboxEngine.importState(rollbackState, SANDBOX_CONTROL_OPTIONS);
        if (restored.ok) syncFromEngine();
      }
    });
  };

  const runAgentAction = <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, operation: () => ActionResult<T>): ActionResult<T> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。waitForReady()完了後に実行してください。');
    const context = { sandboxId: sandboxEngine.getSandboxId(), actorId: options?.actorId ?? sandboxEngine.getCurrentActor().id, stateVersion: sandboxEngine.getStateVersion() };
    const mode = options?.mode ?? 'commit';
    const explicitKey = options?.idempotencyKey ?? options?.requestId ?? options?.commandId;
    if (explicitKey) {
      const payloadHash = fingerprint({ sandboxId: context.sandboxId, actorId: context.actorId, command: action, mode, payload: compactImagePayloadForFingerprint(payload) });
      const existing = durableCommandCacheRef.current.get(explicitKey);
      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.command !== action || existing.mode !== mode) return failure('IDEMPOTENCY_CONFLICT', sandboxEngine.getStateVersion(), '同じ冪等キーで異なるpayloadを再利用できません');
        return parseDurableResult<T>(existing) ?? failure('INVALID_STATE', sandboxEngine.getStateVersion(), '保存済みcommand結果を読み込めません');
      }
    }
    const stateVersionBefore = sandboxEngine.getStateVersion();
    const rollbackState = sandboxEngine.exportState();
    // IDEMPOTENCY_CONFLICT is produced by the shared Command Bus for same-tab
    // requests; the durable cache above covers reloads and a new Worker.
    let result: ActionResult<T>;
    agentExecutionDepthRef.current += 1;
    try {
      result = commandBus.execute(action, payload, options, operation);
    } finally {
      agentExecutionDepthRef.current -= 1;
    }
    persistAgentCommand(action, payload, options, result, stateVersionBefore, rollbackState);
    return result;
  };

  const createPreviewEngine = (): SandboxEngine | null => {
    const snapshot = sandboxEngine.getSnapshot();
    const previewEngine = new SandboxEngine(sandboxEngine.getItems(), {
      sandboxId: sandboxEngine.getSandboxId(),
      seed: snapshot.seed,
      now: snapshot.now,
      notifications: sandboxEngine.getNotifications(),
    });
    const imported = previewEngine.importState(sandboxEngine.exportState(), SANDBOX_CONTROL_OPTIONS);
    return imported.ok ? previewEngine : null;
  };

  const previewAction = (command: PreviewCommand, payload: unknown, options?: AgentActionOptions): ActionResult<ActionPreview> => runAgentAction(`preview:${command}`, payload, { ...options, mode: 'preview' }, () => {
    const actorId = options?.actorId ?? sandboxEngine.getCurrentActor().id;
    const previewEngine = createPreviewEngine();
    if (!previewEngine) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), 'Sandbox previewを作成できませんでした');
    const previewResult = applyPreviewOperation(previewEngine, command, payload, { ...options, actorId });
    if (!previewResult.ok) return previewResult as ActionResult<ActionPreview>;
    const summary = previewResult.data && typeof previewResult.data === 'object'
      ? { command, ...(previewResult.data as Record<string, unknown>) }
      : { command, result: previewResult.data };
    const now = sandboxEngine.getNow();
    const previewId = `preview-${sandboxEngine.getSandboxId()}-${++previewCounterRef.current}`;
    const expiresAt = new Date(Date.parse(now) + 10 * 60 * 1000).toISOString();
    previewCacheRef.current.set(previewId, { command, payload, actorId, sandboxId: sandboxEngine.getSandboxId(), stateVersion: sandboxEngine.getStateVersion(), expiresAt: Date.parse(expiresAt), summary });
    const previewRecord: SandboxPreviewRecord = {
      previewId,
      sandboxId: sandboxEngine.getSandboxId(),
      actorId,
      command,
      payload: JSON.stringify(compactImagePayloadForFingerprint(payload)),
      payloadHash: fingerprint({ sandboxId: sandboxEngine.getSandboxId(), actorId, command: `preview:${command}`, mode: 'preview', payload: compactImagePayloadForFingerprint(payload) }) ?? 'invalid-payload',
      baseStateVersion: sandboxEngine.getStateVersion(),
      summary: JSON.stringify(summary),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      virtualExpiresAt: expiresAt,
      retentionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    pendingPreviewRecordsRef.current.set(previewId, previewRecord);
    return success({ previewId, command, payload, createdAt: now, expiresAt, stateVersion: sandboxEngine.getStateVersion(), sandboxId: sandboxEngine.getSandboxId(), actorId, summary }, sandboxEngine.getStateVersion());
  });

  const commitPreview = (previewId: string, options?: AgentActionOptions): ActionResult<unknown> => runAgentAction('commitPreview', { previewId }, { ...options, mode: 'commit' }, () => {
    const record = previewCacheRef.current.get(previewId);
    if (!record) return failure('PREVIEW_NOT_FOUND', sandboxEngine.getStateVersion(), 'previewが見つかりません');
    if (record.expiresAt <= Date.parse(sandboxEngine.getNow())) {
      previewCacheRef.current.delete(previewId);
      return failure('PREVIEW_EXPIRED', sandboxEngine.getStateVersion(), 'previewの有効期限が切れています');
    }
    const actorId = options?.actorId ?? sandboxEngine.getCurrentActor().id;
    if (record.sandboxId !== sandboxEngine.getSandboxId() || record.actorId !== actorId) return failure('FORBIDDEN', sandboxEngine.getStateVersion(), 'previewを作成したSandbox actorだけが確定できます');
    if (record.stateVersion !== sandboxEngine.getStateVersion()) return failure('STATE_CONFLICT', sandboxEngine.getStateVersion(), 'preview作成後にSandbox状態が変化しています', { previewStateVersion: record.stateVersion, actualStateVersion: sandboxEngine.getStateVersion() });
    const commitOptions = { ...options, actorId, expectedStateVersion: undefined };
    const working = createPreviewEngine();
    if (!working) return failure('INVALID_STATE', sandboxEngine.getStateVersion(), 'Sandbox previewの確定コピーを作成できませんでした');
    const result = applyPreviewOperation(working, record.command, record.payload, commitOptions);
    if (result.ok) {
      const imported = sandboxEngine.importState(working.exportState(), SANDBOX_CONTROL_OPTIONS);
      if (!imported.ok) return failure('INVALID_STATE', sandboxEngine.getStateVersion(), 'Sandbox previewを確定できませんでした');
      previewCacheRef.current.delete(previewId);
      syncFromEngine();
    }
    return result;
  });

  const searchItems = (query: string) => {
    if (typeof query !== 'string' || query.length > 500) return [];
    if (sandboxEngine.getSnapshot().scenarioId === 'zero_search_results') return [];
    return searchCatalogItems(sandboxEngine.getItems(), query).map(cloneItem);
  };

  // Keep the public bridge identity stable while allowing its handlers to
  // follow the latest render. Agents can safely retain the object across a
  // React update without calling closures from the initial render.
  const latestAgentApiRef = useRef<MercariAgentAPI | null>(null);
  const stableAgentApiRef = useRef<MercariAgentAPI | null>(null);
  const stableCatalogRef = useRef<MercariAgentAPI['catalog'] | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const apiDefinition: MercariAgentAPI = {
      waitForReady,
      navigateTab: (tab, options) => runAgentAction('navigateTab', { tab }, options, () => {
        if (!isMainTabValue(tab)) return failure('INVALID_TAB', sandboxEngine.getStateVersion(), '無効なタブです');
        navigateToTab(tab);
        return success(undefined, bumpStateVersion());
      }),
      navigateHomeSubTab: (tab, options) => runAgentAction('navigateHomeSubTab', { tab }, options, () => {
        if (!isHomeTabValue(tab)) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '無効なホームサブタブです');
        navigateToTab('home');
        setHomeTab(tab);
        return success(undefined, bumpStateVersion());
      }),
      navigateCategory: (category, options) => runAgentAction('navigateCategory', { category }, options, () => {
        if (typeof category !== 'string' || !category.trim()) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), 'カテゴリを指定してください');
        return openCategory(category);
      }),
      search: (query, options) => runAgentAction('search', { query }, options, () => {
        if (typeof query !== 'string') return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '検索語は文字列で指定してください');
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return failure('INVALID_INPUT', stateVersionRef.current);
        if (sandboxEngine.getSnapshot().scenarioId === 'zero_search_results') return failure('NO_RESULTS', sandboxEngine.getStateVersion(), 'このシナリオでは検索結果が0件になります');
        setIsSearchOpen(true);
        setSearchQuery(normalizedQuery);
        addSearchHistory(normalizedQuery);
        return success(undefined, bumpStateVersion({ searchQuery: normalizedQuery, selectedItemId: null, buyingItemId: null }));
      }),
      openItem: (itemId, options) => runAgentAction('openItem', { itemId }, options, () => typeof itemId === 'string' && itemId.trim() ? openItem(itemId) : failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '商品IDを指定してください')),
      closeItem: (options) => runAgentAction('closeItem', {}, options, () => closeItem()),
      setLiked: (itemId, liked, options) => runAgentAction('setLiked', { itemId, liked }, options, () => setLiked(itemId, liked)),
      likeItem: (itemId, options) => runAgentAction('likeItem', { itemId, liked: true }, options, () => setLiked(itemId, true)),
      setSaved: (itemId, saved, options) => runAgentAction('setSaved', { itemId, saved }, options, () => setSaved(itemId, saved)),
      addComment: (itemId, text, options) => runAgentAction('addComment', { itemId, text }, options, () => addComment(itemId, text)),
      listItem: (item, options) => runAgentAction('listItem', item, options, () => { const result = sandboxEngine.listItem(item, options); if (result.ok) syncFromEngine(); return result; }),
      createListingDraft: (item, options) => runAgentAction('createListingDraft', item, options, () => { const result = sandboxEngine.createListingDraft(item, options); if (result.ok) syncFromEngine(); return result; }),
      updateListingDraft: (draftId, item, options) => runAgentAction('updateListingDraft', { draftId, item }, options, () => { const result = sandboxEngine.updateListingDraft(draftId, item, options); if (result.ok) syncFromEngine(); return result; }),
      getListingDrafts: (options) => runAgentAction('getListingDrafts', {}, options, () => success(sandboxEngine.getListingDrafts(options?.actorId), sandboxEngine.getStateVersion())),
      saveListingDraft: (item: SaveListingDraftInput, options) => runAgentAction('saveListingDraft', item, options, () => {
        if (!item || typeof item !== 'object') return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '出品下書きの形式が不正です');
        const { draftId, ...fields } = item;
        const result = draftId ? sandboxEngine.updateListingDraft(draftId, fields, options) : sandboxEngine.createListingDraft(fields, options);
        if (result.ok) syncFromEngine();
        return result;
      }),
      deleteListingDraft: (draftId, options) => runAgentAction('deleteListingDraft', { draftId }, options, () => { const result = sandboxEngine.deleteListingDraft(draftId, options); if (result.ok) syncFromEngine(); return result; }),
      submitListing: (draftId, options) => runAgentAction('submitListing', { draftId }, options, () => { const result = sandboxEngine.submitListing(draftId, options); if (result.ok) syncFromEngine(); return result; }),
      startPurchase: (itemId, options) => runAgentAction('startPurchase', { itemId }, options, () => { const result = sandboxEngine.startPurchase(itemId, options); if (result.ok) { setBuyingItemId(itemId); syncFromEngine(); } return result; }),
      confirmPurchase: (purchaseIntentId, options) => runAgentAction('confirmPurchase', { purchaseIntentId }, options, () => { const result = sandboxEngine.confirmPurchase(purchaseIntentId, options); if (result.ok) syncFromEngine(); return result; }),
      placeBid: (itemId, amount, options) => runAgentAction('placeBid', { itemId, amount }, options, () => { const result = sandboxEngine.placeBid(itemId, amount, options); if (result.ok) syncFromEngine(); return result; }),
      closeAuction: (itemId, options) => runAgentAction('closeAuction', { itemId }, options, () => { const result = sandboxEngine.closeAuction(itemId, SANDBOX_CONTROL_OPTIONS); if (result.ok) syncFromEngine(); return result; }),
      buyItem: (itemId, options) => runAgentAction('buyItem', { itemId }, options, () => { const result = sandboxEngine.startPurchase(itemId, options); if (result.ok) { setBuyingItemId(itemId); syncFromEngine(); } return result; }),
      shipOrder: (transactionId, options) => runAgentAction('shipOrder', { transactionId }, options, () => { const result = sandboxEngine.shipOrder(transactionId, options); if (result.ok) syncFromEngine(); return result; }),
      markDelivered: (transactionId, options) => runAgentAction('markDelivered', { transactionId }, options, () => { const result = sandboxEngine.markDelivered(transactionId, options); if (result.ok) syncFromEngine(); return result; }),
      reviewOrder: (transactionId, rating, comment, options) => runAgentAction('reviewOrder', { transactionId, rating, comment }, options, () => { const result = sandboxEngine.reviewOrder(transactionId, rating, comment, options); if (result.ok) syncFromEngine(); return result; }),
      cancelOrder: (transactionId, reason, options) => runAgentAction('cancelOrder', { transactionId, reason }, options, () => { const result = sandboxEngine.cancelOrder(transactionId, reason, options); if (result.ok) syncFromEngine(); return result; }),
      resolveCancellation: (transactionId, approve, options) => runAgentAction('resolveCancellation', { transactionId, approve }, options, () => { const result = sandboxEngine.resolveCancellation(transactionId, approve, options); if (result.ok) syncFromEngine(); return result; }),
      reviewListing: (itemId, approve, options) => runAgentAction('reviewListing', { itemId, approve }, options, () => { const result = sandboxEngine.reviewListing(itemId, approve, options); if (result.ok) syncFromEngine(); return result; }),
      requestReturn: (transactionId, reason, options) => runAgentAction('requestReturn', { transactionId, reason }, options, () => { const result = sandboxEngine.requestReturn(transactionId, reason, options); if (result.ok) syncFromEngine(); return result; }),
      confirmReturnReceived: (transactionId, options) => runAgentAction('confirmReturnReceived', { transactionId }, options, () => { const result = sandboxEngine.confirmReturnReceived(transactionId, options); if (result.ok) syncFromEngine(); return result; }),
      sendTransactionMessage: (transactionId, body, options) => runAgentAction('sendTransactionMessage', { transactionId, body }, options, () => { const result = sandboxEngine.sendTransactionMessage(transactionId, body, options); if (result.ok) syncFromEngine(); return result; }),
      createSupportTicket: (input, options) => runAgentAction('createSupportTicket', input, options, () => { const result = sandboxEngine.createSupportTicket(input, options); if (result.ok) syncFromEngine(); return result; }),
      reportTransaction: (transactionId, body, options) => runAgentAction('reportTransaction', { transactionId, body }, options, () => { const result = sandboxEngine.reportTransaction(transactionId, body, options); if (result.ok) syncFromEngine(); return result; }),
      updateListing: (itemId, input, options) => runAgentAction('updateListing', { itemId, input }, options, () => { const result = sandboxEngine.updateListing(itemId, input, options); if (result.ok) syncFromEngine(); return result; }),
      pauseListing: (itemId, options) => runAgentAction('pauseListing', { itemId }, options, () => { const result = sandboxEngine.pauseListing(itemId, options); if (result.ok) syncFromEngine(); return result; }),
      resumeListing: (itemId, options) => runAgentAction('resumeListing', { itemId }, options, () => { const result = sandboxEngine.resumeListing(itemId, options); if (result.ok) syncFromEngine(); return result; }),
      relistItem: (itemId, options) => runAgentAction('relistItem', { itemId }, options, () => { const result = sandboxEngine.relistItem(itemId, options); if (result.ok) syncFromEngine(); return result; }),
      listOwnListings: (options) => runAgentAction('listOwnListings', {}, options, () => {
        const actor = sandboxEngine.getSnapshot().actors.find((candidate) => candidate.id === (options?.actorId ?? sandboxEngine.getCurrentActor().id));
        if (!actor?.authenticated) return failure('AUTH_REQUIRED', sandboxEngine.getStateVersion());
        if (actor.role !== 'seller' && actor.role !== 'admin' && actor.role !== 'platform') return failure('FORBIDDEN', sandboxEngine.getStateVersion(), '自分の出品一覧を取得できるのはsellerまたは運営です');
        return success(sandboxEngine.getItems().filter((item) => actor.role === 'admin' || actor.role === 'platform' || item.sellerId === actor.id), sandboxEngine.getStateVersion());
      }),
      catalog: {
        list: (input: CatalogListInput = {}, options) => runAgentAction('catalog.list', input, options, () => {
          const offset = Number.isInteger(input.offset) && (input.offset ?? 0) >= 0 ? input.offset ?? 0 : 0;
          const limit = Number.isInteger(input.limit) && (input.limit ?? 24) > 0 ? Math.min(input.limit ?? 24, 40) : 24;
          const query = input.query?.trim().toLocaleLowerCase('ja-JP') ?? '';
          const category = input.category?.trim() ?? '';
          const filtered = sandboxEngine.getItems().filter((item) => {
            const haystack = `${item.title} ${item.description} ${item.category.join(' ')} ${item.brand ?? ''}`.toLocaleLowerCase('ja-JP');
            return (!query || haystack.includes(query)) && (!category || item.category.includes(category));
          });
          const result: CatalogListResult = { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, stateVersion: sandboxEngine.getStateVersion() };
          return success(result, sandboxEngine.getStateVersion());
        }),
        get: (itemId, options) => runAgentAction('catalog.get', { itemId }, options, () => {
          const item = sandboxEngine.getItem(itemId);
          return item ? success(item, sandboxEngine.getStateVersion()) : failure('ITEM_NOT_FOUND', sandboxEngine.getStateVersion());
        }),
      },
      switchActor: (actorId) => runAgentAction('switchActor', { actorId }, SANDBOX_CONTROL_OPTIONS, () => { const result = sandboxEngine.switchActor(actorId, SANDBOX_CONTROL_OPTIONS); if (result.ok) { setActiveActorId(actorId); syncFromEngine(); } return result; }),
      loadScenario: (scenarioId) => runAgentAction('loadScenario', { scenarioId }, SANDBOX_CONTROL_OPTIONS, () => { const result = sandboxEngine.loadScenario(scenarioId, SANDBOX_CONTROL_OPTIONS); if (result.ok) { setActiveActorId(sandboxEngine.getCurrentActor().id); setMainTab('home'); setHomeTab('recommend'); setCategoryName(null); setIsSearchOpenState(false); setSelectedItemId(null); setBuyingItemId(null); setSearchQuery(''); setSearchHistory([...INITIAL_SEARCH_HISTORY]); setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]); setSavedItemIds([]); setActiveNotificationId(null); syncFromEngine(); } return result; }),
      advanceClock: (milliseconds) => runAgentAction('advanceClock', { milliseconds }, SANDBOX_CONTROL_OPTIONS, () => { const result = sandboxEngine.advanceClock(milliseconds, SANDBOX_CONTROL_OPTIONS); if (result.ok) syncFromEngine(); return result; }),
      injectFailure: (failureName) => runAgentAction('injectFailure', { failure: failureName }, SANDBOX_CONTROL_OPTIONS, () => { const result = sandboxEngine.injectFailure(failureName, SANDBOX_CONTROL_OPTIONS); if (result.ok) syncFromEngine(); return result; }),
      getCapabilities: () => sandboxEngine.getCapabilities(),
      getSandboxSnapshot: () => sandboxEngine.getScopedSnapshot(),
      getTransactions: (actorId) => sandboxEngine.getVisibleTransactions(actorId),
      getDomainEvents: () => sandboxEngine.getVisibleDomainEvents(),
       exportState: () => runAgentAction('exportState', {}, SANDBOX_CONTROL_OPTIONS, () => {
         const actor = sandboxEngine.getSnapshot().actors.find((candidate) => candidate.id === SANDBOX_CONTROL_PRINCIPAL.actorId);
         if (!actor || (actor.role !== 'admin' && actor.role !== 'platform')) return failure('FORBIDDEN', sandboxEngine.getStateVersion(), 'Sandbox stateのバックアップはadmin/platformのsandbox-control scopeからのみ実行できます');
          return success(stripImagePayloadsForPersistence(sandboxEngine.exportState()), sandboxEngine.getStateVersion());
       }),
       importState: (serialized) => runAgentAction('importState', {
         serializedType: typeof serialized,
         serializedLength: typeof serialized === 'string' ? serialized.length : 0,
         serializedDigest: typeof serialized === 'string' ? digestText(serialized) : null,
       }, SANDBOX_CONTROL_OPTIONS, () => { const result = sandboxEngine.importState(serialized, SANDBOX_CONTROL_OPTIONS); if (result.ok) syncFromEngine(); return result; }),
      getSnapshot,
      getItems: () => sandboxEngine.getItems(),
      getItem: (itemId) => { if (typeof itemId !== 'string' || itemId.length > 200) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '商品IDの形式が不正です'); const item = sandboxEngine.getItem(itemId); return item ? success(item, sandboxEngine.getStateVersion()) : failure('ITEM_NOT_FOUND', sandboxEngine.getStateVersion()); },
      searchItems,
      getState: getSnapshot,
      getActionTrace: () => commandBus.getTrace(),
       getInventoryMovements: (itemId, options) => {
         const currentActor = sandboxEngine.getCurrentActor();
         const isTrustedControl = Boolean(options?.principal && options.principal === SANDBOX_CONTROL_PRINCIPAL);
         const requestedActorId = isTrustedControl ? options?.targetActorId ?? options?.actorId ?? currentActor.id : currentActor.id;
         if (requestedActorId !== currentActor.id && !isTrustedControl) return [];
         const requestedActor = sandboxEngine.getSnapshot().actors.find((actor) => actor.id === requestedActorId);
         if (isTrustedControl && requestedActor && (requestedActor.role === 'admin' || requestedActor.role === 'platform')) return sandboxEngine.getInventoryMovements(itemId);
         return sandboxEngine.getVisibleInventoryMovements(requestedActorId, itemId);
       },
      getProfile: (actorId) => {
        const viewer = sandboxEngine.getCurrentActor();
        const targetId = actorId ?? viewer.id;
        if (targetId !== viewer.id && viewer.role !== 'admin' && viewer.role !== 'platform') return undefined;
        return sandboxEngine.getProfile(targetId);
      },
      updateProfile: (input, options) => runAgentAction('updateProfile', input, options, () => { const result = sandboxEngine.updateProfile(input, options); if (result.ok) syncFromEngine(); return result; }),
      getFollowList: (direction, options) => runAgentAction('getFollowList', { direction }, options, () => sandboxEngine.getFollowList(direction, options)),
      getFollowSummary: (actorId, options) => runAgentAction('getFollowSummary', { actorId }, options, () => sandboxEngine.getFollowSummary(actorId, options)),
      followUser: (actorId, options) => runAgentAction('followUser', { actorId }, options, () => { const result = sandboxEngine.followUser(actorId, options); if (result.ok) syncFromEngine(); return result; }),
      unfollowUser: (actorId, options) => runAgentAction('unfollowUser', { actorId }, options, () => { const result = sandboxEngine.unfollowUser(actorId, options); if (result.ok) syncFromEngine(); return result; }),
      getWallet: (options) => runAgentAction('getWallet', {}, options, () => sandboxEngine.getWallet(options)),
      depositWallet: (amount, options) => runAgentAction('depositWallet', { amount }, options, () => { const result = sandboxEngine.depositWallet(amount, options); if (result.ok) syncFromEngine(); return result; }),
      withdrawWallet: (amount, options) => runAgentAction('withdrawWallet', { amount }, options, () => { const result = sandboxEngine.withdrawWallet(amount, options); if (result.ok) syncFromEngine(); return result; }),
      previewAction,
      commitPreview,
      resetScenario: (options) => runAgentAction('resetScenario', {}, SANDBOX_CONTROL_OPTIONS, () => {
        const scenarioId = (options as AgentActionOptions & { scenarioId?: ScenarioId } | undefined)?.scenarioId ?? 'catalog_default';
        const result = sandboxEngine.resetScenario({ ...SANDBOX_CONTROL_OPTIONS, scenarioId });
        if (!result.ok) return result;
        setActiveActorId(sandboxEngine.getCurrentActor().id);
        setMainTab('home');
        setHomeTab('recommend');
        setCategoryName(null);
        setIsSearchOpenState(false);
        setSearchQuery('');
        setSearchHistory([...INITIAL_SEARCH_HISTORY]);
        setActiveNotificationId(null);
        setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]);
        setSavedItemIds([]);
        setSelectedItemId(null);
        setBuyingItemId(null);
        listingDraftsRef.current.clear();
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(INVENTORY_STORAGE_KEY);
          window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
          window.localStorage.removeItem(scopedStorageKey(INVENTORY_STORAGE_KEY, sandboxEngine.getCurrentActor().id));
          window.localStorage.removeItem(scopedStorageKey(PREFERENCES_STORAGE_KEY, sandboxEngine.getCurrentActor().id));
          window.localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
        }
        commandBus.clear();
        durableCommandCacheRef.current.clear();
        localPersistedStateVersionRef.current = null;
        localPersistChainRef.current = localPersistChainRef.current.then(() => browserSandboxStore.clear(REMOTE_SANDBOX_STATE_ID)).catch(() => undefined);
        previewCacheRef.current.clear();
        pendingPreviewRecordsRef.current.clear();
        previewCounterRef.current = 0;
        syncFromEngine();
        return success(undefined, result.stateVersion);
      }),
      subscribe: (handler) => sandboxEngine.subscribe(handler),
    };
    latestAgentApiRef.current = apiDefinition;
    if (!stableCatalogRef.current) {
      stableCatalogRef.current = {
        list: (...args) => latestAgentApiRef.current?.catalog.list(...args) ?? failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています'),
        get: (...args) => latestAgentApiRef.current?.catalog.get(...args) ?? failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています'),
      };
    }
    if (!stableAgentApiRef.current) {
      stableAgentApiRef.current = new Proxy({} as MercariAgentAPI, {
        get: (_target, property: string | symbol) => {
          if (property === 'catalog') return stableCatalogRef.current;
          if (typeof property !== 'string') return undefined;
          const current = latestAgentApiRef.current;
          return current?.[property as keyof MercariAgentAPI];
        },
      });
    }
    const api = stableAgentApiRef.current;
    window.__SHOP_API__ = api;
    window.__MERCARI_API__ = api;
    // This effect refreshes the latest bridge closure; the stable Proxy above
    // prevents callers from retaining an obsolete object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeActorId, activeNotificationId, buyingItemId, categoryName, homeTab, isAuthenticated, isDeviceFrame, isInventoryHydrated, isLoginPromptOpen, isPreferencesHydrated, isSandboxReady, items, mainTab, myPagePanel, notifications, profile, recentlyViewedIds, savedItemIds, searchHistory, searchQuery, selectedItemId, sandboxEngine, user, wallet]);

  useEffect(() => () => {
    latestAgentApiRef.current = null;
    if (typeof window !== 'undefined' && window.__SHOP_API__ === stableAgentApiRef.current) delete window.__SHOP_API__;
    if (typeof window !== 'undefined' && window.__MERCARI_API__ === stableAgentApiRef.current) delete window.__MERCARI_API__;
  }, []);

  const updateListing = (itemId: string, input: Partial<MercariItem>) => runUiCommand('updateListing', { itemId, input }, () => {
    const result = sandboxEngine.updateListing(itemId, input, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const pauseListing = (itemId: string) => runUiCommand('pauseListing', { itemId }, () => {
    const result = sandboxEngine.pauseListing(itemId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const resumeListing = (itemId: string) => runUiCommand('resumeListing', { itemId }, () => {
    const result = sandboxEngine.resumeListing(itemId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const relistItem = (itemId: string) => runUiCommand('relistItem', { itemId }, () => {
    const result = sandboxEngine.relistItem(itemId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const runUiControlCommand = <T,>(command: string, payload: unknown, operation: () => ActionResult<T>): ActionResult<T> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。準備完了後にもう一度お試しください。');
    const stateVersionBefore = sandboxEngine.getStateVersion();
    const result = commandBus.execute(command, payload, SANDBOX_CONTROL_OPTIONS, operation);
    persistAgentCommand(command, payload, SANDBOX_CONTROL_OPTIONS, result, stateVersionBefore);
    return result;
  };

  const switchActor = (actorId: string) => runUiControlCommand('switchActor', { actorId }, () => {
    const result = sandboxEngine.switchActor(actorId, SANDBOX_CONTROL_OPTIONS);
    if (result.ok) {
      setActiveActorId(actorId);
      syncFromEngine();
    }
    return result;
  });
  const loadScenario = (scenarioId: ScenarioId) => runUiControlCommand('loadScenario', { scenarioId }, () => {
    const result = sandboxEngine.loadScenario(scenarioId, SANDBOX_CONTROL_OPTIONS);
    if (result.ok) {
      setActiveActorId(sandboxEngine.getCurrentActor().id);
      setMainTab('home');
      setHomeTab('recommend');
      setCategoryName(null);
      setIsSearchOpenState(false);
      setSearchQuery('');
      setSelectedItemId(null);
      setBuyingItemId(null);
      setActiveNotificationId(null);
      setSearchHistory([...INITIAL_SEARCH_HISTORY]);
      setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]);
      setSavedItemIds([]);
      syncFromEngine();
    }
    return result;
  });
  const advanceClock = (milliseconds: number) => runUiControlCommand('advanceClock', { milliseconds }, () => {
    const result = sandboxEngine.advanceClock(milliseconds, SANDBOX_CONTROL_OPTIONS);
    if (result.ok) syncFromEngine();
    return result;
  });
  const shipOrder = (transactionId: string) => runUiCommand('shipOrder', { transactionId }, () => {
    const result = sandboxEngine.shipOrder(transactionId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const markDelivered = (transactionId: string) => runUiCommand('markDelivered', { transactionId }, () => {
    const result = sandboxEngine.markDelivered(transactionId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const reviewOrder = (transactionId: string, rating: 1 | 2 | 3 | 4 | 5, comment?: string) => runUiCommand('reviewOrder', { transactionId, rating, comment }, () => {
    const result = sandboxEngine.reviewOrder(transactionId, rating, comment, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });
  const cancelOrder = (transactionId: string, reason: string) => runUiCommand('cancelOrder', { transactionId, reason }, () => {
    const result = sandboxEngine.cancelOrder(transactionId, reason, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  });

    return <MercariContext.Provider value={{ isAuthenticated, activeActor, sandboxSnapshot: liveSnapshot, isSandboxReady, isLoginPromptOpen, loginPromptReason, requestLogin, closeLoginPrompt, mainTab, setMainTab, myPagePanel, setMyPagePanel, openMyPagePanel, homeTab, setHomeTab, navigateToTab, categoryName, setCategoryName, openCategory, isSearchOpen, setIsSearchOpen, searchQuery, setSearchQuery, searchHistory, addSearchHistory, clearSearchHistory, selectedItemId, setSelectedItemId, selectedItem, setSelectedItem, openItem, closeItem, buyingItemId, setBuyingItemId, buyingItem, setBuyingItem, startPurchase, purchaseItem, placeBid, isPurchaseCompleteOpen, setIsPurchaseCompleteOpen, isListingModalOpen, setIsListingModalOpen, items, toggleLikeItem, setLiked, setSaved, addNewItem, createListingDraft, updateListingDraft, getListingDrafts: () => sandboxEngine.getListingDrafts(activeActor.id), deleteListingDraft, submitListing, updateListing, pauseListing, resumeListing, relistItem, addComment, recentlyViewedIds, savedItemIds, user, profile, wallet, getWallet, depositWallet, withdrawWallet, updateProfile, getFollowList, getFollowSummary, followUser, unfollowUser, notifications, activeNotification, openNotification, setActiveNotification, isDeviceFrame, setIsDeviceFrame, switchActor, loadScenario, advanceClock, getTransactions: (actorId) => sandboxEngine.getVisibleTransactions(actorId), getDomainEvents: () => sandboxEngine.getVisibleDomainEvents(), shipOrder, markDelivered, reviewOrder, cancelOrder }}>{children}</MercariContext.Provider>;
};

export const useMercari = () => {
  const context = useContext(MercariContext);
  if (!context) throw new Error('useMercari must be used within a MercariProvider');
  return context;
};
