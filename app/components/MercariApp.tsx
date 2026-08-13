'use client';

import React from 'react';
import { useMercari } from '../context/MercariContext';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { HomeView } from './views/HomeView';
import { NotificationView } from './views/NotificationView';
import { ListingView } from './views/ListingView';
import { MyPageView } from './views/MyPageView';
import { ItemDetailView } from './views/ItemDetailView';
import { SearchView } from './views/SearchView';
import { CategoryView } from './views/CategoryView';
import { ShopView } from './views/ShopView';
import { ShopCategoryView, isShopCategoryRoute } from './views/ShopCategoryView';
import { BrowseDirectoryView, isBrowseDirectoryRoute } from './views/BrowseDirectoryView';
import { BuyModal } from './modals/BuyModal';
import { LoginPromptModal } from './modals/LoginPromptModal';
import { DemoNoticeBar } from './DemoNotice';
import { DemoGuide } from './DemoGuide';
import { SandboxInspector } from './SandboxInspector';

export const MercariApp: React.FC = () => {
  const {
    mainTab,
    selectedItem,
    setSelectedItemId,
    buyingItemId,
    categoryName,
    isSearchOpen,
    searchQuery,
    isDeviceFrame,
  } = useMercari();
  const isBlockingModalOpen = Boolean(selectedItem || buyingItemId);

  const renderCurrentView = () => {
    if (isSearchOpen && searchQuery.trim()) return <SearchView />;
    switch (mainTab) {
      case 'home':
        return <HomeView />;
      case 'category':
        if (isBrowseDirectoryRoute(categoryName)) return <BrowseDirectoryView mode={categoryName === 'ブランド一覧' ? 'brand' : 'category'} />;
        if (isShopCategoryRoute(categoryName) || categoryName === 'ショップカテゴリ一覧') return <ShopCategoryView key={categoryName ?? 'ショップカテゴリ一覧'} />;
        return categoryName === 'ショップ' ? <ShopView /> : <CategoryView />;
      case 'notifications':
        return <NotificationView />;
      case 'sell':
        return <ListingView />;
      case 'mypage':
        return <MyPageView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--shop-bg)] font-sans text-white">
      <div
        className={`mx-auto flex w-full flex-col bg-[var(--shop-bg)] transition-all duration-300 ${
          isDeviceFrame
            ? 'relative max-w-[430px] h-[100dvh] overflow-hidden sm:my-4 sm:h-[900px] sm:rounded-[34px] sm:border-[8px] sm:border-[#343438] sm:shadow-2xl'
            : 'min-h-screen max-w-none'
        }`}
        data-testid="shop-app-container"
      >
        <div aria-hidden={isBlockingModalOpen ? true : undefined} inert={isBlockingModalOpen ? true : undefined}>
          <DemoNoticeBar />
          <DemoGuide />

          {/* Header */}
          <Header />

          {/* Main Content Area */}
          <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:pt-10">
            {renderCurrentView()}
          </main>

          {/* Bottom Navigation */}
          <BottomNav />
        </div>

        {/* Overlays & Modals */}
        {selectedItem && (
          <ItemDetailView
            key={selectedItem.id}
            item={selectedItem}
            onClose={() => setSelectedItemId(null)}
          />
        )}

        {isSearchOpen && !searchQuery.trim() && <SearchView />}

        <BuyModal />
        <LoginPromptModal />
        <SandboxInspector />
      </div>
    </div>
  );
};
