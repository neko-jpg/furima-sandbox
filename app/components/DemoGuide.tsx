'use client';

import React from 'react';
import { ArrowRight, Camera, Search, ShoppingBag } from 'lucide-react';
import { useMercari } from '../context/MercariContext';

export const DemoGuide: React.FC = () => {
  const { setSearchQuery, setIsSearchOpen, openItem, navigateToTab } = useMercari();

  const openSearch = () => {
    setSearchQuery('ノートPC');
    setIsSearchOpen(true);
  };

  return (
    <section aria-label="このデモで試せる操作" className="border-b border-white/10 bg-[#171717] px-4 py-2 sm:px-6">
      <div className="mx-auto flex max-w-[1368px] flex-wrap items-center gap-2.5 text-xs text-[#d8d8d8]">
        <span className="mr-1 font-black text-white">3分で体験</span>
        <button type="button" onClick={openSearch} className="inline-flex items-center gap-1 rounded-full border border-[#45454a] px-2.5 py-1.5 font-bold text-white transition-colors hover:border-[var(--shop-blue)] hover:text-[var(--shop-blue)]">
          <Search className="h-3.5 w-3.5" />検索
        </button>
        <button type="button" onClick={() => openItem('pc-2')} className="inline-flex items-center gap-1 rounded-full border border-[#45454a] px-2.5 py-1.5 font-bold text-white transition-colors hover:border-[var(--shop-blue)] hover:text-[var(--shop-blue)]">
          <ShoppingBag className="h-3.5 w-3.5" />商品詳細・購入確認
        </button>
        <button type="button" onClick={() => navigateToTab('sell')} className="inline-flex items-center gap-1 rounded-full border border-[#45454a] px-2.5 py-1.5 font-bold text-white transition-colors hover:border-[var(--shop-blue)] hover:text-[var(--shop-blue)]">
          <Camera className="h-3.5 w-3.5" />出品フォーム
        </button>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#a3a3a3]">API操作も同じ状態に反映 <ArrowRight className="h-3 w-3" /></span>
      </div>
    </section>
  );
};
