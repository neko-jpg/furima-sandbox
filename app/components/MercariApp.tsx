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
    closeItem,
    buyingItemId,
    categoryName,
    isSearchOpen,
    searchQuery,
    isDeviceFrame,
    isListingModalOpen,
    isLoginPromptOpen,
    isSandboxReady,
  } = useMercari();
  const isListingFlowOpen = mainTab === 'sell' && isListingModalOpen;
  const isSearchOverlayOpen = isSearchOpen && !searchQuery.trim();
  const isBlockingModalOpen = Boolean(selectedItem || buyingItemId || isLoginPromptOpen || isSearchOverlayOpen);
  const isBackgroundInert = isBlockingModalOpen && !isListingFlowOpen;

  React.useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const resetScrollOwner = () => {
      document.querySelector<HTMLElement>('main .shop-scrollbar')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.querySelector<HTMLElement>('[data-testid="listing-flow-scroll"]')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };
    resetScrollOwner();
    const frame = window.requestAnimationFrame(resetScrollOwner);
    return () => window.cancelAnimationFrame(frame);
  }, [categoryName, isListingModalOpen, isSearchOpen, mainTab, selectedItem?.id]);

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
          : 'relative h-[100dvh] max-w-none overflow-hidden'
        }`}
        data-testid="shop-app-container"
      >
        {!isListingFlowOpen && (
          <div aria-hidden={isBackgroundInert ? true : undefined} inert={isBackgroundInert ? true : undefined}>
            <DemoNoticeBar />
            <DemoGuide />

            {/* Header */}
            <Header />
          </div>
        )}

        {/* Main content becomes the full-screen listing route while the flow is open. */}
        <main aria-hidden={isBackgroundInert ? true : undefined} inert={isBackgroundInert ? true : undefined} className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${isListingFlowOpen ? 'pt-0' : 'md:pt-10'}`}>
          {renderCurrentView()}
        </main>

        {!isListingFlowOpen && (
          <div aria-hidden={isBackgroundInert ? true : undefined} inert={isBackgroundInert ? true : undefined}>
            {/* Bottom Navigation */}
            <BottomNav />
          </div>
        )}

        {/* Overlays & Modals */}
        {selectedItem && (
          <ItemDetailView
            key={selectedItem.id}
            item={selectedItem}
            onClose={closeItem}
          />
        )}

        {isSearchOpen && !searchQuery.trim() && <SearchView />}

        <BuyModal />
        <LoginPromptModal />
        {!isListingFlowOpen && mainTab !== 'sell' && <SandboxInspector />}
        {!isSandboxReady && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-[var(--shop-bg)]/90 px-6 text-center" role="status" aria-live="polite">
            <p className="rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-sm text-white/80">Sandbox状態を復元しています…</p>
          </div>
        )}
      </div>
    </div>
  );
};
