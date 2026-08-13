'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  AgentErrorCode,
  ActionResult,
  ActionTraceEntry,
  AgentActionOptions,
  HomeTab,
  MainTab,
  MercariAgentAPI,
  MercariAgentSnapshot,
  MercariItem,
  NotificationItem,
  SandboxActivityEntry,
  SandboxPersona,
  UserProfile,
} from '../types/mercari';
import { INITIAL_ITEMS, INITIAL_NOTIFICATIONS, SANDBOX_PERSONAS } from '../data/initialData';
import { createMarketplaceState, deriveTransactionPhase, MarketplaceDomain } from '../domain/marketplace';
import type { DomainErrorCode, MarketplaceState, ShipmentStatus, Transaction } from '../domain/marketplace';
import { useSandboxRuntime, type SandboxMode, type SandboxRuntimeState } from '../hooks/useSandboxRuntime';

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

const createInitialMarketplaceState = (): MarketplaceState => {
  const initialState = createMarketplaceState(INITIAL_ITEMS, SANDBOX_PERSONAS[0], SANDBOX_PERSONAS);
  const domain = new MarketplaceDomain(initialState);
  const starterListing = initialState.listings.find((listing) => listing.itemId === 'item-2');
  if (starterListing) {
    const checkout = domain.createCheckout({ buyerId: initialState.currentUserId, listingId: starterListing.id });
    if (checkout.ok) domain.confirmPurchase(checkout.data.id);
  }
  return domain.getState();
};

const buildSandboxPersonas = (state: MarketplaceState): SandboxPersona[] => SANDBOX_PERSONAS.flatMap((seed) => {
  const user = state.users.find((candidate) => candidate.id === seed.id);
  if (!user) return [];
  return [{
    id: user.id,
    name: user.displayName,
    avatar: user.avatar,
    bio: seed.bio,
    role: seed.role,
    accent: seed.accent,
    rating: user.ratingSummary.average,
    ratingsCount: user.ratingSummary.count,
    isVerified: user.identityVerificationStatus === 'VERIFIED',
    salesBalance: user.salesBalance,
    points: user.points,
    listingsCount: state.listings.filter((listing) => listing.sellerId === user.id).length,
    activeTransactionsCount: state.transactions.filter((transaction) => transaction.transactionStatus === 'ACTIVE' && [transaction.buyerId, transaction.sellerId].includes(user.id)).length,
    pendingTasksCount: state.tasks.filter((task) => task.userId === user.id && !task.completedAt).length,
  }];
});

const activityCopy: Record<string, string> = {
  PURCHASED: '商品を購入しました',
  PAYMENT_COMPLETED: '支払いを完了しました',
  SHIPPED: '商品を発送しました',
  DELIVERED: '商品が配達されました',
  ADDRESS_CHANGED: '配送先を変更しました',
  BUYER_RATED: '受取評価をしました',
  SELLER_RATED: '購入者を評価しました',
  COMPLETED: '取引が完了しました',
  CANCELED: '取引をキャンセルしました',
};

