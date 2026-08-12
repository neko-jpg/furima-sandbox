'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  ActionResult,
  ActionTraceEntry,
  AgentActionOptions,
  HomeTab,
  MainTab,
  MercariAgentAPI,
  MercariAgentSnapshot,
  MercariItem,
  NotificationItem,
  UserProfile,
} from '../types/mercari';
import { INITIAL_ITEMS, INITIAL_NOTIFICATIONS, INITIAL_USER } from '../data/initialData';

const PREFERENCES_STORAGE_KEY = 'shop-ui-preferences-v1';

interface PersistedPreferences {
  likedItemIds?: string[];
  searchHistory?: string[];
  recentlyViewedIds?: string[];
  savedItemIds?: string[];
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

const INITIAL_SEARCH_HISTORY = ['ゲーム・おもちゃ・グッズ', '本・雑誌・漫画', 'ファッション, メンズ', 'ノートPC', 'PC', 'ゲーム', '本・マンガ', 'ファッション'];
const INITIAL_RECENTLY_VIEWED_IDS = ['pc-2', 'pc-1', 'item-8', 'item-5', 'fashion-2', 'game-1'];

const cloneItem = (item: MercariItem): MercariItem => ({
  ...item,
  images: [...item.images],
  category: [...item.category],
  seller: { ...item.seller },
  comments: item.comments.map((comment) => ({ ...comment })),
});
const cloneItems = (items: MercariItem[]) => items.map(cloneItem);
const cloneNotifications = (items: NotificationItem[]) => items.map((item) => ({ ...item }));
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
  const [items, setItems] = useState<MercariItem[]>(() => cloneItems(INITIAL_ITEMS).map((item) => ({ ...item, isLiked: false })));
  const [user] = useState<UserProfile>(INITIAL_USER);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => cloneNotifications(INITIAL_NOTIFICATIONS));
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(INITIAL_RECENTLY_VIEWED_IDS);
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);
  const [isPreferencesHydrated, setIsPreferencesHydrated] = useState(false);
  const [isDeviceFrame, setIsDeviceFrame] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [loginPromptReason, setLoginPromptReason] = useState('この操作にはログインが必要です。');
  const isAuthenticated = false;

  const stateVersionRef = useRef(0);
  const actionTraceRef = useRef<ActionTraceEntry[]>([]);
  const idempotencyCacheRef = useRef(new Map<string, ActionResult<unknown>>());
  const listingDraftsRef = useRef(new Map<string, Partial<MercariItem>>());
  const purchasedItemIdsRef = useRef(new Set<string>());
  const stateRef = useRef<MercariAgentSnapshot | null>(null);

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
  };

  const setIsSearchOpen = (open: boolean) => {
    setIsSearchOpenState(open);
    if (open) {
      setSelectedItemId(null);
      setBuyingItemId(null);
      setIsListingModalOpenState(false);
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

  const bumpStateVersion = () => {
    stateVersionRef.current += 1;
    return stateVersionRef.current;
  };

  const addSearchHistory = (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;
    setSearchHistory((previous) => [normalizedQuery, ...previous.filter((item) => item !== normalizedQuery)].slice(0, 10));
  };
  const clearSearchHistory = () => setSearchHistory([]);

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
    return success(undefined, bumpStateVersion());
  };

  const setLiked = (itemId: string, liked: boolean): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('いいねするにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, 'いいねするにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (target.isLiked === liked) return success(undefined, stateVersionRef.current);
    setItems((previous) => previous.map((item) => item.id !== itemId ? item : ({
      ...item,
      isLiked: liked,
      likesCount: liked ? item.likesCount + 1 : Math.max(0, item.likesCount - 1),
    })));
    return success(undefined, bumpStateVersion());
  };

  const setSaved = (itemId: string, saved: boolean): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('商品を保存するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '商品を保存するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    const alreadySaved = savedItemIds.includes(itemId);
    if (alreadySaved === saved) return success(undefined, stateVersionRef.current);
    setSavedItemIds((previous) => saved ? [...previous, itemId] : previous.filter((id) => id !== itemId));
    return success(undefined, bumpStateVersion());
  };

  const toggleLikeItem = (itemId: string) => {
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (target) setLiked(itemId, !target.isLiked);
  };

  const openItem = (itemId: string): ActionResult<undefined> => {
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    setIsSearchOpenState(false);
    setBuyingItemId(null);
    setSelectedItemId(itemId);
    setRecentlyViewedIds((previous) => [itemId, ...previous.filter((id) => id !== itemId)].slice(0, 12));
    return success(undefined, bumpStateVersion());
  };
  const closeItem = () => setSelectedItemId(null);

  const startPurchase = (itemId: string): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('購入・入札するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '購入・入札するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (target.isSold || purchasedItemIdsRef.current.has(itemId)) return failure('ALREADY_SOLD', stateVersionRef.current, 'この商品は購入できません');
    setIsSearchOpenState(false);
    setBuyingItemId(itemId);
    return success(undefined, bumpStateVersion());
  };

  const purchaseItem = (itemId: string): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('購入・入札するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '購入・入札するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (target.isSold || purchasedItemIdsRef.current.has(itemId)) return failure('ALREADY_SOLD', stateVersionRef.current, 'この商品はすでに売り切れています');
    purchasedItemIdsRef.current.add(itemId);
    setItems((previous) => previous.map((item) => item.id === itemId ? { ...item, isSold: true } : item));
    return success(undefined, bumpStateVersion());
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
    setItems((previous) => previous.map((item) => item.id === itemId ? { ...item, currentBid: amount, bidsCount } : item));
    return success({ currentBid: amount, bidsCount }, bumpStateVersion());
  };

  const addNewItem = (newItemData: Partial<MercariItem>): ActionResult<MercariItem> => {
    if (!isAuthenticated) {
      requestLogin('出品を確定するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '出品を確定するにはログインが必要です。');
    }
    const title = newItemData.title?.trim() ?? '';
    const price = newItemData.price ?? 1000;
    if (!title || !Number.isInteger(price) || price < 300) return failure('INVALID_INPUT', stateVersionRef.current, 'タイトルと価格を入力してください');
    const newItem: MercariItem = {
      id: createId('item'),
      title,
      price,
      images: newItemData.images?.length ? [...newItemData.images] : ['/images/products/knit.jpg'],
      isSold: false,
      isAuction: newItemData.isAuction,
      currentBid: newItemData.currentBid,
      bidsCount: newItemData.bidsCount,
      timeLeft: newItemData.timeLeft,
      description: newItemData.description?.trim() || 'shopで見つけてもらえる、すてきな商品です。',
      category: newItemData.category?.length ? [...newItemData.category] : ['その他'],
      condition: newItemData.condition || '目立った傷や汚れなし',
      shippingFee: newItemData.shippingFee || '送料込み（出品者負担）',
      shippingMethod: newItemData.shippingMethod || 'ゆうゆう配送',
      origin: newItemData.origin || '東京都',
      shippingDays: newItemData.shippingDays || '1〜2日で発送',
      likesCount: 0,
      isLiked: false,
      seller: { name: user.name, avatar: user.avatar, rating: user.rating, ratingsCount: user.ratingsCount, isVerified: user.isVerified },
      comments: [],
    };
    setItems((previous) => [newItem, ...previous]);
    setIsListingModalOpen(false);
    return success(cloneItem(newItem), bumpStateVersion());
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
    setItems((previous) => previous.map((item) => item.id === itemId ? { ...item, comments: [...item.comments, newComment] } : item));
    return success(undefined, bumpStateVersion());
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
    const tokens = query.split(/[\s\u3000]+/u).map((token) => token.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) return [];
    return (stateRef.current?.items ?? []).filter((item) => {
      const searchable = `${item.title} ${item.description} ${item.category.join(' ')}`.toLowerCase();
      return tokens.every((token) => searchable.includes(token));
    }).map(cloneItem);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const api: MercariAgentAPI = {
      navigateTab: (tab, options) => runAgentAction('navigateTab', { tab }, options, () => { navigateToTab(tab); return success(undefined, bumpStateVersion()); }),
      navigateHomeSubTab: (tab, options) => runAgentAction('navigateHomeSubTab', { tab }, options, () => { navigateToTab('home'); setHomeTab(tab); return success(undefined, bumpStateVersion()); }),
      navigateCategory: (category, options) => runAgentAction('navigateCategory', { category }, options, () => openCategory(category)),
      search: (query, options) => runAgentAction('search', { query }, options, () => { if (!query.trim()) return failure('INVALID_INPUT', stateVersionRef.current); setIsSearchOpen(true); setSearchQuery(query.trim()); addSearchHistory(query); return success(undefined, bumpStateVersion()); }),
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
      resetScenario: (options) => runAgentAction('resetScenario', {}, options, () => { setItems(cloneItems(INITIAL_ITEMS).map((item) => ({ ...item, isLiked: false }))); setNotifications(cloneNotifications(INITIAL_NOTIFICATIONS)); navigateToTab('home'); setHomeTab('recommend'); setSearchQuery(''); setSearchHistory([...INITIAL_SEARCH_HISTORY]); setActiveNotificationId(null); setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]); setSavedItemIds([]); listingDraftsRef.current.clear(); purchasedItemIdsRef.current.clear(); idempotencyCacheRef.current.clear(); actionTraceRef.current = []; return success(undefined, bumpStateVersion()); }),
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
