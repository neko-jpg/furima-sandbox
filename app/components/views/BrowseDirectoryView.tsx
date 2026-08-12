'use client';

import React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { filterCategories } from '../ui/FilterSidebar';

const brandNames = [
  'Apple',
  'Nintendo',
  'SONY',
  'MSI',
  'Nike',
  'ユニクロ',
  '無印良品',
  'GU',
  'Supreme',
  'ポケモン',
  'ディズニー',
  'その他のブランド',
];

export type BrowseDirectoryMode = 'category' | 'brand';

export const isBrowseDirectoryRoute = (categoryName: string | null): boolean => (
  categoryName === 'カテゴリー一覧' || categoryName === 'ブランド一覧'
);

export const BrowseDirectoryView: React.FC<{ mode: BrowseDirectoryMode }> = ({ mode }) => {
  const { navigateToTab, openCategory, setSearchQuery, setIsSearchOpen } = useMercari();
  const isCategory = mode === 'category';
  const entries = isCategory ? filterCategories.filter((category) => category !== 'すべて') : brandNames;

  const handleSelect = (entry: string) => {
    if (isCategory) {
      openCategory(entry);
      return;
    }
    setSearchQuery(entry);
    setIsSearchOpen(true);
  };

  return (
    <div className="shop-scrollbar relative -mt-10 flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="browse-directory-view">
      <div className="mx-auto w-full max-w-[640px] px-4 pb-16 pt-8 md:px-0 md:pt-10">
        <button type="button" onClick={() => navigateToTab('home')} className="mb-8 inline-flex items-center gap-2 text-sm text-[var(--shop-blue)] hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          ホーム
        </button>
        <h1 className="mb-7 text-2xl font-black tracking-tight text-white">{isCategory ? 'カテゴリー' : 'ブランド'}</h1>
        <div className="divide-y divide-[var(--shop-border)] rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)]">
          {entries.map((entry) => (
            <button type="button" key={entry} onClick={() => handleSelect(entry)} className="flex w-full items-center justify-between px-5 py-4 text-left text-base font-bold text-white transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-[var(--shop-surface-raised)] hover:text-[var(--shop-blue)]">
              <span>{entry}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--shop-muted)]" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
