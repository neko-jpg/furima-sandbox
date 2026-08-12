'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  MercariItem,
  NotificationItem,
  UserProfile,
  MainTab,
  HomeTab,
  MercariAgentAPI,
} from '../types/mercari';
import {
  INITIAL_ITEMS,
  INITIAL_NOTIFICATIONS,
  INITIAL_USER,
} from '../data/initialData';

interface MercariContextType {
  mainTab: MainTab;
  setMainTab: (tab: MainTab) => void;
  homeTab: HomeTab;
  setHomeTab: (tab: HomeTab) => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchHistory: string[];
  addSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;
  selectedItem: MercariItem | null;
  setSelectedItem: (item: MercariItem | null) => void;
  buyingItem: MercariItem | null;
  setBuyingItem: (item: MercariItem | null) => void;
  isPurchaseCompleteOpen: boolean;
  setIsPurchaseCompleteOpen: (open: boolean) => void;
  isListingModalOpen: boolean;
  setIsListingModalOpen: (open: boolean) => void;
  items: MercariItem[];
  toggleLikeItem: (itemId: string) => void;
  addNewItem: (item: Partial<MercariItem>) => void;
  addComment: (itemId: string, text: string) => void;
  user: UserProfile;
  notifications: NotificationItem[];
  activeNotification: NotificationItem | null;
  setActiveNotification: (n: NotificationItem | null) => void;
  isDeviceFrame: boolean;
  setIsDeviceFrame: (frame: boolean) => void;
}

const MercariContext = createContext<MercariContextType | undefined>(undefined);

export const MercariProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mainTab, setMainTab] = useState<MainTab>('home');
  const [homeTab, setHomeTab] = useState<HomeTab>('recommend');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([
    'ファッション, メンズ',
    '本・雑誌・漫画',
    'ゲーム・おもちゃ・グッズ',
    'ノートPC',
    'PC',
  ]);
  const [selectedItem, setSelectedItem] = useState<MercariItem | null>(null);
  const [buyingItem, setBuyingItem] = useState<MercariItem | null>(null);
  const [isPurchaseCompleteOpen, setIsPurchaseCompleteOpen] = useState(false);
  const [isListingModalOpen, setIsListingModalOpen] = useState(false);
  const [items, setItems] = useState<MercariItem[]>(INITIAL_ITEMS);
  const [user] = useState<UserProfile>(INITIAL_USER);
  const [notifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [activeNotification, setActiveNotification] = useState<NotificationItem | null>(null);
  const [isDeviceFrame, setIsDeviceFrame] = useState(true);

  const addSearchHistory = (q: string) => {
    if (!q.trim()) return;
    setSearchHistory((prev) => [q, ...prev.filter((item) => item !== q)].slice(0, 10));
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
  };

  const toggleLikeItem = (itemId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === itemId) {
          const isLiked = !item.isLiked;
          return {
            ...item,
            isLiked,
            likesCount: isLiked ? item.likesCount + 1 : item.likesCount - 1,
          };
        }
        return item;
      })
    );
    if (selectedItem && selectedItem.id === itemId) {
      setSelectedItem((prev) =>
        prev
          ? {
              ...prev,
              isLiked: !prev.isLiked,
              likesCount: !prev.isLiked ? prev.likesCount + 1 : prev.likesCount - 1,
            }
          : null
      );
    }
  };

  const addNewItem = (newItemData: Partial<MercariItem>) => {
    const newItem: MercariItem = {
      id: `item-${Date.now()}`,
      title: newItemData.title || '新規出品商品',
      price: newItemData.price || 1000,
      images: newItemData.images?.length
        ? newItemData.images
        : ['/images/01J7N72MFF8A03BNXT7TBDFNWT.png'],
      description: newItemData.description || '商品の説明文です。',
      category: newItemData.category || ['その他'],
      condition: newItemData.condition || '目立った傷や汚れなし',
      shippingFee: newItemData.shippingFee || '送料込み(出品者負担)',
      shippingMethod: newItemData.shippingMethod || 'らくらくメルカリ便 (匿名配送)',
      origin: newItemData.origin || '東京都',
      shippingDays: newItemData.shippingDays || '1~2日で発送',
      likesCount: 0,
      seller: {
        name: user.name,
        avatar: user.avatar,
        rating: user.rating,
        ratingsCount: user.ratingsCount,
        isVerified: user.isVerified,
      },
      comments: [],
    };
    setItems((prev) => [newItem, ...prev]);
    setIsListingModalOpen(false);
  };

  const addComment = (itemId: string, text: string) => {
    if (!text.trim()) return;
    const newComment = {
      id: `c-${Date.now()}`,
      userName: user.name,
      userAvatar: user.avatar,
      text,
      date: 'たった今',
    };
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === itemId) {
          return {
            ...item,
            comments: [...item.comments, newComment],
          };
        }
        return item;
      })
    );
    if (selectedItem && selectedItem.id === itemId) {
      setSelectedItem((prev) =>
        prev
          ? {
              ...prev,
              comments: [...prev.comments, newComment],
            }
          : null
      );
    }
  };

  // Expose global window.__MERCARI_API__ for hackathon AI agent integration
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const agentApi: MercariAgentAPI = {
        navigateTab: (tab: MainTab) => setMainTab(tab),
        navigateHomeSubTab: (tab: HomeTab) => {
          setMainTab('home');
          setHomeTab(tab);
        },
        search: (query: string) => {
          setIsSearchOpen(true);
          setSearchQuery(query);
          addSearchHistory(query);
        },
        openItem: (itemId: string) => {
          const target = items.find((i) => i.id === itemId);
          if (target) setSelectedItem(target);
        },
        closeItem: () => setSelectedItem(null),
        likeItem: (itemId: string) => toggleLikeItem(itemId),
        listItem: (itemData: Partial<MercariItem>) => addNewItem(itemData),
        buyItem: (itemId: string) => {
          const target = items.find((i) => i.id === itemId);
          if (target) {
            setBuyingItem(target);
          }
        },
        getState: () => ({
          currentMainTab: mainTab,
          currentHomeTab: homeTab,
          searchQuery,
          selectedItemId: selectedItem ? selectedItem.id : null,
          itemsCount: items.length,
        }),
      };
      window.__MERCARI_API__ = agentApi;
    }
  }, [mainTab, homeTab, searchQuery, selectedItem, items]);

  return (
    <MercariContext.Provider
      value={{
        mainTab,
        setMainTab,
        homeTab,
        setHomeTab,
        isSearchOpen,
        setIsSearchOpen,
        searchQuery,
        setSearchQuery,
        searchHistory,
        addSearchHistory,
        clearSearchHistory,
        selectedItem,
        setSelectedItem,
        buyingItem,
        setBuyingItem,
        isPurchaseCompleteOpen,
        setIsPurchaseCompleteOpen,
        isListingModalOpen,
        setIsListingModalOpen,
        items,
        toggleLikeItem,
        addNewItem,
        addComment,
        user,
        notifications,
        activeNotification,
        setActiveNotification,
        isDeviceFrame,
        setIsDeviceFrame,
      }}
    >
      {children}
    </MercariContext.Provider>
  );
};

export const useMercari = () => {
  const context = useContext(MercariContext);
  if (!context) {
    throw new Error('useMercari must be used within a MercariProvider');
  }
  return context;
};
