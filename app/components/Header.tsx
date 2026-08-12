'use client';

import React from 'react';
import { Search, CheckSquare, Smartphone, Monitor } from 'lucide-react';
import { useMercari } from '../context/MercariContext';

export const Header: React.FC = () => {
  const {
    setIsSearchOpen,
    searchQuery,
    isDeviceFrame,
    setIsDeviceFrame,
  } = useMercari();

  return (
    <header
      className="sticky top-0 z-30 bg-[#1e1e1e] border-b border-[#2c2c2e] px-4 py-2.5 flex items-center justify-between gap-3 shadow-md"
      data-testid="app-header"
    >
      {/* Mercari Logo */}
      <div className="flex items-center gap-2 cursor-pointer" data-testid="mercari-logo">
        <div className="w-8 h-8 rounded-full bg-[#ff0211] flex items-center justify-center font-bold text-white text-lg tracking-tighter shadow-sm">
          m
        </div>
        <span className="font-extrabold text-xl tracking-tight text-white hidden xs:inline">
          mercari
        </span>
      </div>

      {/* Search Input Trigger */}
      <div
        onClick={() => setIsSearchOpen(true)}
        className="flex-1 max-w-md bg-[#2a2a2d] hover:bg-[#323235] text-[#8e8e93] text-sm px-3.5 py-2 rounded-full flex items-center gap-2 cursor-pointer transition-colors border border-[#3a3a3c]"
        data-testid="search-bar-trigger"
      >
        <Search className="w-4 h-4 text-[#8e8e93]" />
        <span className="truncate">
          {searchQuery ? searchQuery : 'なにをお探しですか？'}
        </span>
      </div>

      {/* Action Icons */}
      <div className="flex items-center gap-2 text-white">
        {/* Todo/Check Icon */}
        <button
          className="relative p-1.5 hover:bg-[#2c2c2e] rounded-full transition-colors"
          title="やることリスト"
          data-testid="todo-button"
        >
          <CheckSquare className="w-6 h-6 text-white" />
          <span className="absolute -top-0.5 -right-0.5 bg-[#ff0211] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center border border-[#1e1e1e]">
            2
          </span>
        </button>

        {/* Frame Toggle Button (Desktop vs Mobile View) */}
        <button
          onClick={() => setIsDeviceFrame(!isDeviceFrame)}
          className="p-1.5 hover:bg-[#2c2c2e] rounded-full transition-colors text-gray-300 hover:text-white"
          title={isDeviceFrame ? 'フルスクリーン表示に変更' : 'スマホ枠表示に変更'}
          data-testid="frame-toggle-button"
        >
          {isDeviceFrame ? <Monitor className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
        </button>
      </div>
    </header>
  );
};
