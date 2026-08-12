'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Clock3, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { MercariItem } from '../../types/mercari';
import { createFilterState, FilterSidebar, FilterState } from '../ui/FilterSidebar';
import { ProductCard } from '../ui/ShopPrimitives';
import { joinSearchTokens, tokenizeSearchQuery } from '../searchUtils';

const categorySearchAliases: Record<string, string[]> = {
  ファッション: ['ファッション', 'レディース', 'メンズ'],
  'ゲーム・おもちゃ・グッズ': ['ゲーム・おもちゃ', 'ゲーム', 'グッズ', 'ホビー', 'フィギュア', 'トレーディングカード'],
  '本・雑誌・漫画': ['本・マンガ', '本', 'マンガ', '漫画', '雑誌'],
  'スマホ・タブレット・パソコン': ['家電・スマホ', 'スマホ', 'タブレット', 'PC', 'パソコン'],
  'ベビー・キッズ': ['ベビー', 'キッズ'],
};

export const SearchView: React.FC = () => {
  const { setIsSearchOpen, searchQuery, setSearchQuery, searchHistory, addSearchHistory, clearSearchHistory, items, openItem, setLiked, isDeviceFrame, openCategory } = useMercari();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(() => createFilterState());
  const [sortOrder, setSortOrder] = useState<'new' | 'priceAsc' | 'priceDesc' | 'likes'>('new');
  const tokens = useMemo(() => tokenizeSearchQuery(searchQuery), [searchQuery]);
  const [draftQuery, setDraftQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSearchOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsSearchOpen]);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => setFilters(createFilterState());
  const queryText = joinSearchTokens(tokens);
  const queryTokens = tokens.map((token) => token.toLowerCase());
  const query = queryText.trim().toLowerCase();
  const isResultPage = Boolean(query);
  const rawResults = useMemo(() => queryTokens.length
    ? items.filter((item) => {
      const searchable = `${item.title} ${item.description} ${item.category.join(' ')}`.toLowerCase();
      return queryTokens.every((token) => searchable.includes(token));
    })
    : [], [items, queryTokens]);

  const results = useMemo(() => {
    const categoryAliases = categorySearchAliases[filters.category] ?? [filters.category];
    const normalizedBrand = filters.brand.trim().toLowerCase();
    const normalizedExclude = filters.excludeKeyword.trim().toLowerCase();
    const normalizedColor = filters.color.toLowerCase();
    const normalizedSize = filters.size.toLowerCase();
    return [...rawResults]
      .filter((item) => filters.category === 'すべて' || item.category.some((value) => categoryAliases.some((alias) => value.includes(alias))))
      .filter((item) => filters.salesStatus === 'all' || (filters.salesStatus === 'available' ? !item.isSold : item.isSold))
      .filter((item) => !filters.condition || item.condition === filters.condition)
      .filter((item) => !filters.minPrice || item.price >= Number(filters.minPrice))
      .filter((item) => !filters.maxPrice || item.price <= Number(filters.maxPrice))
      .filter((item) => filters.subcategory === 'すべて' || item.category.some((value) => value.includes(filters.subcategory)))
      .filter((item) => !normalizedBrand || `${item.title} ${item.description} ${item.category.join(' ')} ${item.seller.name}`.toLowerCase().includes(normalizedBrand))
      .filter((item) => !normalizedSize || `${item.title} ${item.description} ${item.category.join(' ')}`.toLowerCase().includes(normalizedSize))
      .filter((item) => !normalizedColor || `${item.title} ${item.description}`.toLowerCase().includes(normalizedColor))
      .filter((item) => !filters.shippingFee || item.shippingFee === filters.shippingFee)
      .filter((item) => !filters.shippingOption || item.shippingMethod.includes(filters.shippingOption.replace('メルカリ便', '配送')))
      .filter((item) => !filters.listingType || (filters.listingType === 'オークション' ? item.isAuction : !item.isAuction))
      .filter((item) => !normalizedExclude || !`${item.title} ${item.description}`.toLowerCase().includes(normalizedExclude))
      .sort((a, b) => sortOrder === 'priceAsc' ? a.price - b.price : sortOrder === 'priceDesc' ? b.price - a.price : sortOrder === 'likes' ? b.likesCount - a.likesCount : b.id.localeCompare(a.id));
  }, [filters, rawResults, sortOrder]);

  const commitTokens = (nextTokens: string[], shouldAddHistory = false) => {
    const normalizedTokens = tokenizeSearchQuery(nextTokens.join(' '));
    const normalizedQuery = joinSearchTokens(normalizedTokens);
    setSearchQuery(normalizedQuery);
    setDraftQuery('');
    if (shouldAddHistory && normalizedQuery) addSearchHistory(normalizedQuery);
  };

  const handleDraftChange = (value: string) => {
    const parts = value.split(/[\s\u3000]+/u);
    if (!/[\s\u3000]/u.test(value)) {
      setDraftQuery(value);
      return;
    }
    const completed = parts.slice(0, -1).filter(Boolean);
    if (completed.length) commitTokens([...tokens, ...completed]);
    setDraftQuery(parts.at(-1) ?? '');
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    commitTokens([...tokens, draftQuery], true);
  };
  const openBrowseDirectory = (mode: 'category' | 'brand') => {
    setSearchQuery('');
    openCategory(mode === 'category' ? 'カテゴリー一覧' : 'ブランド一覧');
  };
  const clearSearchInput = () => commitTokens([]);
  const filterProps = { state: filters, onChange: updateFilter, onClear: clearFilters };

  return (
    <div className={`${isResultPage ? 'shop-search-page relative -mt-10 flex-1 overflow-y-auto bg-[var(--shop-bg)]' : 'absolute inset-0 z-50 flex flex-col overflow-y-auto bg-[var(--shop-bg)] animate-fade-in'}`} role={isResultPage ? undefined : 'dialog'} aria-modal={isResultPage ? undefined : true} aria-labelledby="search-view-title" data-testid="search-view">
      {(!isResultPage || isDeviceFrame) && <div className="sticky top-0 z-20 border-b border-[var(--shop-border)] bg-[rgba(31,31,33,.96)] px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4">
          <button type="button" onClick={() => setIsSearchOpen(false)} className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface)] hover:text-white" aria-label="検索を閉じる"><ArrowLeft className="h-5 w-5" /></button>
          <form onSubmit={handleSubmit} className="relative flex-1">
            <label id="search-view-title" htmlFor="search-input" className="sr-only">商品を検索</label>
            <div className="flex min-h-[50px] flex-wrap items-center gap-1.5 rounded-lg border border-[var(--shop-border)] bg-[#2a2a2c] px-3.5 py-1.5 focus-within:border-[var(--shop-blue)]">
              <Search className="h-4 w-4 shrink-0 text-[var(--shop-muted)]" aria-hidden="true" />
              {tokens.map((token, index) => <span key={`${token}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--shop-border)] bg-[#3a3a3d] px-3 py-1.5 text-sm text-white"><span className="truncate">{token}</span><button type="button" onClick={() => commitTokens(tokens.filter((_, tokenIndex) => tokenIndex !== index))} aria-label={`${token}を削除`} className="rounded-full text-[var(--shop-muted)] hover:text-white"><X className="h-3.5 w-3.5" /></button></span>)}
              <input id="search-input" value={draftQuery} onChange={(event) => handleDraftChange(event.target.value)} placeholder={tokens.length ? '' : 'なにをお探しですか？'} aria-label="検索キーワードを入力" className="min-w-[120px] flex-1 bg-transparent py-1 text-sm text-white outline-none placeholder:text-[var(--shop-subtle)]" data-testid="search-input" />
              {(tokens.length > 0 || draftQuery) && <button type="button" onClick={clearSearchInput} className="ml-auto rounded-full bg-[var(--shop-subtle)] p-1 text-white" aria-label="検索文字をクリア"><X className="h-3.5 w-3.5" /></button>}
            </div>
          </form>
          <button type="button" onClick={() => setIsFilterOpen(true)} className="rounded-lg border border-[var(--shop-border)] p-2 text-[var(--shop-muted)] hover:text-white lg:hidden" aria-label="検索フィルター"><SlidersHorizontal className="h-5 w-5" /></button>
        </div>
      </div>}

      <div className={`${isResultPage ? 'mx-auto w-full max-w-[1280px] flex-1 px-4 py-10 md:px-9' : 'mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 md:px-7'}`}>
        {!isResultPage && <div className="mb-7 grid grid-cols-2 gap-4 md:max-w-[625px]">
          <button type="button" onClick={() => openBrowseDirectory('category')} className="flex min-h-[57px] items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 py-3 text-sm font-bold text-white hover:border-[var(--shop-blue)]">カテゴリから探す</button>
          <button type="button" onClick={() => openBrowseDirectory('brand')} className="flex min-h-[57px] items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 py-3 text-sm font-bold text-white hover:border-[var(--shop-blue)]">ブランドから探す</button>
        </div>}

        {query ? (
          <div className="grid gap-10 lg:grid-cols-[268px_minmax(0,1fr)]">
            <aside className="hidden lg:block" aria-label="検索結果を絞り込む"><FilterSidebar idPrefix="search-desktop" {...filterProps} /></aside>
            <SearchResults results={results} openItem={openItem} setLiked={setLiked} query={queryText} compact={isDeviceFrame} sortOrder={sortOrder} onCycleSort={() => setSortOrder((current) => current === 'new' ? 'priceAsc' : current === 'priceAsc' ? 'priceDesc' : current === 'priceDesc' ? 'likes' : 'new')} onOpenFilters={() => setIsFilterOpen(true)} />
          </div>
        ) : <SearchHistory history={searchHistory} setQuery={(value) => commitTokens(tokenizeSearchQuery(value))} addHistory={addSearchHistory} clearHistory={clearSearchHistory} />}
      </div>

      {isFilterOpen && <FilterSheet state={filters} onChange={updateFilter} onClear={clearFilters} onClose={() => setIsFilterOpen(false)} />}
    </div>
  );
};

const SearchHistory: React.FC<{ history: string[]; setQuery: (query: string) => void; addHistory: (query: string) => void; clearHistory: () => void }> = ({ history, setQuery, addHistory, clearHistory }) => (
  <section className="max-w-[680px]">
    <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold text-white">最近の検索</h2>{history.length > 0 && <button type="button" onClick={clearHistory} className="text-xs font-bold text-[var(--shop-blue)]">すべて削除</button>}</div>
    <div className="divide-y divide-[var(--shop-border)] rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)]">
      {history.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[var(--shop-muted)]">検索履歴はありません</p> : history.map((query) => <button type="button" key={query} onClick={() => { setQuery(query); addHistory(query); }} className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm text-white hover:bg-[var(--shop-surface-raised)]"><span className="flex items-center gap-3"><Clock3 className="h-4 w-4 text-[var(--shop-subtle)]" />{query}</span><ChevronRight className="h-4 w-4 text-[var(--shop-subtle)]" /></button>)}
    </div>
  </section>
);

const SearchResults: React.FC<{ results: MercariItem[]; openItem: (id: string) => void; setLiked: (id: string, liked: boolean) => unknown; query: string; compact?: boolean; sortOrder: string; onCycleSort: () => void; onOpenFilters: () => void }> = ({ results, openItem, setLiked, query, compact = false, sortOrder, onCycleSort, onOpenFilters }) => (
  <section aria-labelledby="search-results-title">
    <div className="mb-8 flex items-center justify-between gap-3"><div><h2 id="search-results-title" className="text-base font-bold text-white">「{query}」の検索結果</h2><p className="mt-1 text-xs text-[var(--shop-muted)]">{results.length}件の商品</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={onCycleSort} className="flex items-center gap-1 rounded-full border border-[var(--shop-border)] px-2.5 py-1.5 text-[10px] text-[var(--shop-muted)] hover:text-white"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />{sortOrder === 'new' ? '新しい順' : sortOrder === 'priceAsc' ? '価格の安い順' : sortOrder === 'priceDesc' ? '価格の高い順' : 'いいね順'}</button><button type="button" onClick={onOpenFilters} className="rounded-full border border-[var(--shop-border)] px-2.5 py-1.5 text-[10px] text-[var(--shop-muted)] hover:text-white lg:hidden">絞り込み</button></div></div>
    {results.length === 0 ? <div className="rounded-lg border border-dashed border-[var(--shop-border)] py-16 text-center text-sm text-[var(--shop-muted)]">一致する商品が見つかりませんでした</div> : <div className={`grid grid-cols-3 gap-1.5 ${compact ? '' : 'sm:gap-2.5 md:grid-cols-4 md:gap-4 lg:grid-cols-5'}`}>{results.map((item) => <ProductCard key={item.id} item={item} compact={compact} onOpen={() => openItem(item.id)} onLike={(liked) => setLiked(item.id, liked)} />)}</div>}
  </section>
);

const FilterSheet: React.FC<{ state: FilterState; onChange: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void; onClear: () => void; onClose: () => void }> = ({ state, onChange, onClear, onClose }) => (
  <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="検索結果を絞り込む">
    <div className="max-h-[88%] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-bg)] p-5 shadow-2xl animate-slide-up">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-black text-white">絞り込み</h2><button type="button" onClick={onClose} aria-label="絞り込みを閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div>
      <FilterSidebar idPrefix="search-mobile" state={state} onChange={onChange} onClear={onClear} />
      <button type="button" onClick={onClose} className="mt-5 w-full rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-black text-white">商品を見る</button>
    </div>
  </div>
);
