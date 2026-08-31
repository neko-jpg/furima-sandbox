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
  TransactionRecord,
  UserProfile,
  WalletSnapshot,
} from '../types/mercari';
import { CATALOG_ITEMS } from '../data/catalogData';
import { INITIAL_NOTIFICATIONS, INITIAL_USER } from '../data/initialData';
import { searchCatalogItems } from '../components/searchUtils';
import { SandboxEngine, createTrustedPrincipal, type ConfirmPurchaseResult, type StartPurchaseResult } from '../domain/sandboxEngine';
import { SandboxCommandBus, compactImagePayloadForFingerprint, fingerprint } from '../domain/commandBus';
import { SandboxCommandExecutor } from '../domain/commandExecutor';
import { applyPreviewOperation } from '../domain/previewOperations';
import { createListingPhotoAssistantDraftPatch, type ListingPhotoAssistantHandoffInput } from '../domain/listingPhotoAssistantHandoff';
import { IndexedDbSandboxStateStore } from '../domain/sandboxIdbStore';
import type { SandboxCommandRecord, SandboxStateRecord } from '../domain/sandboxStore';

const PREFERENCES_STORAGE_KEY = 'shop-ui-preferences-v1';
const INVENTORY_STORAGE_KEY = 'shop-inventory-v1';
const SANDBOX_STATE_STORAGE_KEY = 'furima-sandbox-state-v2';
const REMOTE_SANDBOX_STATE_ID = 'furima-demo-catalog-50';
// The browser never receives the D1 bearer/control secret. Until a signed
// session adapter is installed, D1 remains an operator API and browser state
// stays on IndexedDB (with an explicit volatile diagnostic fallback).
const REMOTE_STATE_ENABLED = false;
const scopedStorageKey = (base: string, actorId: string): string => `${base}:${REMOTE_SANDBOX_STATE_ID}:${actorId}`;
// This capability is private to startup hydration and is never attached to the
// browser agent bridge. Interactive control lives in the external test harness.
const BROWSER_STATE_RESTORE_PRINCIPAL = createTrustedPrincipal({ subjectId: 'browser-state-restore', actorId: 'platform', roles: ['platform'], scopes: ['sandbox-control', 'operator'] });
const BROWSER_STATE_RESTORE_OPTIONS = { principal: BROWSER_STATE_RESTORE_PRINCIPAL } as const satisfies AgentActionOptions;
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
  ...(item.garmentMeasurements ? { garmentMeasurements: { ...item.garmentMeasurements } } : {}),
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
  handoffListingPhotoAssistant: (draftId: string, input: ListingPhotoAssistantHandoffInput) => ActionResult<{ draftId: string }>;
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
  const [browserSandboxStore] = useState(() => new IndexedDbSandboxStateStore());
  const [browserCommandExecutor] = useState(() => new SandboxCommandExecutor({
    engine: sandboxEngine,
    store: browserSandboxStore,
    requirePersistentCommit: true,
  }));
  const localPersistChainRef = useRef(Promise.resolve());
  const persistTimerRef = useRef<number | null>(null);
  const localPersistedStateVersionRef = useRef<number | null>(null);
  const readyWaitersRef = useRef<Array<{ resolve: (result: ActionResult<{ sandboxId: string; stateVersion: number }>) => void; timeoutId: number }>>([]);
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

  const persistSandboxStateNow = (allowBeforeHydration = false) => {
    if ((!sandboxHydratedRef.current && !allowBeforeHydration) || typeof window === 'undefined') return;
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

  const syncFromEngine = (persist = true) => {
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
    if (persist) persistSandboxState();
    return nextSandbox;
  };

  const runUiCommand = <T,>(command: string, payload: unknown, operation: () => ActionResult<T>): ActionResult<T> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。準備完了後にもう一度お試しください。');
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
      syncFromEngine(false);
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
            const result = sandboxEngine.importState(localRecord.payload, BROWSER_STATE_RESTORE_OPTIONS);
            if (result.ok) {
              sandboxEngine.mergeCatalogItems(loadedCatalogItemsRef.current);
              localPersistedStateVersionRef.current = localRecord.stateVersion;
              restored = true;
              sandboxLoadedFromStorageRef.current = true;
              syncFromEngine(false);
            } else {
              browserSandboxStore.recordFailure('CORRUPTED');
            }
          }
        } catch {
          // IndexedDB is optional in private browsing and embedded previews.
        }
        if (!restored && REMOTE_STATE_ENABLED) {
          try {
            const response = await fetch(`/api/sandbox/state?id=${REMOTE_SANDBOX_STATE_ID}`, { headers: { accept: 'application/json' }, credentials: 'include' });
            if (response.ok) {
              const serialized = await response.text();
              const result = sandboxEngine.importState(serialized, BROWSER_STATE_RESTORE_OPTIONS);
              if (result.ok) {
                sandboxEngine.mergeCatalogItems(loadedCatalogItemsRef.current);
                const parsed = JSON.parse(serialized) as { stateVersion?: number };
                remoteStateVersionRef.current = typeof parsed.stateVersion === 'number' ? parsed.stateVersion : null;
                restored = true;
                sandboxLoadedFromStorageRef.current = true;
                localPersistedStateVersionRef.current = typeof parsed.stateVersion === 'number' ? parsed.stateVersion : null;
                await browserSandboxStore.put(sandboxStateRecord(), undefined, true);
                syncFromEngine(false);
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
              const result = sandboxEngine.importState(serialized, BROWSER_STATE_RESTORE_OPTIONS);
              if (result.ok) {
                sandboxEngine.mergeCatalogItems(loadedCatalogItemsRef.current);
                sandboxLoadedFromStorageRef.current = true;
                localPersistedStateVersionRef.current = sandboxEngine.getStateVersion();
                await browserSandboxStore.put(sandboxStateRecord(), undefined, true);
                browserSandboxStore.markLegacyMigration();
                window.localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
                syncFromEngine(false);
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
          if (persistTimerRef.current !== null) {
            window.clearTimeout(persistTimerRef.current);
            persistTimerRef.current = null;
          }
          // Readiness includes the initial durable write. Otherwise a delayed
          // hydration write can race with the first read-only agent preview and
          // make the durable record appear to have been mutated by the preview.
          persistSandboxStateNow(true);
          await localPersistChainRef.current;
          if (cancelled) return;
          sandboxHydratedRef.current = true;
          setIsSandboxReady(true);
          window.__FURIMA_SANDBOX_DIAGNOSTICS__ = browserSandboxStore.getDiagnostics();
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

  const handoffListingPhotoAssistant = (draftId: string, input: ListingPhotoAssistantHandoffInput): ActionResult<{ draftId: string }> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。準備完了後にもう一度お試しください。');
    const currentDraft = sandboxEngine.getListingDrafts(activeActor.id).find((draft) => draft.draftId === draftId);
    if (!currentDraft) return failure('DRAFT_NOT_FOUND', sandboxEngine.getStateVersion(), '引き渡し先の出品下書きが見つかりません。');
    const prepared = createListingPhotoAssistantDraftPatch(input, currentDraft.fields);
    if (!prepared.ok) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), prepared.message, { code: prepared.code });
    // Only the sanitized patch enters the command bus and durable draft state.
    return updateListingDraft(draftId, prepared.patch);
  };

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
  const persistAgentCommand = <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, result: ActionResult<T>, stateVersionBefore: number) => {
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
    const previewId = action === 'commitPreview' && payload && typeof payload === 'object' && typeof (payload as { previewId?: unknown }).previewId === 'string'
      ? String((payload as unknown as { previewId: string }).previewId)
      : undefined;
    const state = sandboxStateRecord(createdAt);
    localPersistChainRef.current = localPersistChainRef.current.then(async () => {
      const expectedStateVersion = localPersistedStateVersionRef.current ?? stateVersionBefore;
      const write = await browserSandboxStore.commitCommand(record, state, expectedStateVersion, previewId);
      if (write.ok) {
        localPersistedStateVersionRef.current = state.stateVersion;
        if (write.durability === 'volatile') {
          window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), localPersistenceError: browserSandboxStore.getDiagnostics().fallbackReason ?? 'UNAVAILABLE' };
        }
        return;
      }
      window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), localPersistenceError: write.error === 'CONFLICT' ? 'CORRUPTED' : 'UNAVAILABLE' };
    }).catch(() => {
      browserSandboxStore.recordFailure('UNAVAILABLE');
      window.__FURIMA_SANDBOX_DIAGNOSTICS__ = { ...browserSandboxStore.getDiagnostics(), localPersistenceError: 'UNAVAILABLE' };
    });
  };

  const browserOptionsFor = (options: AgentActionOptions | undefined, mode: 'preview' | 'commit' = 'commit'): AgentActionOptions | ActionResult<never> => {
    const actor = sandboxEngine.getCurrentActor();
    if (options?.principal || options?.scope !== undefined || options?.targetActorId !== undefined) return failure('FORBIDDEN', sandboxEngine.getStateVersion(), 'actor、role、scope、principalは信頼済みbrowser adapterだけが設定できます');
    if (options?.actorId && options.actorId !== actor.id) return failure('FORBIDDEN', sandboxEngine.getStateVersion(), 'actorIdを現在のbrowser sessionから上書きできません');
    if (options?.sandboxId && options.sandboxId !== sandboxEngine.getSandboxId()) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), 'sandboxIdが現在のbrowser sessionと一致しません');
    const principal = createTrustedPrincipal({
      subjectId: `browser-session:${sandboxEngine.getSandboxId()}:${actor.id}`,
      actorId: actor.id,
      roles: [actor.role],
      scopes: ['user'],
    });
    return {
      principal,
      actorId: actor.id,
      sandboxId: sandboxEngine.getSandboxId(),
      mode,
      ...(options?.requestId ? { requestId: options.requestId } : {}),
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options?.operationId ? { operationId: options.operationId } : {}),
      ...(options?.commandId ? { commandId: options.commandId } : {}),
      ...(options?.expectedStateVersion !== undefined ? { expectedStateVersion: options.expectedStateVersion } : {}),
    };
  };

  const runAgentRead = <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, operation: (trustedOptions: AgentActionOptions) => ActionResult<T>): ActionResult<T> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。waitForReady()完了後に実行してください。');
    const trustedOptions = browserOptionsFor(options);
    if ('ok' in trustedOptions) return trustedOptions as ActionResult<T>;
    return commandBus.execute(action, payload, trustedOptions, () => operation(trustedOptions));
  };

  const runAgentUiAction = <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, operation: () => ActionResult<T>): ActionResult<T> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。waitForReady()完了後に実行してください。');
    const trustedOptions = browserOptionsFor(options);
    if ('ok' in trustedOptions) return trustedOptions as ActionResult<T>;
    return commandBus.execute(action, payload, trustedOptions, operation);
  };

  const runAgentMutation = async <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, operation: (working: SandboxEngine, trustedOptions: AgentActionOptions) => ActionResult<T>, afterPublish?: (result: ActionResult<T>) => void): Promise<ActionResult<T>> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。waitForReady()完了後に実行してください。');
    const trustedOptions = browserOptionsFor(options);
    if ('ok' in trustedOptions) return trustedOptions as ActionResult<T>;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
      persistSandboxStateNow();
    }
    await localPersistChainRef.current;
    const result = await browserCommandExecutor.execute(action, payload, trustedOptions, (working) => operation(working, trustedOptions));
    if (result.ok) {
      localPersistedStateVersionRef.current = result.stateVersion;
      syncFromEngine(false);
      afterPublish?.(result);
    }
    return result;
  };

  const previewAction = async (command: PreviewCommand, payload: unknown, options?: AgentActionOptions): Promise<ActionResult<ActionPreview>> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。waitForReady()完了後に実行してください。');
    const trustedOptions = browserOptionsFor(options, 'preview');
    if ('ok' in trustedOptions) return trustedOptions as ActionResult<ActionPreview>;
    await localPersistChainRef.current;
    return browserCommandExecutor.preview(command, payload, trustedOptions, (working) => applyPreviewOperation(working, command, payload, trustedOptions));
  };

  const commitPreview = async (previewId: string, options?: AgentActionOptions): Promise<ActionResult<unknown>> => {
    if (!sandboxHydratedRef.current) return failure('SANDBOX_NOT_READY', stateVersionRef.current, 'Sandbox状態を復元しています。waitForReady()完了後に実行してください。');
    const trustedOptions = browserOptionsFor(options, 'commit');
    if ('ok' in trustedOptions) return trustedOptions;
    await localPersistChainRef.current;
    const result = await browserCommandExecutor.commitPreview(previewId, trustedOptions, (working, command, payload) => applyPreviewOperation(working, command as PreviewCommand, payload, trustedOptions));
    if (result.ok) {
      localPersistedStateVersionRef.current = result.stateVersion;
      syncFromEngine(false);
    }
    return result;
  };

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
      navigateTab: (tab, options) => runAgentUiAction('navigateTab', { tab }, options, () => {
        if (!isMainTabValue(tab)) return failure('INVALID_TAB', sandboxEngine.getStateVersion(), '無効なタブです');
        navigateToTab(tab);
        return success(undefined, sandboxEngine.getStateVersion());
      }),
      navigateHomeSubTab: (tab, options) => runAgentUiAction('navigateHomeSubTab', { tab }, options, () => {
        if (!isHomeTabValue(tab)) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '無効なホームサブタブです');
        navigateToTab('home');
        setHomeTab(tab);
        return success(undefined, sandboxEngine.getStateVersion());
      }),
      navigateCategory: (category, options) => runAgentUiAction('navigateCategory', { category }, options, () => {
        if (typeof category !== 'string' || !category.trim()) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), 'カテゴリを指定してください');
        const normalizedCategory = category.trim();
        setCategoryName(normalizedCategory);
        setMainTab('category');
        setIsSearchOpenState(false);
        setSelectedItemId(null);
        setBuyingItemId(null);
        patchStateRef({ currentMainTab: 'category', currentCategory: normalizedCategory, selectedItemId: null, buyingItemId: null });
        return success(undefined, sandboxEngine.getStateVersion());
      }),
      search: (query, options) => runAgentUiAction('search', { query }, options, () => {
        if (typeof query !== 'string') return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '検索語は文字列で指定してください');
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return failure('INVALID_INPUT', stateVersionRef.current);
        if (sandboxEngine.getSnapshot().scenarioId === 'zero_search_results') return failure('NO_RESULTS', sandboxEngine.getStateVersion(), 'このシナリオでは検索結果が0件になります');
        setIsSearchOpen(true);
        setSearchQuery(normalizedQuery);
        addSearchHistory(normalizedQuery);
        patchStateRef({ searchQuery: normalizedQuery, selectedItemId: null, buyingItemId: null });
        return success(undefined, sandboxEngine.getStateVersion());
      }),
      openItem: (itemId, options) => runAgentMutation('openItem', { itemId }, options, (working) => {
        if (typeof itemId !== 'string' || !itemId.trim()) return failure('INVALID_INPUT', working.getStateVersion(), '商品IDを指定してください');
        const target = working.getItem(itemId);
        if (!target) return failure('ITEM_NOT_FOUND', working.getStateVersion());
        working.replaceItems(working.getItems().map((item) => item.id === itemId ? { ...item, viewsCount: (item.viewsCount ?? 0) + 1, viewedAt: working.getNow() } : item));
        return success(undefined, working.commitViewState());
      }, () => {
        setBuyingItemId(null);
        setSelectedItemId(itemId);
        setMyPagePanel(null);
        const nextRecentlyViewedIds = [itemId, ...(stateRef.current?.recentlyViewedIds ?? recentlyViewedIds).filter((id) => id !== itemId)].slice(0, 12);
        setRecentlyViewedIds(nextRecentlyViewedIds);
        patchStateRef({ selectedItemId: itemId, buyingItemId: null, recentlyViewedIds: nextRecentlyViewedIds });
      }),
      closeItem: (options) => runAgentUiAction('closeItem', {}, options, () => {
        setSelectedItemId(null);
        patchStateRef({ selectedItemId: null });
        replaceItemRoute();
        return success(undefined, sandboxEngine.getStateVersion());
      }),
      setLiked: (itemId, liked, options) => runAgentMutation('setLiked', { itemId, liked }, options, (working) => {
        if (typeof itemId !== 'string' || typeof liked !== 'boolean') return failure('INVALID_INPUT', working.getStateVersion(), 'いいね入力の形式が不正です');
        if (!working.getCurrentActor().authenticated) return failure('AUTH_REQUIRED', working.getStateVersion(), 'いいねするにはログインが必要です。');
        const target = working.getItem(itemId);
        if (!target) return failure('ITEM_NOT_FOUND', working.getStateVersion());
        if (target.isLiked === liked) return success(undefined, working.getStateVersion());
        working.replaceItems(working.getItems().map((item) => item.id !== itemId ? item : { ...item, isLiked: liked, likesCount: liked ? item.likesCount + 1 : Math.max(0, item.likesCount - 1) }));
        return success(undefined, working.commitViewState());
      }),
      likeItem: (itemId, options) => runAgentMutation('likeItem', { itemId, liked: true }, options, (working) => {
        if (!working.getCurrentActor().authenticated) return failure('AUTH_REQUIRED', working.getStateVersion(), 'いいねするにはログインが必要です。');
        const target = working.getItem(itemId);
        if (!target) return failure('ITEM_NOT_FOUND', working.getStateVersion());
        if (target.isLiked) return success(undefined, working.getStateVersion());
        working.replaceItems(working.getItems().map((item) => item.id !== itemId ? item : { ...item, isLiked: true, likesCount: item.likesCount + 1 }));
        return success(undefined, working.commitViewState());
      }),
      setSaved: (itemId, saved, options) => runAgentUiAction('setSaved', { itemId, saved }, options, () => {
        if (typeof itemId !== 'string' || typeof saved !== 'boolean') return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '保存入力の形式が不正です');
        if (!sandboxEngine.getCurrentActor().authenticated) return failure('AUTH_REQUIRED', sandboxEngine.getStateVersion(), '商品を保存するにはログインが必要です。');
        if (!sandboxEngine.getItem(itemId)) return failure('ITEM_NOT_FOUND', sandboxEngine.getStateVersion());
        const current = stateRef.current?.savedItemIds ?? savedItemIds;
        const next = saved ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId);
        setSavedItemIds(next);
        patchStateRef({ savedItemIds: next });
        return success(undefined, sandboxEngine.getStateVersion());
      }),
      addComment: (itemId, text, options) => runAgentMutation('addComment', { itemId, text }, options, (working, trusted) => working.addComment(itemId, text, trusted)),
      listItem: (item, options) => runAgentMutation('listItem', item, options, (working, trusted) => working.listItem(item, trusted)),
      createListingDraft: (item, options) => runAgentMutation('createListingDraft', item, options, (working, trusted) => working.createListingDraft(item, trusted)),
      updateListingDraft: (draftId, item, options) => runAgentMutation('updateListingDraft', { draftId, item }, options, (working, trusted) => working.updateListingDraft(draftId, item, trusted)),
      getListingDrafts: (options) => runAgentRead('getListingDrafts', {}, options, (trusted) => success(sandboxEngine.getListingDrafts(trusted.principal?.actorId ?? sandboxEngine.getCurrentActor().id), sandboxEngine.getStateVersion())),
      saveListingDraft: (item: SaveListingDraftInput, options) => runAgentMutation('saveListingDraft', item, options, (working, trusted) => {
        if (!item || typeof item !== 'object') return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '出品下書きの形式が不正です');
        const { draftId, ...fields } = item;
        return draftId ? working.updateListingDraft(draftId, fields, trusted) : working.createListingDraft(fields, trusted);
      }),
      deleteListingDraft: (draftId, options) => runAgentMutation('deleteListingDraft', { draftId }, options, (working, trusted) => working.deleteListingDraft(draftId, trusted)),
      submitListing: (draftId, options) => runAgentMutation('submitListing', { draftId }, options, (working, trusted) => working.submitListing(draftId, trusted)),
      startPurchase: (itemId, options) => runAgentMutation('startPurchase', { itemId }, options, (working, trusted) => working.startPurchase(itemId, trusted), () => setBuyingItemId(itemId)),
      confirmPurchase: (purchaseIntentId, options) => runAgentMutation('confirmPurchase', { purchaseIntentId }, options, (working, trusted) => working.confirmPurchase(purchaseIntentId, trusted)),
      placeBid: (itemId, amount, options) => runAgentMutation('placeBid', { itemId, amount }, options, (working, trusted) => working.placeBid(itemId, amount, trusted)),
      closeAuction: (itemId, options) => runAgentMutation('closeAuction', { itemId }, options, (working, trusted) => working.closeAuction(itemId, trusted)),
      buyItem: (itemId, options) => runAgentMutation('buyItem', { itemId }, options, (working, trusted) => working.startPurchase(itemId, trusted), () => setBuyingItemId(itemId)),
      shipOrder: (transactionId, options) => runAgentMutation('shipOrder', { transactionId }, options, (working, trusted) => working.shipOrder(transactionId, trusted)),
      markDelivered: (transactionId, options) => runAgentMutation('markDelivered', { transactionId }, options, (working, trusted) => working.markDelivered(transactionId, trusted)),
      reviewOrder: (transactionId, rating, comment, options) => runAgentMutation('reviewOrder', { transactionId, rating, comment }, options, (working, trusted) => working.reviewOrder(transactionId, rating, comment, trusted)),
      cancelOrder: (transactionId, reason, options) => runAgentMutation('cancelOrder', { transactionId, reason }, options, (working, trusted) => working.cancelOrder(transactionId, reason, trusted)),
      resolveCancellation: (transactionId, approve, options) => runAgentMutation('resolveCancellation', { transactionId, approve }, options, (working, trusted) => working.resolveCancellation(transactionId, approve, trusted)),
      reviewListing: (itemId, approve, options) => runAgentMutation('reviewListing', { itemId, approve }, options, (working, trusted) => working.reviewListing(itemId, approve, trusted)),
      requestReturn: (transactionId, reason, options) => runAgentMutation('requestReturn', { transactionId, reason }, options, (working, trusted) => working.requestReturn(transactionId, reason, trusted)),
      confirmReturnReceived: (transactionId, options) => runAgentMutation('confirmReturnReceived', { transactionId }, options, (working, trusted) => working.confirmReturnReceived(transactionId, trusted)),
      sendTransactionMessage: (transactionId, body, options) => runAgentMutation('sendTransactionMessage', { transactionId, body }, options, (working, trusted) => working.sendTransactionMessage(transactionId, body, trusted)),
      createSupportTicket: (input, options) => runAgentMutation('createSupportTicket', input, options, (working, trusted) => working.createSupportTicket(input, trusted)),
      reportTransaction: (transactionId, body, options) => runAgentMutation('reportTransaction', { transactionId, body }, options, (working, trusted) => working.reportTransaction(transactionId, body, trusted)),
      updateListing: (itemId, input, options) => runAgentMutation('updateListing', { itemId, input }, options, (working, trusted) => working.updateListing(itemId, input, trusted)),
      pauseListing: (itemId, options) => runAgentMutation('pauseListing', { itemId }, options, (working, trusted) => working.pauseListing(itemId, trusted)),
      resumeListing: (itemId, options) => runAgentMutation('resumeListing', { itemId }, options, (working, trusted) => working.resumeListing(itemId, trusted)),
      relistItem: (itemId, options) => runAgentMutation('relistItem', { itemId }, options, (working, trusted) => working.relistItem(itemId, trusted)),
      listOwnListings: (options) => runAgentRead('listOwnListings', {}, options, () => {
        const actor = sandboxEngine.getCurrentActor();
        if (!actor?.authenticated) return failure('AUTH_REQUIRED', sandboxEngine.getStateVersion());
        if (actor.role !== 'seller' && actor.role !== 'admin' && actor.role !== 'platform') return failure('FORBIDDEN', sandboxEngine.getStateVersion(), '自分の出品一覧を取得できるのはsellerまたは運営です');
        return success(sandboxEngine.getItems().filter((item) => actor.role === 'admin' || actor.role === 'platform' || item.sellerId === actor.id), sandboxEngine.getStateVersion());
      }),
      catalog: {
        list: (input: CatalogListInput = {}, options) => runAgentRead('catalog.list', input, options, () => {
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
        get: (itemId, options) => runAgentRead('catalog.get', { itemId }, options, () => {
          const item = sandboxEngine.getItem(itemId);
          return item ? success(item, sandboxEngine.getStateVersion()) : failure('ITEM_NOT_FOUND', sandboxEngine.getStateVersion());
        }),
      },
      getCapabilities: () => {
        const capabilities = sandboxEngine.getCapabilities();
        const controlCommands = new Set(['switchActor', 'loadScenario', 'advanceClock', 'injectFailure', 'resetScenario', 'exportState', 'importState']);
        return {
          ...capabilities,
          scenarios: [],
          actors: [sandboxEngine.getCurrentActor()],
          commands: capabilities.commands.filter((command) => !controlCommands.has(command)),
        };
      },
      getSandboxSnapshot: () => sandboxEngine.getScopedSnapshot(),
      getTransactions: () => sandboxEngine.getVisibleTransactions(),
      getDomainEvents: () => sandboxEngine.getVisibleDomainEvents(),
      getSnapshot,
      getItems: () => sandboxEngine.getItems(),
      getItem: (itemId) => { if (typeof itemId !== 'string' || itemId.length > 200) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '商品IDの形式が不正です'); const item = sandboxEngine.getItem(itemId); return item ? success(item, sandboxEngine.getStateVersion()) : failure('ITEM_NOT_FOUND', sandboxEngine.getStateVersion()); },
      searchItems,
      getState: getSnapshot,
      getActionTrace: () => commandBus.getTrace(),
      getInventoryMovements: (itemId) => sandboxEngine.getVisibleInventoryMovements(sandboxEngine.getCurrentActor().id, itemId),
      getProfile: (actorId) => {
        const viewer = sandboxEngine.getCurrentActor();
        const targetId = actorId ?? viewer.id;
        if (targetId !== viewer.id && viewer.role !== 'admin' && viewer.role !== 'platform') return undefined;
        return sandboxEngine.getProfile(targetId);
      },
      updateProfile: (input, options) => runAgentMutation('updateProfile', input, options, (working, trusted) => working.updateProfile(input, trusted)),
      getFollowList: (direction, options) => runAgentRead('getFollowList', { direction }, options, (trusted) => sandboxEngine.getFollowList(direction, trusted)),
      getFollowSummary: (actorId, options) => runAgentRead('getFollowSummary', { actorId }, options, (trusted) => sandboxEngine.getFollowSummary(actorId, trusted)),
      followUser: (actorId, options) => runAgentMutation('followUser', { actorId }, options, (working, trusted) => working.followUser(actorId, trusted)),
      unfollowUser: (actorId, options) => runAgentMutation('unfollowUser', { actorId }, options, (working, trusted) => working.unfollowUser(actorId, trusted)),
      getWallet: (options) => runAgentRead('getWallet', {}, options, (trusted) => sandboxEngine.getWallet(trusted)),
      depositWallet: (amount, options) => runAgentMutation('depositWallet', { amount }, options, (working, trusted) => working.depositWallet(amount, trusted)),
      withdrawWallet: (amount, options) => runAgentMutation('withdrawWallet', { amount }, options, (working, trusted) => working.withdrawWallet(amount, trusted)),
      previewAction,
      commitPreview,
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

    return <MercariContext.Provider value={{ isAuthenticated, activeActor, sandboxSnapshot: liveSnapshot, isSandboxReady, isLoginPromptOpen, loginPromptReason, requestLogin, closeLoginPrompt, mainTab, setMainTab, myPagePanel, setMyPagePanel, openMyPagePanel, homeTab, setHomeTab, navigateToTab, categoryName, setCategoryName, openCategory, isSearchOpen, setIsSearchOpen, searchQuery, setSearchQuery, searchHistory, addSearchHistory, clearSearchHistory, selectedItemId, setSelectedItemId, selectedItem, setSelectedItem, openItem, closeItem, buyingItemId, setBuyingItemId, buyingItem, setBuyingItem, startPurchase, purchaseItem, placeBid, isPurchaseCompleteOpen, setIsPurchaseCompleteOpen, isListingModalOpen, setIsListingModalOpen, items, toggleLikeItem, setLiked, setSaved, addNewItem, createListingDraft, updateListingDraft, handoffListingPhotoAssistant, getListingDrafts: () => sandboxEngine.getListingDrafts(activeActor.id), deleteListingDraft, submitListing, updateListing, pauseListing, resumeListing, relistItem, addComment, recentlyViewedIds, savedItemIds, user, profile, wallet, getWallet, depositWallet, withdrawWallet, updateProfile, getFollowList, getFollowSummary, followUser, unfollowUser, notifications, activeNotification, openNotification, setActiveNotification, isDeviceFrame, setIsDeviceFrame, getTransactions: (actorId) => sandboxEngine.getVisibleTransactions(actorId), getDomainEvents: () => sandboxEngine.getVisibleDomainEvents(), shipOrder, markDelivered, reviewOrder, cancelOrder }}>{children}</MercariContext.Provider>;
};

export const useMercari = () => {
  const context = useContext(MercariContext);
  if (!context) throw new Error('useMercari must be used within a MercariProvider');
  return context;
};
