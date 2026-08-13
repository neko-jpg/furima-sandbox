'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  ActionResult,
  ActionTraceEntry,
  AgentActionOptions,
  HomeTab,
  InventoryMovement,
  MainTab,
  MercariAgentAPI,
  MercariAgentSnapshot,
  MercariItem,
  NotificationItem,
  PurchasePricing,
  SandboxActor,
  SandboxSnapshot,
  ScenarioId,
  TransactionRecord,
  UserProfile,
} from '../types/mercari';
import { INITIAL_ITEMS, INITIAL_NOTIFICATIONS, INITIAL_USER } from '../data/initialData';
import { searchCatalogItems } from '../components/searchUtils';
import { SandboxEngine, type ConfirmPurchaseResult, type StartPurchaseResult } from '../domain/sandboxEngine';

declare const __FURIMA_D1_ENABLED__: boolean;

const PREFERENCES_STORAGE_KEY = 'shop-ui-preferences-v1';
const INVENTORY_STORAGE_KEY = 'shop-inventory-v1';
const SANDBOX_STATE_STORAGE_KEY = 'furima-sandbox-state-v1';
const REMOTE_SANDBOX_STATE_ID = 'furima-demo';
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const MAX_AGENT_PAYLOAD_BYTES = 128 * 1024;
const IMAGE_FINGERPRINT_ACTIONS = new Set(['createListingDraft', 'updateListingDraft', 'listItem', 'updateListing']);
const REMOTE_STATE_ENABLED = __FURIMA_D1_ENABLED__;
const SANDBOX_CONTROL_OPTIONS = { actorId: 'platform', scope: 'sandbox-control' } as const satisfies AgentActionOptions;

const INITIAL_CATALOG_ITEMS = [...INITIAL_ITEMS];

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

const readPersistedPreferences = (): PersistedPreferences => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return raw ? JSON.parse(raw) as PersistedPreferences : {};
  } catch {
    return {};
  }
};

const readPersistedInventory = (): PersistedInventory => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(INVENTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) as PersistedInventory : {};
  } catch {
    return {};
  }
};

const INITIAL_SEARCH_HISTORY = ['ゲーム・おもちゃ・グッズ', '本・雑誌・漫画', 'ファッション, メンズ', 'ノートPC', 'PC', 'ゲーム', '本・マンガ', 'ファッション'];
const INITIAL_RECENTLY_VIEWED_IDS = ['pc-2', 'pc-1', 'item-8', 'item-5', 'fashion-2', 'game-1'];

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
const createId = (prefix: string) => typeof globalThis.crypto?.randomUUID === 'function'
  ? `${prefix}-${globalThis.crypto.randomUUID()}`
  : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const canonicalizeForFingerprint = (value: unknown, seen: WeakSet<object>, depth = 0): unknown => {
  if (depth > 12) throw new Error('payload-too-deep');
  if (value === undefined) return '__undefined__';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('payload-number');
    return value;
  }
  if (typeof value !== 'object') throw new Error('payload-type');
  if (seen.has(value)) throw new Error('payload-cycle');
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => canonicalizeForFingerprint(entry, seen, depth + 1));
  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  Object.keys(object).sort().forEach((key) => { result[key] = canonicalizeForFingerprint(object[key], seen, depth + 1); });
  seen.delete(value);
  return result;
};

const safeFingerprint = (value: unknown): string | null => {
  try {
    const serialized = JSON.stringify(canonicalizeForFingerprint(value, new WeakSet<object>()));
    if (!serialized || serialized.length > MAX_AGENT_PAYLOAD_BYTES) return null;
    return serialized;
  } catch {
    return null;
  }
};

const digestText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const compactImagePayloadForFingerprint = (value: unknown, key = '', seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string' && (key === 'images' || key === 'imagePreviews') && value.length > 4096) {
    return { __imageLength: value.length, __imageDigest: digestText(value) };
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => compactImagePayloadForFingerprint(entry, key, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
    result[childKey] = compactImagePayloadForFingerprint(childValue, childKey, seen);
  });
  seen.delete(value);
  return result;
};

const success = <T,>(data: T, stateVersion: number): ActionResult<T> => ({ ok: true, data, stateVersion });
const failure = <T,>(error: Exclude<ActionResult<T>, { ok: true }>['error'], stateVersion: number, message?: string): ActionResult<T> => ({
  ok: false,
  error,
  stateVersion,
  ...(message ? { message } : {}),
});

