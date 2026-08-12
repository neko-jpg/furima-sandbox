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
import { BuyModal } from './modals/BuyModal';

export const MercariApp: React.FC = () => {
  const {
    mainTab,
    selectedItem,
    setSelectedItem,
    isSearchOpen,
    isDeviceFrame,
  } = useMercari();

  const renderCurrentView = () => {
    switch (mainTab) {
      case 'home':
        return <HomeView />;
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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-0 sm:p-4 font-sans select-none overflow-x-hidden">
      {/* Responsive App Frame Container */}
      <div
        className={`w-full bg-[#121212] flex flex-col relative overflow-hidden transition-all duration-300 ${
          isDeviceFrame
            ? 'max-w-[430px] h-[100dvh] sm:h-[880px] sm:rounded-[40px] sm:border-[10px] border-[#222225] shadow-2xl'
            : 'max-w-4xl h-[100dvh] sm:h-[90vh] sm:rounded-2xl sm:border border-[#2c2c2e] shadow-xl'
        }`}
        data-testid="mercari-app-container"
      >
        {/* Header */}
        <Header />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {renderCurrentView()}
        </main>

        {/* Bottom Navigation */}
        <BottomNav />

        {/* Overlays & Modals */}
        {selectedItem && (
          <ItemDetailView
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
          />
        )}

        {isSearchOpen && <SearchView />}

        <BuyModal />
      </div>
    </div>
  );
};
