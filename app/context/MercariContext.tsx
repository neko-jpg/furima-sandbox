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
  UserProfile,
} from '../types/mercari';
import { CATALOG_ITEMS } from '../data/catalogData';
import { INITIAL_ITEMS, INITIAL_NOTIFICATIONS, INITIAL_USER } from '../data/initialData';
import { searchCatalogItems } from '../components/searchUtils';

const PREFERENCES_STORAGE_KEY = 'shop-ui-preferences-v1';
const INVENTORY_STORAGE_KEY = 'shop-inventory-v1';

const INITIAL_CATALOG_ITEMS = [...INITIAL_ITEMS, ...CATALOG_ITEMS];

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
const createInitialItems = () => cloneItems(INITIAL_CATALOG_ITEMS).map((item) => ({
  ...item,
  isLiked: false,
  inventoryPolicy: item.inventoryPolicy ?? 'SINGLE',
  inventoryQuantity: item.isSold ? 0 : item.inventoryQuantity ?? 1,
  reservedQuantity: item.reservedQuantity ?? 0,
  listingStatus: item.isSold ? 'SOLD' as const : item.listingStatus ?? 'ACTIVE' as const,
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

const success = <T,>(data: T, stateVersion: number): ActionResult<T> => ({ ok: true, data, stateVersion });
const failure = <T,>(error: Exclude<ActionResult<T>, { ok: true }>['error'], stateVersion: number, message?: string): ActionResult<T> => ({
  ok: false,
  error,
  stateVersion,
  ...(message ? { message } : {}),
});

interface MercariContextType {
  isAuthenticated: boolean;
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
  startPurchase: (itemId: string) => ActionResult<undefined>;
  purchaseItem: (itemId: string) => ActionResult<undefined>;
  placeBid: (itemId: string, amount: number) => ActionResult<{ currentBid: number; bidsCount: number }>;
  isPurchaseCompleteOpen: boolean;
  setIsPurchaseCompleteOpen: (open: boolean) => void;
  isListingModalOpen: boolean;
  setIsListingModalOpen: (open: boolean) => void;
  items: MercariItem[];
  toggleLikeItem: (itemId: string) => void;
  setLiked: (itemId: string, liked: boolean) => ActionResult<undefined>;
  addNewItem: (item: Partial<MercariItem>) => ActionResult<MercariItem>;
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
  // This is intentionally always enabled: the site is a self-contained demo, so every mock action is available without an external account.
  const isAuthenticated = true;

  const stateVersionRef = useRef(0);
  const actionTraceRef = useRef<ActionTraceEntry[]>([]);
  const idempotencyCacheRef = useRef(new Map<string, ActionResult<unknown>>());
  const listingDraftsRef = useRef(new Map<string, Partial<MercariItem>>());
  const [initialInventoryMovements] = useState<InventoryMovement[]>(createInitialInventoryMovements);
  const inventoryMovementsRef = useRef<InventoryMovement[]>(initialInventoryMovements);
  const stateRef = useRef<MercariAgentSnapshot | null>(null);

  // React state is the rendering source, while this ref is the synchronous source
  // for the agent bridge. Keep both sides aligned inside each domain action so an
  // agent can read the new snapshot immediately after an action resolves.
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
    if (!isAuthenticated && (tab === 'mypage' || tab === 'notifications')) {
      requestLogin(tab === 'mypage' ? 'マイページを見るにはログインが必要です。' : 'お知らせを見るにはログインが必要です。');
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
    if (open && !isAuthenticated) {
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
    };
  }, [mainTab, homeTab, categoryName, searchQuery, selectedItemId, buyingItemId, searchHistory, recentlyViewedIds, savedItemIds, items]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const persisted = readPersistedPreferences();
      if (persisted.searchHistory) setSearchHistory(persisted.searchHistory);
      if (persisted.recentlyViewedIds) setRecentlyViewedIds(persisted.recentlyViewedIds);
      if (isAuthenticated && persisted.savedItemIds) setSavedItemIds(persisted.savedItemIds);
      if (isAuthenticated && persisted.likedItemIds) {
        const likedItemIds = new Set(persisted.likedItemIds);
        setItems((previous) => previous.map((item) => {
          const liked = likedItemIds.has(item.id);
          const baseLiked = Boolean(item.isLiked);
          return { ...item, isLiked: liked, likesCount: Math.max(0, item.likesCount + (liked === baseLiked ? 0 : liked ? 1 : -1)) };
        }));
      }
      setIsPreferencesHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isAuthenticated]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const persisted = readPersistedInventory();
      const persistedSoldIds = new Set(persisted.soldItemIds ?? []);
      const persistedQuantities = persisted.inventoryQuantities ?? {};
      if (persistedSoldIds.size > 0 || Object.keys(persistedQuantities).length > 0) {
        setItems((previous) => previous.map((item) => {
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
            listingStatus: isSold ? 'SOLD' : 'ACTIVE',
          };
        }));
      }
      setIsInventoryHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

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

  const recordInventoryMovement = (item: MercariItem, type: InventoryMovement['type'], quantity: number, reason: string, referenceId?: string) => {
    const movement: InventoryMovement = {
      id: createId('inventory-movement'),
      itemId: item.id,
      sku: item.sku,
      type,
      quantity,
      reason,
      referenceId,
      at: new Date().toISOString(),
    };
    inventoryMovementsRef.current = [...inventoryMovementsRef.current.slice(-1999), movement];
    return movement;
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
    if (!isAuthenticated) {
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
    return success(undefined, bumpStateVersion({ items: nextItems }));
  };

  const setSaved = (itemId: string, saved: boolean): ActionResult<undefined> => {
    if (!isAuthenticated) {
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
    setBuyingItemId(null);
    setSelectedItemId(itemId);
    const nextRecentlyViewedIds = [itemId, ...(stateRef.current?.recentlyViewedIds ?? recentlyViewedIds).filter((id) => id !== itemId)].slice(0, 12);
    setRecentlyViewedIds(nextRecentlyViewedIds);
    return success(undefined, bumpStateVersion({
      selectedItemId: itemId,
      buyingItemId: null,
      recentlyViewedIds: nextRecentlyViewedIds,
    }));
  };
  const closeItem = () => {
    setSelectedItemId(null);
    patchStateRef({ selectedItemId: null });
  };

  const startPurchase = (itemId: string): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('購入・入札するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '購入・入札するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    const availableQuantity = target.inventoryQuantity ?? (target.isSold ? 0 : 1);
    if (target.isSold || availableQuantity <= 0) return failure('ALREADY_SOLD', stateVersionRef.current, 'この商品は購入できません');
    setBuyingItemId(itemId);
    return success(undefined, bumpStateVersion({ buyingItemId: itemId }));
  };

  const purchaseItem = (itemId: string): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('購入・入札するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '購入・入札するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    const availableQuantity = target.inventoryQuantity ?? (target.isSold ? 0 : 1);
    if (target.isSold || availableQuantity <= 0) return failure('ALREADY_SOLD', stateVersionRef.current, 'この商品はすでに売り切れています');
    const nextQuantity = Math.max(0, availableQuantity - 1);
    const nextIsSold = nextQuantity === 0;
    const nextItems = (stateRef.current?.items ?? []).map((item) => item.id === itemId ? {
      ...item,
      isSold: nextIsSold,
      inventoryQuantity: nextQuantity,
      reservedQuantity: 0,
      listingStatus: nextIsSold ? 'SOLD' as const : 'ACTIVE' as const,
    } : item);
    setItems(nextItems);
    recordInventoryMovement(target, 'OUT', 1, 'デモ購入完了', `purchase-${itemId}-${stateVersionRef.current + 1}`);
    return success(undefined, bumpStateVersion({ items: nextItems }));
  };

  const placeBid = (itemId: string, amount: number): ActionResult<{ currentBid: number; bidsCount: number }> => {
    if (!isAuthenticated) {
      requestLogin('購入・入札するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '購入・入札するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (!target.isAuction) return failure('NOT_AUCTION', stateVersionRef.current, 'この商品はオークション商品ではありません');
    const minimumBid = (target.currentBid ?? target.price) + 100;
    if (!Number.isInteger(amount) || amount < minimumBid) return failure('BID_TOO_LOW', stateVersionRef.current, `入札額は¥${minimumBid.toLocaleString()}以上で入力してください`);
    const bidsCount = (target.bidsCount ?? 0) + 1;
    const nextItems = (stateRef.current?.items ?? []).map((item) => item.id === itemId ? { ...item, currentBid: amount, bidsCount } : item);
    setItems(nextItems);
    return success({ currentBid: amount, bidsCount }, bumpStateVersion({ items: nextItems }));
  };

  const addNewItem = (newItemData: Partial<MercariItem>): ActionResult<MercariItem> => {
    if (!isAuthenticated) {
      requestLogin('出品を確定するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '出品を確定するにはログインが必要です。');
    }
    const title = newItemData.title?.trim() ?? '';
    const price = newItemData.price ?? 1000;
    if (!title || !Number.isInteger(price) || price < 300) return failure('INVALID_INPUT', stateVersionRef.current, 'タイトルと価格を入力してください');
    const inventoryPolicy = newItemData.inventoryPolicy ?? 'SINGLE';
    const requestedInventoryQuantity = newItemData.inventoryQuantity;
    const inventoryQuantity = inventoryPolicy === 'MULTI' && Number.isInteger(requestedInventoryQuantity) && (requestedInventoryQuantity ?? 0) > 0
      ? requestedInventoryQuantity ?? 1
      : 1;
    const newItem: MercariItem = {
      id: createId('item'),
      sku: newItemData.sku || `FBS-${Date.now().toString(36).toUpperCase()}`,
      title,
      price,
      images: newItemData.images?.length ? [...newItemData.images] : ['/images/products/knit.jpg'],
      isSold: false,
      inventoryPolicy,
      inventoryInitialQuantity: inventoryQuantity,
      inventoryQuantity,
      reservedQuantity: 0,
      listingStatus: 'ACTIVE',
      isDemo: newItemData.isDemo ?? true,
      isAuction: newItemData.isAuction,
      currentBid: newItemData.currentBid,
      bidsCount: newItemData.bidsCount,
      timeLeft: newItemData.timeLeft,
      description: newItemData.description?.trim() || 'Furima Sandboxで見つけてもらえる、すてきな商品です。',
      category: newItemData.category?.length ? [...newItemData.category] : ['その他'],
      condition: newItemData.condition || '目立った傷や汚れなし',
      shippingFee: newItemData.shippingFee || '送料込み（出品者負担）',
      shippingMethod: newItemData.shippingMethod || 'ゆうゆう配送',
      origin: newItemData.origin || '東京都',
      shippingDays: newItemData.shippingDays || '1〜2日で発送',
      likesCount: 0,
      isLiked: false,
      brand: newItemData.brand,
      size: newItemData.size,
      color: newItemData.color,
      shippingSize: newItemData.shippingSize,
      isAnonymousShipping: newItemData.isAnonymousShipping ?? true,
      isAuthenticityEligible: newItemData.isAuthenticityEligible,
      sellerType: newItemData.sellerType ?? 'individual',
      sourceUrl: newItemData.sourceUrl,
      sourcePhotographer: newItemData.sourcePhotographer,
      sourceAttribution: newItemData.sourceAttribution,
      sourceChecksum: newItemData.sourceChecksum,
      productFamilyId: newItemData.productFamilyId,
      productFamilyName: newItemData.productFamilyName,
      variantId: newItemData.variantId,
      variantName: newItemData.variantName,
      productType: newItemData.productType,
      searchTags: newItemData.searchTags ? [...newItemData.searchTags] : undefined,
      attributes: newItemData.attributes ? { ...newItemData.attributes } : undefined,
      seller: { name: user.name, avatar: user.avatar, rating: user.rating, ratingsCount: user.ratingsCount, isVerified: user.isVerified },
      comments: [],
    };
    const nextItems = [newItem, ...(stateRef.current?.items ?? [])];
    setItems(nextItems);
    setIsListingModalOpen(false);
    recordInventoryMovement(newItem, 'IN', inventoryQuantity, newItem.isDemo ? 'デモカタログ登録' : '新規出品');
    return success(cloneItem(newItem), bumpStateVersion({ items: nextItems }));
  };

  const addComment = (itemId: string, text: string): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('コメントするにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, 'コメントするにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    const normalizedText = text.trim();
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (target.isSold) return failure('ALREADY_SOLD', stateVersionRef.current, '売り切れの商品にはコメントできません');
    if (!normalizedText) return failure('INVALID_INPUT', stateVersionRef.current, 'コメントを入力してください');
    const newComment = { id: createId('comment'), userName: user.name, userAvatar: user.avatar, text: normalizedText, date: 'たった今' };
    const nextItems = (stateRef.current?.items ?? []).map((item) => item.id === itemId ? { ...item, comments: [...item.comments, newComment] } : item);
    setItems(nextItems);
    return success(undefined, bumpStateVersion({ items: nextItems }));
  };

  const openNotification = (notificationId: string) => {
    if (!notifications.some((notification) => notification.id === notificationId)) return;
    setNotifications((previous) => previous.map((notification) => notification.id === notificationId ? { ...notification, isRead: true } : notification));
    setActiveNotificationId(notificationId);
  };
  const setActiveNotification = (notification: NotificationItem | null) => notification ? openNotification(notification.id) : setActiveNotificationId(null);
  const setSelectedItem = (item: MercariItem | null) => item ? openItem(item.id) : closeItem();
  const setBuyingItem = (item: MercariItem | null) => item ? startPurchase(item.id) : setBuyingItemId(null);

  const getSnapshot = (): MercariAgentSnapshot => ({
    ...(stateRef.current as MercariAgentSnapshot),
    searchHistory: [...(stateRef.current?.searchHistory ?? [])],
    recentlyViewedIds: [...(stateRef.current?.recentlyViewedIds ?? [])],
    savedItemIds: [...(stateRef.current?.savedItemIds ?? [])],
    items: cloneItems(stateRef.current?.items ?? []),
    inventoryMovements: inventoryMovementsRef.current.slice(-100).map((movement) => ({ ...movement })),
  });

  const runAgentAction = <T,>(action: string, payload: unknown, options: AgentActionOptions | undefined, operation: () => ActionResult<T>): ActionResult<T> => {
    const idempotencyKey = options?.idempotencyKey ?? options?.requestId;
    const cached = idempotencyKey ? idempotencyCacheRef.current.get(idempotencyKey) : undefined;
    if (cached) return cached as ActionResult<T>;
    const result = operation();
    actionTraceRef.current = [...actionTraceRef.current.slice(-99), { action, requestId: options?.requestId, idempotencyKey: options?.idempotencyKey, payload, result: result as ActionResult<unknown>, at: new Date().toISOString() }];
    if (idempotencyKey) idempotencyCacheRef.current.set(idempotencyKey, result as ActionResult<unknown>);
    return result;
  };

  const searchItems = (query: string) => {
    return searchCatalogItems(stateRef.current?.items ?? [], query).map(cloneItem);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const api: MercariAgentAPI = {
      navigateTab: (tab, options) => runAgentAction('navigateTab', { tab }, options, () => { navigateToTab(tab); return success(undefined, bumpStateVersion()); }),
      navigateHomeSubTab: (tab, options) => runAgentAction('navigateHomeSubTab', { tab }, options, () => { navigateToTab('home'); setHomeTab(tab); return success(undefined, bumpStateVersion()); }),
      navigateCategory: (category, options) => runAgentAction('navigateCategory', { category }, options, () => openCategory(category)),
      search: (query, options) => runAgentAction('search', { query }, options, () => {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return failure('INVALID_INPUT', stateVersionRef.current);
        setIsSearchOpen(true);
        setSearchQuery(normalizedQuery);
        addSearchHistory(normalizedQuery);
        return success(undefined, bumpStateVersion({ searchQuery: normalizedQuery, selectedItemId: null, buyingItemId: null }));
      }),
      openItem: (itemId, options) => runAgentAction('openItem', { itemId }, options, () => openItem(itemId)),
      closeItem: (options) => runAgentAction('closeItem', {}, options, () => { closeItem(); return success(undefined, bumpStateVersion()); }),
      setLiked: (itemId, liked, options) => runAgentAction('setLiked', { itemId, liked }, options, () => setLiked(itemId, liked)),
      likeItem: (itemId, options) => runAgentAction('likeItem', { itemId, liked: true }, options, () => setLiked(itemId, true)),
      setSaved: (itemId, saved, options) => runAgentAction('setSaved', { itemId, saved }, options, () => setSaved(itemId, saved)),
      listItem: (item, options) => runAgentAction('listItem', item, options, () => addNewItem(item)),
      createListingDraft: (item, options) => runAgentAction('createListingDraft', item, options, () => { const draftId = createId('draft'); listingDraftsRef.current.set(draftId, { ...item }); return success({ draftId }, bumpStateVersion()); }),
      submitListing: (draftId, options) => runAgentAction('submitListing', { draftId }, options, () => { const draft = listingDraftsRef.current.get(draftId); if (!draft) return failure('DRAFT_NOT_FOUND', stateVersionRef.current); const result = addNewItem(draft); if (!result.ok) return failure(result.error, result.stateVersion, result.message); listingDraftsRef.current.delete(draftId); return success({ itemId: result.data.id }, result.stateVersion); }),
      startPurchase: (itemId, options) => runAgentAction('startPurchase', { itemId }, options, () => startPurchase(itemId)),
      confirmPurchase: (itemId, options) => runAgentAction('confirmPurchase', { itemId }, options, () => purchaseItem(itemId)),
      placeBid: (itemId, amount, options) => runAgentAction('placeBid', { itemId, amount }, options, () => placeBid(itemId, amount)),
      buyItem: (itemId, options) => runAgentAction('buyItem', { itemId }, options, () => startPurchase(itemId)),
      getSnapshot,
      getItems: () => cloneItems(stateRef.current?.items ?? []),
      getItem: (itemId) => { const item = stateRef.current?.items.find((candidate) => candidate.id === itemId); return item ? success(cloneItem(item), stateVersionRef.current) : failure('ITEM_NOT_FOUND', stateVersionRef.current); },
      searchItems,
      getState: getSnapshot,
      getActionTrace: () => actionTraceRef.current.map((entry) => ({ ...entry })),
      getInventoryMovements: (itemId) => inventoryMovementsRef.current
        .filter((movement) => !itemId || movement.itemId === itemId)
        .map((movement) => ({ ...movement })),
      resetScenario: (options) => runAgentAction('resetScenario', {}, options, () => {
        const resetItems = createInitialItems();
        setItems(resetItems);
        setNotifications(cloneNotifications(INITIAL_NOTIFICATIONS));
        navigateToTab('home');
        setHomeTab('recommend');
        setSearchQuery('');
        setSearchHistory([...INITIAL_SEARCH_HISTORY]);
        setActiveNotificationId(null);
        setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]);
        setSavedItemIds([]);
        listingDraftsRef.current.clear();
        inventoryMovementsRef.current = createInitialInventoryMovements();
        if (typeof window !== 'undefined') window.localStorage.removeItem(INVENTORY_STORAGE_KEY);
        idempotencyCacheRef.current.clear();
        actionTraceRef.current = [];
        return success(undefined, bumpStateVersion({
          currentMainTab: 'home',
          currentHomeTab: 'recommend',
          currentCategory: null,
          searchQuery: '',
          selectedItemId: null,
          buyingItemId: null,
          searchHistory: [...INITIAL_SEARCH_HISTORY],
          recentlyViewedIds: [...INITIAL_RECENTLY_VIEWED_IDS],
          savedItemIds: [],
          items: resetItems,
        }));
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

    return <MercariContext.Provider value={{ isAuthenticated, isLoginPromptOpen, loginPromptReason, requestLogin, closeLoginPrompt, mainTab, setMainTab, homeTab, setHomeTab, navigateToTab, categoryName, setCategoryName, openCategory, isSearchOpen, setIsSearchOpen, searchQuery, setSearchQuery, searchHistory, addSearchHistory, clearSearchHistory, selectedItemId, setSelectedItemId, selectedItem, setSelectedItem, openItem, closeItem, buyingItemId, setBuyingItemId, buyingItem, setBuyingItem, startPurchase, purchaseItem, placeBid, isPurchaseCompleteOpen, setIsPurchaseCompleteOpen, isListingModalOpen, setIsListingModalOpen, items, toggleLikeItem, setLiked, setSaved, addNewItem, addComment, recentlyViewedIds, savedItemIds, user, notifications, activeNotification, openNotification, setActiveNotification, isDeviceFrame, setIsDeviceFrame }}>{children}</MercariContext.Provider>;
};

export const useMercari = () => {
  const context = useContext(MercariContext);
  if (!context) throw new Error('useMercari must be used within a MercariProvider');
  return context;
};
