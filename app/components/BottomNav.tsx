'use client';

import React from 'react';
import { Home, Bell, Camera, User } from 'lucide-react';
import { useMercari } from '../context/MercariContext';
import { MainTab } from '../types/mercari';

export const BottomNav: React.FC = () => {
  const { mainTab, setMainTab, setIsListingModalOpen } = useMercari();

  const handleTabClick = (tab: MainTab) => {
    if (tab === 'sell') {
      setMainTab('sell');
      setIsListingModalOpen(true);
    } else {
      setMainTab(tab);
    }
  };

  return (
    <nav
      className="sticky bottom-0 z-30 bg-[#1e1e1e] border-t border-[#2c2c2e] px-2 py-1.5 flex items-center justify-around text-xs select-none shadow-lg"
      data-testid="bottom-navigation"
    >
      {/* Home Tab */}
      <button
        onClick={() => handleTabClick('home')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-colors ${
          mainTab === 'home' ? 'text-white font-bold' : 'text-[#8e8e93] hover:text-gray-200'
        }`}
        data-testid="nav-home"
      >
        <Home className="w-5 h-5 mb-0.5" />
        <span>ホーム</span>
      </button>

      {/* Notifications Tab */}
      <button
        onClick={() => handleTabClick('notifications')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-colors relative ${
          mainTab === 'notifications' ? 'text-white font-bold' : 'text-[#8e8e93] hover:text-gray-200'
        }`}
        data-testid="nav-notifications"
      >
        <Bell className="w-5 h-5 mb-0.5" />
        <span>お知らせ</span>
        <span className="absolute top-1 right-3 w-2 h-2 bg-[#ff0211] rounded-full"></span>
      </button>

      {/* Sell Tab */}
      <button
        onClick={() => handleTabClick('sell')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-colors ${
          mainTab === 'sell' ? 'text-white font-bold' : 'text-[#8e8e93] hover:text-gray-200'
        }`}
        data-testid="nav-sell"
      >
        <Camera className="w-5 h-5 mb-0.5" />
        <span>出品</span>
      </button>

      {/* MyPage Tab */}
      <button
        onClick={() => handleTabClick('mypage')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-colors ${
          mainTab === 'mypage' ? 'text-white font-bold' : 'text-[#8e8e93] hover:text-gray-200'
        }`}
        data-testid="nav-mypage"
      >
        <User className="w-5 h-5 mb-0.5" />
        <span>マイページ</span>
      </button>
    </nav>
  );
};