interface MercariContextType {
  isAuthenticated: boolean;
  activeActor: SandboxActor;
  sandboxSnapshot: SandboxSnapshot;
  isLoginPromptOpen: boolean;
  loginPromptReason: string;
  requestLogin: (reason?: string) => void;
  closeLoginPrompt: () => void;
  mainTab: MainTab;
  setMainTab: (tab: MainTab) => void;
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
  submitListing: (draftId: string) => ActionResult<{ itemId: string }>;
  addComment: (itemId: string, text: string) => ActionResult<undefined>;
  recentlyViewedIds: string[];
  savedItemIds: string[];
  setSaved: (itemId: string, saved: boolean) => ActionResult<undefined>;
  user: UserProfile;
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
  const [homeTab, setHomeTabState] = useState<HomeTab>('recommend');
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpenState] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(INITIAL_SEARCH_HISTORY);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [buyingItemId, setBuyingItemId] = useState<string | null>(null);
  const [isPurchaseCompleteOpen, setIsPurchaseCompleteOpen] = useState(false);
  const [isListingModalOpen, setIsListingModalOpenState] = useState(false);
  const [items, setItems] = useState<MercariItem[]>(createInitialItems);
  const [user] = useState<UserProfile>(INITIAL_USER);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => cloneNotifications(INITIAL_NOTIFICATIONS));
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(INITIAL_RECENTLY_VIEWED_IDS);
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);
  const [isPreferencesHydrated, setIsPreferencesHydrated] = useState(false);
  const [isInventoryHydrated, setIsInventoryHydrated] = useState(false);
  const [isDeviceFrame, setIsDeviceFrame] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [loginPromptReason, setLoginPromptReason] = useState('Furima Sandboxはログイン不要のモックモードです。');
  const [sandboxEngine] = useState(() => new SandboxEngine(items, { notifications: INITIAL_NOTIFICATIONS, seed: 'catalog-seed-v1' }));
  const [activeActorId, setActiveActorId] = useState(() => sandboxEngine.getCurrentActor().id);
  const activeActor = sandboxEngine.getSnapshot().actors.find((actor) => actor.id === activeActorId) ?? sandboxEngine.getCurrentActor();
  const isAuthenticated = activeActor.authenticated;

  const stateVersionRef = useRef(sandboxEngine.getStateVersion());
  const actionTraceRef = useRef<ActionTraceEntry[]>([]);
  const idempotencyCacheRef = useRef(new Map<string, { fingerprint: string; result: ActionResult<unknown>; expiresAt: number }>());
  const listingDraftsRef = useRef(new Map<string, Partial<MercariItem>>());
  const [initialInventoryMovements] = useState<InventoryMovement[]>(createInitialInventoryMovements);
  const inventoryMovementsRef = useRef<InventoryMovement[]>(initialInventoryMovements);
  const stateRef = useRef<MercariAgentSnapshot | null>(null);
  const sandboxHydratedRef = useRef(false);
  const sandboxLoadedFromStorageRef = useRef(false);
  const remoteStateVersionRef = useRef<number | null>(null);
  const remotePersistChainRef = useRef(Promise.resolve());
  const catalogLoadRef = useRef<Promise<void>>(Promise.resolve());

  // React state is the rendering source, while this ref is the synchronous source
  // for the agent bridge. Keep both sides aligned inside each domain action so an
  // agent can read the new snapshot immediately after an action resolves.
  const persistSandboxState = () => {
    if (!sandboxHydratedRef.current || typeof window === 'undefined') return;
    const serialized = sandboxEngine.exportState();
    try {
      window.localStorage.setItem(SANDBOX_STATE_STORAGE_KEY, serialized);
    } catch {
      // Storage can be unavailable in private browsing or embedded previews.
    }
    if (!REMOTE_STATE_ENABLED) return;
    remotePersistChainRef.current = remotePersistChainRef.current.then(async () => {
      try {
        const headers: HeadersInit = { accept: 'application/json', 'content-type': 'application/json' };
        if (remoteStateVersionRef.current !== null) headers['if-match-state-version'] = String(remoteStateVersionRef.current);
        const response = await fetch(`/api/sandbox/state?id=${REMOTE_SANDBOX_STATE_ID}`, { method: 'PUT', headers, body: serialized, keepalive: true });
        if (response.ok) {
          const result = await response.json() as { stateVersion?: number };
          if (typeof result.stateVersion === 'number') remoteStateVersionRef.current = result.stateVersion;
        }
      } catch {
        // D1 is optional in local previews; localStorage remains the fallback.
      }
    });
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
    setCategoryName(null);
    setIsSearchOpenState(false);
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

  const setIsListingModalOpen = (open: boolean) => {
    if (open && !sandboxEngine.getCurrentActor().authenticated) {
      requestLogin('出品をはじめるにはログインが必要です。');
      return;
    }
    setIsListingModalOpenState(open);
    if (open) {
      setIsSearchOpenState(false);
      setSelectedItemId(null);
      setBuyingItemId(null);
      patchStateRef({ selectedItemId: null, buyingItemId: null });
    }
  };

  useEffect(() => {
    stateRef.current = {
      version: '1',
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
    const fetchCatalogPage = async (offset: number): Promise<{ items: MercariItem[]; total: number }> => {
      const response = await fetch(`/api/catalog?offset=${offset}&limit=160`, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
      const items = await response.json() as unknown;
      if (!Array.isArray(items)) throw new Error('catalog response is not an array');
      const total = Number(response.headers.get('x-catalog-total') ?? items.length);
      return { items: items as MercariItem[], total: Number.isFinite(total) ? total : items.length };
    };
    const catalogLoad = fetchCatalogPage(0).then(async (firstPage) => {
      const offsets = Array.from({ length: Math.max(0, Math.ceil((firstPage.total - firstPage.items.length) / 160)) }, (_, index) => (index + 1) * 160);
      const remainingPages = await Promise.all(offsets.map((offset) => fetchCatalogPage(offset)));
      return [firstPage.items, ...remainingPages.map((page) => page.items)].flat();
    }).then((catalogItems) => {
      if (cancelled || !Array.isArray(catalogItems)) return;
      sandboxEngine.mergeCatalogItems(catalogItems);
      syncFromEngine();
    }).catch(() => {
      // The small initial catalog remains usable when the optional catalog
      // request cannot be loaded in an offline or restricted preview.
    });
    catalogLoadRef.current = catalogLoad;
    return () => { cancelled = true; };
  }, [sandboxEngine]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        let restored = false;
        try {
          await catalogLoadRef.current;
          if (!REMOTE_STATE_ENABLED) {
            sandboxHydratedRef.current = true;
            persistSandboxState();
            return;
          }
          const response = await fetch(`/api/sandbox/state?id=${REMOTE_SANDBOX_STATE_ID}`, { headers: { accept: 'application/json' } });
          if (response.ok) {
            const serialized = await response.text();
            const result = sandboxEngine.importState(serialized, SANDBOX_CONTROL_OPTIONS);
            if (result.ok) {
              const parsed = JSON.parse(serialized) as { stateVersion?: number };
              remoteStateVersionRef.current = typeof parsed.stateVersion === 'number' ? parsed.stateVersion : null;
              restored = true;
              sandboxLoadedFromStorageRef.current = true;
              syncFromEngine();
            }
          }
        } catch {
          // D1 is optional in local previews.
        }
        if (!restored) {
          try {
            const serialized = window.localStorage.getItem(SANDBOX_STATE_STORAGE_KEY);
            if (serialized) {
              const result = sandboxEngine.importState(serialized, SANDBOX_CONTROL_OPTIONS);
              if (result.ok) {
                sandboxLoadedFromStorageRef.current = true;
                syncFromEngine();
              } else {
                window.localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
              }
            }
          } catch {
            // Ignore malformed or unavailable browser storage and start a clean sandbox.
          }
        }
        if (!cancelled) {
          sandboxHydratedRef.current = true;
          persistSandboxState();
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [sandboxEngine]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const persisted = readPersistedPreferences();
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
  }, [isAuthenticated, sandboxEngine]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const persisted = readPersistedInventory();
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
            reservedQuantity: 0,
            listingStatus: (isSold ? 'SOLD' : 'ACTIVE') as MercariItem['listingStatus'],
          };
          });
          sandboxEngine.replacePersistedInventory(nextItems);
          return nextItems;
        });
      }
      setIsInventoryHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [sandboxEngine]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isPreferencesHydrated) return;
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
        likedItemIds: items.filter((item) => item.isLiked).map((item) => item.id),
        searchHistory,
        recentlyViewedIds,
        savedItemIds,
      } satisfies PersistedPreferences));
    } catch {
      // Storage can be unavailable in private browsing or embedded previews.
    }
  }, [isPreferencesHydrated, items, searchHistory, recentlyViewedIds, savedItemIds]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isInventoryHydrated) return;
    try {
      window.localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({
        soldItemIds: items.filter((item) => item.isSold).map((item) => item.id),
        inventoryQuantities: Object.fromEntries(items.map((item) => [item.id, item.inventoryQuantity ?? (item.isSold ? 0 : 1)])),
      } satisfies PersistedInventory));
    } catch {
      // Storage can be unavailable in private browsing or embedded previews.
    }
  }, [isInventoryHydrated, items]);

  const bumpStateVersion = (patch: Partial<MercariAgentSnapshot> = {}) => {
    stateVersionRef.current += 1;
    patchStateRef(patch);
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

  const setLiked = (itemId: string, liked: boolean): ActionResult<undefined> => {
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
    persistSandboxState();
    return success(undefined, bumpStateVersion({ items: nextItems }));
  };

  const setSaved = (itemId: string, saved: boolean): ActionResult<undefined> => {
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
  };

  const toggleLikeItem = (itemId: string) => {
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (target) setLiked(itemId, !target.isLiked);
  };

  const openItem = (itemId: string): ActionResult<undefined> => {
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    const nextItems = (stateRef.current?.items ?? []).map((item) => item.id === itemId ? {
      ...item,
      viewsCount: (item.viewsCount ?? 0) + 1,
      viewedAt: sandboxEngine.getNow(),
    } : item);
    sandboxEngine.replaceItems(nextItems);
    setItems(nextItems);
    persistSandboxState();
    setBuyingItemId(null);
    setSelectedItemId(itemId);
    const nextRecentlyViewedIds = [itemId, ...(stateRef.current?.recentlyViewedIds ?? recentlyViewedIds).filter((id) => id !== itemId)].slice(0, 12);
    setRecentlyViewedIds(nextRecentlyViewedIds);
    return success(undefined, bumpStateVersion({
      selectedItemId: itemId,
      buyingItemId: null,
      recentlyViewedIds: nextRecentlyViewedIds,
      items: nextItems,
    }));
  };
  const closeItem = () => {
    setSelectedItemId(null);
    patchStateRef({ selectedItemId: null });
  };

  const startPurchase = (itemId: string): ActionResult<StartPurchaseResult> => {
    const result = sandboxEngine.startPurchase(itemId, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('購入・入札するにはログインが必要です。');
      return result;
    }
    setBuyingItemId(itemId);
    syncFromEngine();
    return result;
  };

  const purchaseItem = (itemId: string, pricing?: PurchasePricing): ActionResult<ConfirmPurchaseResult> => {
    const result = sandboxEngine.purchaseItemWithPricing(itemId, pricing, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('購入・入札するにはログインが必要です。');
      return result;
    }
    syncFromEngine();
    return result;
  };

  const placeBid = (itemId: string, amount: number): ActionResult<{ currentBid: number; bidsCount: number }> => {
    const result = sandboxEngine.placeBid(itemId, amount, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('購入・入札するにはログインが必要です。');
      return result;
    }
    syncFromEngine();
    return result;
  };

  const addNewItem = (newItemData: Partial<MercariItem>): ActionResult<MercariItem> => {
    const result = sandboxEngine.listItem(newItemData, { actorId: activeActor.id });
    if (!result.ok) {
      if (result.error === 'AUTH_REQUIRED') requestLogin('出品を確定するにはログインが必要です。');
      return result;
    }
    setIsListingModalOpen(false);
    syncFromEngine();
    return result;
  };

  const createListingDraft = (draft: Partial<MercariItem>): ActionResult<{ draftId: string }> => {
    const result = sandboxEngine.createListingDraft(draft, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  };

  const updateListingDraft = (draftId: string, draft: Partial<MercariItem>): ActionResult<{ draftId: string }> => {
    const result = sandboxEngine.updateListingDraft(draftId, draft, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  };

  const submitListing = (draftId: string): ActionResult<{ itemId: string }> => {
    const result = sandboxEngine.submitListing(draftId, { actorId: activeActor.id });
    if (result.ok) syncFromEngine();
    return result;
  };

  const addComment = (itemId: string, text: string): ActionResult<undefined> => {
    if (typeof itemId !== 'string' || typeof text !== 'string') return failure('INVALID_INPUT', stateVersionRef.current, 'コメント入力の形式が不正です');
    const actor = sandboxEngine.getCurrentActor();
    if (!actor.authenticated) {
      requestLogin('コメントするにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, 'コメントするにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    const normalizedText = text.trim();
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (target.isSold) return failure('ALREADY_SOLD', stateVersionRef.current, '売り切れの商品にはコメントできません');
    if (!normalizedText) return failure('INVALID_INPUT', stateVersionRef.current, 'コメントを入力してください');
    if (normalizedText.length > 500) return failure('INVALID_INPUT', stateVersionRef.current, 'コメントは500文字以内で入力してください');
    if (/https?:\/\/|www\.|(?:\d{2,4}-\d{2,4}-\d{3,4})|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(normalizedText)) {
      return failure('POLICY_BLOCKED', stateVersionRef.current, 'コメントに外部URLや連絡先を含めることはできません');
    }
    if (target.comments.some((comment) => (comment.userId === actor.id || (!comment.userId && comment.userName === user.name)) && comment.text === normalizedText)) {
      return failure('INVALID_INPUT', stateVersionRef.current, '同じコメントは連続して投稿できません');
    }
    const newComment = {
      id: createId('comment'),
      userId: actor.id,
      userName: actor.name,
      userAvatar: actor.id === 'buyer_01' ? user.avatar : '/favicon.svg',
      text: normalizedText,
      date: sandboxEngine.getNow().slice(0, 10),
    };
    const nextItems = (stateRef.current?.items ?? []).map((item) => item.id === itemId ? { ...item, comments: [...item.comments, newComment] } : item);
    setItems(nextItems);
    sandboxEngine.replaceItems(nextItems);
    persistSandboxState();
    return success(undefined, bumpStateVersion({ items: nextItems }));
  };

  const openNotification = (notificationId: string) => {
    if (!notifications.some((notification) => notification.id === notificationId)) return;
    sandboxEngine.markNotificationRead(notificationId);
    const nextNotifications = notificationsForActor(sandboxEngine.getNotifications(), sandboxEngine.getCurrentActor());
    setNotifications(nextNotifications);
    patchStateRef({ sandbox: sandboxEngine.getSnapshot() });
    persistSandboxState();
    setActiveNotificationId(notificationId);
  };
  const setActiveNotification = (notification: NotificationItem | null) => notification ? openNotification(notification.id) : setActiveNotificationId(null);
  const setSelectedItem = (item: MercariItem | null) => item ? openItem(item.id) : closeItem();
  const setBuyingItem = (item: MercariItem | null) => item ? startPurchase(item.id) : setBuyingItemId(null);

  const getSnapshot = (): MercariAgentSnapshot => ({
    ...(stateRef.current as MercariAgentSnapshot),
    stateVersion: sandboxEngine.getStateVersion(),
    searchHistory: [...(stateRef.current?.searchHistory ?? [])],
    recentlyViewedIds: [...(stateRef.current?.recentlyViewedIds ?? [])],
    savedItemIds: [...(stateRef.current?.savedItemIds ?? [])],
    items: sandboxEngine.getItems(),
    itemsCount: sandboxEngine.getItems().length,
    inventoryMovements: sandboxEngine.getVisibleInventoryMovements().slice(-100),
    sandbox: sandboxEngine.getScopedSnapshot(),
  });

  const runAgentAction = <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, operation: () => ActionResult<T>): ActionResult<T> => {
    const idempotencyKey = options?.idempotencyKey ?? options?.requestId ?? options?.commandId;
    const currentActorId = sandboxEngine.getCurrentActor().id;
    const fingerprintPayload = IMAGE_FINGERPRINT_ACTIONS.has(action) ? compactImagePayloadForFingerprint(payload) : payload;
    const fingerprint = safeFingerprint({ actorId: options?.actorId ?? currentActorId, scope: options?.scope ?? 'user', action, payload: fingerprintPayload });
    if (!fingerprint) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), 'payloadはJSON互換・循環参照なし・128KB以内で指定してください');
    const cached = idempotencyKey ? idempotencyCacheRef.current.get(idempotencyKey) : undefined;
    if (cached && idempotencyKey) {
      if (cached.expiresAt <= Date.now()) idempotencyCacheRef.current.delete(idempotencyKey);
      else {
        if (cached.fingerprint !== fingerprint) return failure('IDEMPOTENCY_CONFLICT', sandboxEngine.getStateVersion(), '同じ冪等キーで異なるpayloadを再利用できません');
        return cached.result as ActionResult<T>;
      }
    }
    const rememberResult = (result: ActionResult<T>): ActionResult<T> => {
      actionTraceRef.current = [...actionTraceRef.current.slice(-499), { action, requestId: options?.requestId, idempotencyKey: options?.idempotencyKey, commandId: options?.commandId, payload, result: result as ActionResult<unknown>, at: sandboxEngine.getNow() }];
      if (idempotencyKey) {
        if (idempotencyCacheRef.current.size >= 500) {
          const oldestKey = idempotencyCacheRef.current.keys().next().value;
          if (oldestKey) idempotencyCacheRef.current.delete(oldestKey);
        }
        idempotencyCacheRef.current.set(idempotencyKey, { fingerprint, result: result as ActionResult<unknown>, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
      }
      return result;
    };
    if (options?.actorId && options.actorId !== currentActorId && options.scope !== 'sandbox-control') {
      return rememberResult(failure('FORBIDDEN', sandboxEngine.getStateVersion(), 'actorIdは現在のSandbox actorと一致している必要があります'));
    }
    let result: ActionResult<T>;
    try {
      result = operation();
    } catch {
      result = failure('INVALID_INPUT', sandboxEngine.getStateVersion(), 'Sandbox commandの入力を処理できませんでした');
    }
    return rememberResult(result);
  };

  const searchItems = (query: string) => {
    if (typeof query !== 'string' || query.length > 500) return [];
    if (sandboxEngine.getSnapshot().scenarioId === 'zero_search_results') return [];
    return searchCatalogItems(sandboxEngine.getItems(), query).map(cloneItem);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const api: MercariAgentAPI = {
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
      closeItem: (options) => runAgentAction('closeItem', {}, options, () => { closeItem(); return success(undefined, bumpStateVersion()); }),
      setLiked: (itemId, liked, options) => runAgentAction('setLiked', { itemId, liked }, options, () => setLiked(itemId, liked)),
      likeItem: (itemId, options) => runAgentAction('likeItem', { itemId, liked: true }, options, () => setLiked(itemId, true)),
      setSaved: (itemId, saved, options) => runAgentAction('setSaved', { itemId, saved }, options, () => setSaved(itemId, saved)),
      addComment: (itemId, text, options) => runAgentAction('addComment', { itemId, text }, options, () => addComment(itemId, text)),
      listItem: (item, options) => runAgentAction('listItem', item, options, () => { const result = sandboxEngine.listItem(item, options); if (result.ok) syncFromEngine(); return result; }),
      createListingDraft: (item, options) => runAgentAction('createListingDraft', item, options, () => { const result = sandboxEngine.createListingDraft(item, options); if (result.ok) syncFromEngine(); return result; }),
      updateListingDraft: (draftId, item, options) => runAgentAction('updateListingDraft', { draftId, item }, options, () => { const result = sandboxEngine.updateListingDraft(draftId, item, options); if (result.ok) syncFromEngine(); return result; }),
      submitListing: (draftId, options) => runAgentAction('submitListing', { draftId }, options, () => { const result = sandboxEngine.submitListing(draftId, options); if (result.ok) syncFromEngine(); return result; }),
      startPurchase: (itemId, options) => runAgentAction('startPurchase', { itemId }, options, () => { const result = sandboxEngine.startPurchase(itemId, options); if (result.ok) { setBuyingItemId(itemId); syncFromEngine(); } return result; }),
      confirmPurchase: (purchaseIntentId, options) => runAgentAction('confirmPurchase', { purchaseIntentId }, options, () => { const result = sandboxEngine.confirmPurchase(purchaseIntentId, options); if (result.ok) syncFromEngine(); return result; }),
      placeBid: (itemId, amount, options) => runAgentAction('placeBid', { itemId, amount }, options, () => { const result = sandboxEngine.placeBid(itemId, amount, options); if (result.ok) syncFromEngine(); return result; }),
      closeAuction: (itemId, options) => runAgentAction('closeAuction', { itemId }, options, () => { const result = sandboxEngine.closeAuction(itemId, options); if (result.ok) syncFromEngine(); return result; }),
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
      switchActor: (actorId, options) => runAgentAction('switchActor', { actorId }, options, () => { const result = sandboxEngine.switchActor(actorId, options); if (result.ok) { setActiveActorId(actorId); syncFromEngine(); } return result; }),
      loadScenario: (scenarioId, options) => runAgentAction('loadScenario', { scenarioId }, options, () => { const result = sandboxEngine.loadScenario(scenarioId, options); if (result.ok) { setActiveActorId(sandboxEngine.getCurrentActor().id); setMainTab('home'); setHomeTab('recommend'); setCategoryName(null); setIsSearchOpenState(false); setSelectedItemId(null); setBuyingItemId(null); setSearchQuery(''); setSearchHistory([...INITIAL_SEARCH_HISTORY]); setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]); setSavedItemIds([]); setActiveNotificationId(null); syncFromEngine(); } return result; }),
      advanceClock: (milliseconds, options) => runAgentAction('advanceClock', { milliseconds }, options, () => { const result = sandboxEngine.advanceClock(milliseconds, options); if (result.ok) syncFromEngine(); return result; }),
      injectFailure: (failureName, options) => runAgentAction('injectFailure', { failure: failureName }, options, () => { const result = sandboxEngine.injectFailure(failureName, options); if (result.ok) syncFromEngine(); return result; }),
      getCapabilities: () => sandboxEngine.getCapabilities(),
      getSandboxSnapshot: () => sandboxEngine.getScopedSnapshot(),
      getTransactions: (actorId) => sandboxEngine.getVisibleTransactions(actorId),
      getDomainEvents: () => sandboxEngine.getVisibleDomainEvents(),
       exportState: (options) => runAgentAction('exportState', {}, options, () => {
         const actor = sandboxEngine.getSnapshot().actors.find((candidate) => candidate.id === (options?.actorId ?? sandboxEngine.getCurrentActor().id));
         if (options?.scope !== 'sandbox-control' || !actor || (actor.role !== 'admin' && actor.role !== 'platform')) return failure('FORBIDDEN', sandboxEngine.getStateVersion(), 'Sandbox stateのバックアップはadmin/platformのsandbox-control scopeからのみ実行できます');
         return success(sandboxEngine.exportState(), sandboxEngine.getStateVersion());
       }),
       importState: (serialized, options) => runAgentAction('importState', {
         serializedType: typeof serialized,
         serializedLength: typeof serialized === 'string' ? serialized.length : 0,
         serializedDigest: typeof serialized === 'string' ? digestText(serialized) : null,
       }, options, () => { const result = sandboxEngine.importState(serialized, options); if (result.ok) syncFromEngine(); return result; }),
      getSnapshot,
      getItems: () => sandboxEngine.getItems(),
      getItem: (itemId) => { if (typeof itemId !== 'string' || itemId.length > 200) return failure('INVALID_INPUT', sandboxEngine.getStateVersion(), '商品IDの形式が不正です'); const item = sandboxEngine.getItem(itemId); return item ? success(item, sandboxEngine.getStateVersion()) : failure('ITEM_NOT_FOUND', sandboxEngine.getStateVersion()); },
      searchItems,
      getState: getSnapshot,
      getActionTrace: () => actionTraceRef.current.map((entry) => ({ ...entry })),
       getInventoryMovements: (itemId, options) => {
         const currentActor = sandboxEngine.getCurrentActor();
         const requestedActorId = options?.actorId ?? currentActor.id;
         if (requestedActorId !== currentActor.id && options?.scope !== 'sandbox-control') return [];
         const requestedActor = sandboxEngine.getSnapshot().actors.find((actor) => actor.id === requestedActorId);
         if (options?.scope === 'sandbox-control' && requestedActor && (requestedActor.role === 'admin' || requestedActor.role === 'platform')) return sandboxEngine.getInventoryMovements(itemId);
         return sandboxEngine.getVisibleInventoryMovements(requestedActorId, itemId);
       },
      getProfile: (actorId) => sandboxEngine.getProfile(actorId),
      updateProfile: (input, options) => runAgentAction('updateProfile', input, options, () => { const result = sandboxEngine.updateProfile(input, options); if (result.ok) syncFromEngine(); return result; }),
      resetScenario: (options) => runAgentAction('resetScenario', {}, options, () => {
        const scenarioId = (options as AgentActionOptions & { scenarioId?: ScenarioId } | undefined)?.scenarioId ?? 'catalog_default';
        const result = sandboxEngine.resetScenario({ ...options, scenarioId });
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
          window.localStorage.removeItem(SANDBOX_STATE_STORAGE_KEY);
        }
        idempotencyCacheRef.current.clear();
        actionTraceRef.current = [];
        syncFromEngine();
        return success(undefined, result.stateVersion);
      }),
    };
    window.__SHOP_API__ = api;
    window.__MERCARI_API__ = api;
    return () => {
      if (window.__SHOP_API__ === api) delete window.__SHOP_API__;
      if (window.__MERCARI_API__ === api) delete window.__MERCARI_API__;
    };
    // The bridge is stable; mutable values are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    return <MercariContext.Provider value={{ isAuthenticated, activeActor, sandboxSnapshot: sandboxEngine.getSnapshot(), isLoginPromptOpen, loginPromptReason, requestLogin, closeLoginPrompt, mainTab, setMainTab, homeTab, setHomeTab, navigateToTab, categoryName, setCategoryName, openCategory, isSearchOpen, setIsSearchOpen, searchQuery, setSearchQuery, searchHistory, addSearchHistory, clearSearchHistory, selectedItemId, setSelectedItemId, selectedItem, setSelectedItem, openItem, closeItem, buyingItemId, setBuyingItemId, buyingItem, setBuyingItem, startPurchase, purchaseItem, placeBid, isPurchaseCompleteOpen, setIsPurchaseCompleteOpen, isListingModalOpen, setIsListingModalOpen, items, toggleLikeItem, setLiked, setSaved, addNewItem, createListingDraft, updateListingDraft, submitListing, addComment, recentlyViewedIds, savedItemIds, user, notifications, activeNotification, openNotification, setActiveNotification, isDeviceFrame, setIsDeviceFrame, switchActor: (actorId) => { const result = sandboxEngine.switchActor(actorId, SANDBOX_CONTROL_OPTIONS); if (result.ok) { setActiveActorId(actorId); syncFromEngine(); } return result; }, loadScenario: (scenarioId) => { const result = sandboxEngine.loadScenario(scenarioId, SANDBOX_CONTROL_OPTIONS); if (result.ok) { setActiveActorId(sandboxEngine.getCurrentActor().id); setMainTab('home'); setHomeTab('recommend'); setCategoryName(null); setIsSearchOpenState(false); setSearchQuery(''); setSelectedItemId(null); setBuyingItemId(null); setActiveNotificationId(null); setSearchHistory([...INITIAL_SEARCH_HISTORY]); setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]); setSavedItemIds([]); syncFromEngine(); } return result; }, advanceClock: (milliseconds) => { const result = sandboxEngine.advanceClock(milliseconds, SANDBOX_CONTROL_OPTIONS); if (result.ok) syncFromEngine(); return result; }, getTransactions: (actorId) => sandboxEngine.getVisibleTransactions(actorId), getDomainEvents: () => sandboxEngine.getVisibleDomainEvents(), shipOrder: (transactionId) => { const result = sandboxEngine.shipOrder(transactionId); if (result.ok) syncFromEngine(); return result; }, markDelivered: (transactionId) => { const result = sandboxEngine.markDelivered(transactionId); if (result.ok) syncFromEngine(); return result; }, reviewOrder: (transactionId, rating, comment) => { const result = sandboxEngine.reviewOrder(transactionId, rating, comment); if (result.ok) syncFromEngine(); return result; }, cancelOrder: (transactionId, reason) => { const result = sandboxEngine.cancelOrder(transactionId, reason); if (result.ok) syncFromEngine(); return result; } }}>{children}</MercariContext.Provider>;
};

export const useMercari = () => {
  const context = useContext(MercariContext);
  if (!context) throw new Error('useMercari must be used within a MercariProvider');
  return context;
};
