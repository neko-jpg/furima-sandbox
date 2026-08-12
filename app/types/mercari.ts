export interface Seller {
  name: string;
  avatar: string;
  rating: number;
  ratingsCount: number;
  isVerified: boolean;
  level?: number;
}

export interface CommentItem {
  id: string;
  userName: string;
  userAvatar: string;
  text: string;
  date: string;
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

export type MainTab = 'home' | 'notifications' | 'sell' | 'mypage';
export type HomeTab = 'recommend' | 'mylist' | 'auction';

export interface MercariAgentAPI {
  navigateTab: (tab: MainTab) => void;
  navigateHomeSubTab: (tab: HomeTab) => void;
  search: (query: string) => void;
  openItem: (itemId: string) => void;
  closeItem: () => void;
  likeItem: (itemId: string) => void;
  listItem: (item: Partial<MercariItem>) => void;
  buyItem: (itemId: string) => void;
  getState: () => {
    currentMainTab: MainTab;
    currentHomeTab: HomeTab;
    searchQuery: string;
    selectedItemId: string | null;
    itemsCount: number;
  };
}

declare global {
  interface Window {
    __MERCARI_API__?: MercariAgentAPI;
  }
}