const buildSandboxActivity = (state: MarketplaceState, limit = 20): SandboxActivityEntry[] => [...state.transactionEvents]
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  .slice(0, limit)
  .map((event) => {
    const transaction = state.transactions.find((candidate) => candidate.id === event.transactionId);
    const listing = transaction && state.listings.find((candidate) => candidate.id === transaction.listingId);
    const item = listing && state.items.find((candidate) => candidate.id === listing.itemId);
    const actor = state.users.find((candidate) => candidate.id === event.actorId);
    return {
      id: event.id,
      type: event.type,
      title: activityCopy[event.type] ?? event.type,
      description: item?.title ?? '取引商品',
      actorId: event.actorId,
      actorName: actor?.displayName ?? 'システム',
      transactionId: event.transactionId,
      at: event.createdAt,
    };
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
  marketplaceState: MarketplaceState;
  transactions: Transaction[];
  transactionPhase: (transactionId: string) => string | null;
  completePayment: (transactionId: string) => ActionResult<undefined>;
  markAsShipped: (transactionId: string) => ActionResult<undefined>;
  updateShipmentStatus: (transactionId: string, status: ShipmentStatus) => ActionResult<undefined>;
  rateTransaction: (transactionId: string, rating: number, comment?: string) => ActionResult<undefined>;
  updateCheckout: (itemId: string, paymentLabel: string) => ActionResult<undefined>;
  pauseListing: (listingId: string) => ActionResult<undefined>;
  resumeListing: (listingId: string) => ActionResult<undefined>;
  deleteListing: (listingId: string) => ActionResult<undefined>;
  personas: SandboxPersona[];
  activePersona: SandboxPersona;
  switchPersona: (userId: string) => ActionResult<SandboxPersona>;
  sandboxActivity: SandboxActivityEntry[];
  isSandboxPanelOpen: boolean;
  setIsSandboxPanelOpen: (open: boolean) => void;
  isSandboxConsoleOpen: boolean;
  setIsSandboxConsoleOpen: (open: boolean) => void;
  sandboxMode: SandboxMode;
  setSandboxMode: (mode: SandboxMode) => void;
  sandboxState: SandboxRuntimeState;
  stepSimulation: () => Promise<SandboxRuntimeState>;
  setSimulationPlaying: (playing: boolean) => SandboxRuntimeState;
  setSimulationSpeed: (speed: number) => SandboxRuntimeState;
  runBuyerAgent: (goal: string) => unknown;
  confirmAgentRun: (runId: string) => unknown;
  resetSimulation: () => unknown;
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
  const [domain] = useState(() => new MarketplaceDomain(createInitialMarketplaceState()));
  const domainRef = useRef(domain);
  const [domainRevision, setDomainRevision] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => cloneNotifications(INITIAL_NOTIFICATIONS));
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(INITIAL_RECENTLY_VIEWED_IDS);
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);
  const [isPreferencesHydrated, setIsPreferencesHydrated] = useState(false);
  const [isDeviceFrame, setIsDeviceFrame] = useState(false);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [loginPromptReason, setLoginPromptReason] = useState('Furima Sandboxはログイン不要のモックモードです。');
  const [isSandboxPanelOpen, setIsSandboxPanelOpen] = useState(false);
  // This is intentionally always enabled: the site is a self-contained demo, so every mock action is available without an external account.
  const isAuthenticated = true;

  const stateVersionRef = useRef(0);
  const actionTraceRef = useRef<ActionTraceEntry[]>([]);
  const idempotencyCacheRef = useRef(new Map<string, ActionResult<unknown>>());
  const listingDraftsRef = useRef(new Map<string, Partial<MercariItem>>());
  const checkoutIdsRef = useRef(new Map<string, string>());
  const purchasedItemIdsRef = useRef(new Set<string>());
  const stateRef = useRef<MercariAgentSnapshot | null>(null);

  const marketplaceState = domain.getState();
  const personas = buildSandboxPersonas(marketplaceState);
  const activePersona = personas.find((persona) => persona.id === marketplaceState.currentUserId) ?? personas[0]!;
  const activeSeed = SANDBOX_PERSONAS.find((persona) => persona.id === marketplaceState.currentUserId) ?? SANDBOX_PERSONAS[0];
  const activeDomainUser = marketplaceState.users.find((candidate) => candidate.id === marketplaceState.currentUserId);
  const user: UserProfile = {
    name: activeDomainUser?.displayName ?? activeSeed.name,
    avatar: activeDomainUser?.avatar ?? activeSeed.avatar,
    rating: activeDomainUser?.ratingSummary.average ?? activeSeed.rating,
    ratingsCount: activeDomainUser?.ratingSummary.count ?? activeSeed.ratingsCount,
    isVerified: activeDomainUser?.identityVerificationStatus === 'VERIFIED',
    salesBalance: activeDomainUser?.salesBalance ?? activeSeed.salesBalance,
    points: activeDomainUser?.points ?? activeSeed.points,
    hasDPointLinked: activeSeed.hasDPointLinked,
  };
  const sandboxActivity = buildSandboxActivity(marketplaceState);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const buyingItem = items.find((item) => item.id === buyingItemId) ?? null;
  const activeNotification = notifications.find((item) => item.id === activeNotificationId) ?? null;

  const syncDomain = () => {
    const domain = domainRef.current;
    if (!domain) return;
    const domainState = domain.getState();
    stateVersionRef.current = Math.max(stateVersionRef.current, domainState.stateVersion);
    setItems(domain.getLegacyItems().map((item) => ({ ...item, isLiked: Boolean(item.isLiked) })));
    const savedListingIds = new Set(domainState.savedItems.filter((saved) => saved.userId === domainState.currentUserId).map((saved) => saved.listingId));
    setSavedItemIds(domainState.listings.filter((listing) => savedListingIds.has(listing.id)).map((listing) => listing.itemId));
    const generatedNotifications = domain.getNotifications().map((notification) => ({ id: notification.id, type: 'you' as const, title: notification.title, date: 'たった今', isRead: notification.isRead, content: notification.content }));
    const fixtureNotifications = domainState.currentUserId === SANDBOX_PERSONAS[0].id ? cloneNotifications(INITIAL_NOTIFICATIONS) : [];
    setNotifications([...generatedNotifications, ...fixtureNotifications.filter((notification) => !generatedNotifications.some((generated) => generated.id === notification.id))].slice(0, 50));
    setDomainRevision((previous) => previous + 1);
  };

  const resetDomainForSimulation = () => {
    listingDraftsRef.current.clear();
    checkoutIdsRef.current.clear();
    purchasedItemIdsRef.current.clear();
    idempotencyCacheRef.current.clear();
    actionTraceRef.current = [];
    setNotifications(cloneNotifications(INITIAL_NOTIFICATIONS));
    setMainTab('home');
    setHomeTabState('recommend');
    setSearchQuery('');
    setSearchHistory([...INITIAL_SEARCH_HISTORY]);
    setSelectedItemId(null);
    setBuyingItemId(null);
    setActiveNotificationId(null);
    setRecentlyViewedIds([...INITIAL_RECENTLY_VIEWED_IDS]);
    setSavedItemIds([]);
    setIsSandboxPanelOpen(false);
    syncDomain();
  };

  const sandboxRuntime = useSandboxRuntime({
    domain,
    domainRevision,
    onDomainChange: syncDomain,
    resetDomain: resetDomainForSimulation,
  });

  useEffect(() => {
    syncDomain();
  }, []);

  const mapDomainError = (error: DomainErrorCode): AgentErrorCode => {
    if (error === 'LISTING_NOT_FOUND' || error === 'ITEM_NOT_FOUND') return 'ITEM_NOT_FOUND';
    if (error === 'LISTING_UNAVAILABLE') return 'LISTING_UNAVAILABLE';
    if (error === 'LISTING_VERSION_CONFLICT') return 'LISTING_VERSION_CONFLICT';
    if (error === 'CANNOT_PURCHASE_OWN_LISTING') return 'CANNOT_PURCHASE_OWN_LISTING';
    if (error === 'USER_BLOCKED') return 'USER_BLOCKED';
    if (error === 'PAYMENT_NOT_COMPLETED') return 'PAYMENT_NOT_COMPLETED';
    if (error === 'RATING_NOT_ALLOWED') return 'RATING_NOT_ALLOWED';
    if (error === 'INVALID_TRANSITION') return 'INVALID_INPUT';
    if (error === 'AUCTION_CLOSED') return 'ALREADY_SOLD';
    if (error === 'NOT_AUCTION') return 'NOT_AUCTION';
    if (error === 'BID_TOO_LOW') return 'BID_TOO_LOW';
    if (error === 'USER_NOT_FOUND') return 'USER_NOT_FOUND';
    if (error === 'PERMISSION_DENIED') return 'PERMISSION_DENIED';
    return 'INVALID_INPUT';
  };

  const switchPersona = (userId: string): ActionResult<SandboxPersona> => {
    const result = domainRef.current.switchCurrentUser(userId);
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    setSelectedItemId(null);
    setBuyingItemId(null);
    setIsSearchOpenState(false);
    setIsListingModalOpenState(false);
    setActiveNotificationId(null);
    checkoutIdsRef.current.clear();
    purchasedItemIdsRef.current.clear();
    syncDomain();
    sandboxRuntime.recordHumanAction('session.persona_switched', userId);
    const persona = buildSandboxPersonas(domainRef.current.getState()).find((candidate) => candidate.id === userId);
    if (!persona) return failure('USER_NOT_FOUND', result.stateVersion, '切り替え先のペルソナが見つかりません');
    return success(persona, result.stateVersion);
  };

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
    const currentPersonas = buildSandboxPersonas(domainRef.current.getState());
    stateRef.current = {
      version: '1',
      stateVersion: stateVersionRef.current,
      currentUserId: marketplaceState.currentUserId,
      personas: currentPersonas,
      activeTransactionsCount: marketplaceState.transactions.filter((transaction) => transaction.transactionStatus === 'ACTIVE').length,
      openTasksCount: marketplaceState.tasks.filter((task) => !task.completedAt).length,
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
  }, [mainTab, homeTab, categoryName, searchQuery, selectedItemId, buyingItemId, searchHistory, recentlyViewedIds, savedItemIds, items, domainRevision, marketplaceState.currentUserId, marketplaceState.transactions, marketplaceState.tasks]);

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
    const domain = domainRef.current;
    if (domain) {
      const listingResult = domain.likeListing(target.listingId ?? `listing-${itemId}`, domain.getState().currentUserId, liked);
      if (!listingResult.ok) return failure(mapDomainError(listingResult.error), listingResult.stateVersion, listingResult.message);
    }
    setItems((previous) => previous.map((item) => item.id !== itemId ? item : ({
      ...item,
      isLiked: liked,
      likesCount: liked ? item.likesCount + 1 : Math.max(0, item.likesCount - 1),
    })));
    sandboxRuntime.recordHumanAction(liked ? 'product.liked' : 'product.unliked', target.listingId ?? `listing-${itemId}`, { itemId });
    return success(undefined, domain?.getState().stateVersion ?? bumpStateVersion());
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
    const domain = domainRef.current;
    if (domain) {
      const savedResult = domain.saveListing(target.listingId ?? `listing-${itemId}`, domain.getState().currentUserId, saved);
      if (!savedResult.ok) return failure(mapDomainError(savedResult.error), savedResult.stateVersion, savedResult.message);
    }
    setSavedItemIds((previous) => saved ? [...previous, itemId] : previous.filter((id) => id !== itemId));
    sandboxRuntime.recordHumanAction(saved ? 'product.saved' : 'product.unsaved', target.listingId ?? `listing-${itemId}`, { itemId });
    return success(undefined, domain?.getState().stateVersion ?? bumpStateVersion());
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
    sandboxRuntime.recordHumanAction('product.viewed', target.listingId ?? `listing-${itemId}`, { itemId });
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
    if (target.isAuction) {
      setIsSearchOpenState(false);
      setBuyingItemId(itemId);
      return success(undefined, bumpStateVersion());
    }
    const listingId = target.listingId ?? `listing-${itemId}`;
    const checkout = domainRef.current?.createCheckout({ buyerId: domainRef.current.getState().currentUserId, listingId });
    if (!checkout) return failure('INVALID_INPUT', stateVersionRef.current, '購入手続きを開始できません');
    if (!checkout.ok) return failure(mapDomainError(checkout.error), checkout.stateVersion, checkout.message);
    checkoutIdsRef.current.set(itemId, checkout.data.id);
    setIsSearchOpenState(false);
    setBuyingItemId(itemId);
    return success(undefined, checkout.stateVersion);
  };

  const purchaseItem = (itemId: string): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('購入・入札するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '購入・入札するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (target.isSold || purchasedItemIdsRef.current.has(itemId)) return failure('ALREADY_SOLD', stateVersionRef.current, 'この商品はすでに売り切れています');
    if (target.isAuction) return failure('NOT_AUCTION', stateVersionRef.current, 'オークション商品は入札で購入します');
    const domain = domainRef.current;
    if (!domain) return failure('INVALID_INPUT', stateVersionRef.current, '購入処理を開始できません');
    let checkoutId = checkoutIdsRef.current.get(itemId);
    if (!checkoutId) {
      const checkout = domain.createCheckout({ buyerId: domain.getState().currentUserId, listingId: target.listingId ?? `listing-${itemId}` });
      if (!checkout.ok) return failure(mapDomainError(checkout.error), checkout.stateVersion, checkout.message);
      checkoutId = checkout.data.id;
      checkoutIdsRef.current.set(itemId, checkoutId);
    }
    const confirmed = sandboxRuntime.confirmHumanCheckout(checkoutId);
    if (!confirmed.ok) {
      const error = confirmed.error === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : mapDomainError(confirmed.error as DomainErrorCode);
      return failure(error, domain.getState().stateVersion, confirmed.error === 'INSUFFICIENT_FUNDS' ? 'Market Creditsが不足しています' : confirmed.error);
    }
    purchasedItemIdsRef.current.add(itemId);
    syncDomain();
    return success(undefined, domain.getState().stateVersion);
  };

  const placeBid = (itemId: string, amount: number): ActionResult<{ currentBid: number; bidsCount: number }> => {
    if (!isAuthenticated) {
      requestLogin('購入・入札するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '購入・入札するにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (!target.isAuction) return failure('NOT_AUCTION', stateVersionRef.current, 'この商品はオークション商品ではありません');
    const domain = domainRef.current;
    const listingId = target.listingId ?? `listing-${itemId}`;
    const auction = domain?.getState().auctions.find((value) => value.listingId === listingId);
    if (!domain || !auction) return failure('NOT_AUCTION', stateVersionRef.current, 'オークション情報が見つかりません');
    const result = domain.placeBid(auction.id, domain.getState().currentUserId, amount);
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    const bidsCount = domain.getState().bids.filter((bid) => bid.auctionId === auction.id).length;
    return success({ currentBid: result.data.amount, bidsCount }, result.stateVersion);
  };

  const addNewItem = (newItemData: Partial<MercariItem>): ActionResult<MercariItem> => {
    if (!isAuthenticated) {
      requestLogin('出品を確定するにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, '出品を確定するにはログインが必要です。');
    }
    const title = newItemData.title?.trim() ?? '';
    const price = newItemData.price ?? 1000;
    if (!title || !Number.isInteger(price) || price < 300 || price > 9_999_999) return failure('INVALID_INPUT', stateVersionRef.current, 'タイトルと価格を入力してください（価格は300円〜9,999,999円）');
    const domain = domainRef.current;
    if (!domain) return failure('INVALID_INPUT', stateVersionRef.current, '出品処理を開始できません');
    const draft = domain.addListingDraft(domain.getState().currentUserId, {
      item: { title, description: newItemData.description?.trim() || 'Furima Sandboxで見つけてもらえる、すてきな商品です。', condition: 'GOOD' },
      categoryId: newItemData.category?.[0] || 'その他',
      price,
      saleType: newItemData.isAuction ? 'AUCTION' : 'FIXED_PRICE',
      shippingPayer: newItemData.shippingFee?.includes('購入者') ? 'BUYER' : 'SELLER',
      shippingMethod: newItemData.shippingMethod?.includes('郵便') ? 'POST' : 'MERCARI_STANDARD',
      shippingOrigin: newItemData.origin || '東京都',
      shippingDays: Number(newItemData.shippingDays?.match(/\d+/)?.[0] ?? 2),
      packageSize: 'MEDIUM',
      isAnonymous: true,
      images: newItemData.images?.length ? [...newItemData.images] : ['/images/products/knit.jpg'],
    });
    if (!draft.ok) return failure(mapDomainError(draft.error), draft.stateVersion, draft.message);
    const published = domain.publishListing(draft.data.id);
    if (!published.ok) return failure(mapDomainError(published.error), published.stateVersion, published.message);
    syncDomain();
    const newItem = domain.getLegacyItems().find((item) => item.id === draft.data.itemId);
    if (!newItem) return failure('ITEM_NOT_FOUND', published.stateVersion, '出品商品を生成できませんでした');
    setIsListingModalOpen(false);
    sandboxRuntime.recordHumanAction('listing.published', published.data.id, { itemId: draft.data.itemId, price });
    return success(cloneItem(newItem), published.stateVersion);
  };

  const addComment = (itemId: string, text: string): ActionResult<undefined> => {
    if (!isAuthenticated) {
      requestLogin('コメントするにはログインが必要です。');
      return failure('AUTH_REQUIRED', stateVersionRef.current, 'コメントするにはログインが必要です。');
    }
    const target = stateRef.current?.items.find((item) => item.id === itemId);
    const normalizedText = text.trim();
    if (!target) return failure('ITEM_NOT_FOUND', stateVersionRef.current);
    if (!normalizedText) return failure('INVALID_INPUT', stateVersionRef.current, 'コメントを入力してください');
    const domain = domainRef.current;
    if (!domain) return failure('INVALID_INPUT', stateVersionRef.current, 'コメント処理を開始できません');
    const result = domain.addListingComment(target.listingId ?? `listing-${itemId}`, domain.getState().currentUserId, normalizedText);
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    sandboxRuntime.recordHumanAction('listing.commented', target.listingId ?? `listing-${itemId}`, { itemId });
    return success(undefined, result.stateVersion);
  };

  const completePayment = (transactionId: string): ActionResult<undefined> => {
    const result = domainRef.current?.completePayment(transactionId);
    if (!result) return failure('INVALID_INPUT', stateVersionRef.current, '支払い処理を開始できません');
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    sandboxRuntime.syncSandbox('human');
    return success(undefined, result.stateVersion);
  };
  const updateCheckout = (itemId: string, paymentLabel: string): ActionResult<undefined> => {
    const domain = domainRef.current;
    const checkoutId = checkoutIdsRef.current.get(itemId);
    if (!domain || !checkoutId) return failure('CHECKOUT_NOT_FOUND', stateVersionRef.current, '購入手続きが見つかりません');
    const state = domain.getState();
    const checkout = state.checkouts.find((candidate) => candidate.id === checkoutId);
    const paymentMethod = state.paymentMethods.find((method) => method.userId === checkout?.buyerId && (paymentLabel.includes('コンビニ') ? method.type === 'CONVENIENCE_STORE' : paymentLabel.includes('残高') ? method.type === 'BALANCE' : method.type === 'CREDIT_CARD'));
    if (!paymentMethod) return failure('INVALID_INPUT', stateVersionRef.current, '支払い方法が見つかりません');
    const result = domain.updateCheckout(checkoutId, { paymentMethodId: paymentMethod.id });
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    return success(undefined, result.stateVersion);
  };
  const markAsShipped = (transactionId: string): ActionResult<undefined> => {
    const result = domainRef.current?.markAsShipped(transactionId);
    if (!result) return failure('INVALID_INPUT', stateVersionRef.current, '発送処理を開始できません');
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    sandboxRuntime.syncSandbox('human');
    return success(undefined, result.stateVersion);
  };
  const updateShipmentStatus = (transactionId: string, status: ShipmentStatus): ActionResult<undefined> => {
    const result = domainRef.current?.updateShipmentStatus(transactionId, status);
    if (!result) return failure('INVALID_INPUT', stateVersionRef.current, '配送処理を開始できません');
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    sandboxRuntime.syncSandbox('system');
    return success(undefined, result.stateVersion);
  };
  const rateTransaction = (transactionId: string, rating: number, comment = ''): ActionResult<undefined> => {
    const domain = domainRef.current;
    if (!domain) return failure('INVALID_INPUT', stateVersionRef.current, '評価処理を開始できません');
    const state = domain.getState();
    const transaction = state.transactions.find((value) => value.id === transactionId);
    const result = transaction ? domain.rateTransaction(transactionId, state.currentUserId, rating, comment) : undefined;
    if (!result) return failure('INVALID_INPUT', stateVersionRef.current, '評価処理を開始できません');
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    sandboxRuntime.syncSandbox('human');
    return success(undefined, result.stateVersion);
  };
  const pauseListing = (listingId: string): ActionResult<undefined> => {
    const result = domainRef.current?.pauseListing(listingId);
    if (!result) return failure('INVALID_INPUT', stateVersionRef.current, '公開停止処理を開始できません');
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    return success(undefined, result.stateVersion);
  };
  const resumeListing = (listingId: string): ActionResult<undefined> => {
    const result = domainRef.current?.resumeListing(listingId);
    if (!result) return failure('INVALID_INPUT', stateVersionRef.current, '再公開処理を開始できません');
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    return success(undefined, result.stateVersion);
  };
  const deleteListing = (listingId: string): ActionResult<undefined> => {
    const result = domainRef.current?.deleteListing(listingId);
    if (!result) return failure('INVALID_INPUT', stateVersionRef.current, '削除処理を開始できません');
    if (!result.ok) return failure(mapDomainError(result.error), result.stateVersion, result.message);
    syncDomain();
    return success(undefined, result.stateVersion);
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
    const actorId = domainRef.current.getState().currentUserId;
    const result = operation();
    actionTraceRef.current = [...actionTraceRef.current.slice(-99), { action, actorId, requestId: options?.requestId, idempotencyKey: options?.idempotencyKey, payload, result: result as ActionResult<unknown>, at: new Date().toISOString() }];
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
      switchPersona: (userId, options) => runAgentAction('switchPersona', { userId }, options, () => switchPersona(userId)),
      getPersonas: () => buildSandboxPersonas(domainRef.current.getState()),
      getWorldState: () => ({
        exportedAt: new Date().toISOString(),
        marketplace: domainRef.current.getState(),
        ui: getSnapshot(),
        actionTrace: actionTraceRef.current.map((entry) => ({ ...entry })),
      }),
      getActivity: (limit = 20) => buildSandboxActivity(domainRef.current.getState(), limit),
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
      completePayment: (transactionId, options) => runAgentAction('completePayment', { transactionId }, options, () => completePayment(transactionId)),
      markAsShipped: (transactionId, options) => runAgentAction('markAsShipped', { transactionId }, options, () => markAsShipped(transactionId)),
      advanceShipment: (transactionId, options) => runAgentAction('advanceShipment', { transactionId }, options, () => updateShipmentStatus(transactionId, 'DELIVERED')),
      rateTransaction: (transactionId, rating, comment = '', options) => runAgentAction('rateTransaction', { transactionId, rating, comment }, options, () => rateTransaction(transactionId, rating, comment)),
      buyItem: (itemId, options) => runAgentAction('buyItem', { itemId }, options, () => startPurchase(itemId)),
      getSnapshot,
      getItems: () => cloneItems(stateRef.current?.items ?? []),
      getItem: (itemId) => { const item = stateRef.current?.items.find((candidate) => candidate.id === itemId); return item ? success(cloneItem(item), stateVersionRef.current) : failure('ITEM_NOT_FOUND', stateVersionRef.current); },
      searchItems,
      getState: getSnapshot,
      getActionTrace: () => actionTraceRef.current.map((entry) => ({ ...entry })),
      resetScenario: (options) => runAgentAction('resetScenario', {}, options, () => { sandboxRuntime.resetSimulation(); return success(undefined, bumpStateVersion()); }),
    };
    window.__FURIMA_SANDBOX_API__ = api;
    window.__SHOP_API__ = api;
    window.__MERCARI_API__ = api;
    return () => {
      if (window.__FURIMA_SANDBOX_API__ === api) delete window.__FURIMA_SANDBOX_API__;
      if (window.__SHOP_API__ === api) delete window.__SHOP_API__;
      if (window.__MERCARI_API__ === api) delete window.__MERCARI_API__;
    };
    // The bridge is stable; mutable values are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    const transactions = marketplaceState.transactions.filter((transaction) => transaction.buyerId === marketplaceState.currentUserId || transaction.sellerId === marketplaceState.currentUserId);
    const transactionPhase = (transactionId: string) => { const transaction = marketplaceState.transactions.find((value) => value.id === transactionId); return transaction ? deriveTransactionPhase(transaction) : null; };
    return <MercariContext.Provider value={{ isAuthenticated, isLoginPromptOpen, loginPromptReason, requestLogin, closeLoginPrompt, mainTab, setMainTab, homeTab, setHomeTab, navigateToTab, categoryName, setCategoryName, openCategory, isSearchOpen, setIsSearchOpen, searchQuery, setSearchQuery, searchHistory, addSearchHistory, clearSearchHistory, selectedItemId, setSelectedItemId, selectedItem, setSelectedItem, openItem, closeItem, buyingItemId, setBuyingItemId, buyingItem, setBuyingItem, startPurchase, purchaseItem, placeBid, isPurchaseCompleteOpen, setIsPurchaseCompleteOpen, isListingModalOpen, setIsListingModalOpen, items, toggleLikeItem, setLiked, setSaved, addNewItem, addComment, marketplaceState, transactions, transactionPhase, completePayment, updateCheckout, markAsShipped, updateShipmentStatus, rateTransaction, pauseListing, resumeListing, deleteListing, personas, activePersona, switchPersona, sandboxActivity, isSandboxPanelOpen, setIsSandboxPanelOpen, isSandboxConsoleOpen: sandboxRuntime.isSandboxConsoleOpen, setIsSandboxConsoleOpen: sandboxRuntime.setIsSandboxConsoleOpen, sandboxMode: sandboxRuntime.sandboxMode, setSandboxMode: sandboxRuntime.setSandboxMode, sandboxState: sandboxRuntime.sandboxState, stepSimulation: sandboxRuntime.stepSimulation, setSimulationPlaying: sandboxRuntime.setSimulationPlaying, setSimulationSpeed: sandboxRuntime.setSimulationSpeed, runBuyerAgent: sandboxRuntime.runBuyerAgent, confirmAgentRun: sandboxRuntime.confirmAgentRun, resetSimulation: sandboxRuntime.resetSimulation, recentlyViewedIds, savedItemIds, user, notifications, activeNotification, openNotification, setActiveNotification, isDeviceFrame, setIsDeviceFrame }}>{children}</MercariContext.Provider>;
};

export const useMercari = () => {
  const context = useContext(MercariContext);
  if (!context) throw new Error('useMercari must be used within a MercariProvider');
  return context;
};
