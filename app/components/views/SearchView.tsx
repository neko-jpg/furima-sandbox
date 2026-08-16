'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Clock3, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { MercariItem } from '../../types/mercari';
import { createFilterState, FilterSidebar, FilterState } from '../ui/FilterSidebar';
import { ProductCard } from '../ui/ShopPrimitives';
import { filterCatalogItems, joinSearchTokens, searchCatalogItems, tokenizeSearchQuery } from '../searchUtils';

export const SearchView: React.FC = () => {
  const { setIsSearchOpen, searchQuery, setSearchQuery, searchHistory, addSearchHistory, clearSearchHistory, items, openItem, setLiked, isDeviceFrame, openCategory, sandboxSnapshot } = useMercari();
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(() => createFilterState());
  const [sortOrder, setSortOrder] = useState<'new' | 'priceAsc' | 'priceDesc' | 'likes'>('new');
  const [visibleCount, setVisibleCount] = useState(60);
  const tokens = useMemo(() => tokenizeSearchQuery(searchQuery), [searchQuery]);
  const [draftQuery, setDraftQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSearchOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsSearchOpen]);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => { setVisibleCount(60); setFilters((current) => ({ ...current, [key]: value })); };
  const clearFilters = () => { setVisibleCount(60); setFilters(createFilterState()); };
  const queryText = joinSearchTokens(tokens);
  const query = queryText.trim().toLowerCase();
  const isResultPage = Boolean(query);
  const rawResults = useMemo(() => query && sandboxSnapshot.scenarioId !== 'zero_search_results' ? searchCatalogItems(items, searchQuery) : [], [items, query, searchQuery, sandboxSnapshot.scenarioId]);

  const results = useMemo(() => {
    return filterCatalogItems(rawResults, filters)
      .sort((a, b) => sortOrder === 'priceAsc' ? a.price - b.price : sortOrder === 'priceDesc' ? b.price - a.price : sortOrder === 'likes' ? b.likesCount - a.likesCount : Date.parse(b.createdAt ?? '1970-01-01') - Date.parse(a.createdAt ?? '1970-01-01'));
  }, [filters, rawResults, sortOrder]);

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (filters.category !== 'すべて') labels.push(filters.category);
    if (filters.subcategory !== 'すべて') labels.push(filters.subcategory);
    if (filters.brand) labels.push(`ブランド: ${filters.brand}`);
    if (filters.size) labels.push(`サイズ: ${filters.size}`);
    if (filters.salesStatus !== 'all') labels.push(filters.salesStatus === 'available' ? '販売中のみ' : '売り切れのみ');
    if (filters.sellerType) labels.push(`出品者: ${filters.sellerType}`);
    if (filters.condition) labels.push(filters.condition);
    if (filters.minPrice || filters.maxPrice) labels.push(`価格: ${filters.minPrice || '0'}〜${filters.maxPrice || '上限なし'}円`);
    if (filters.discountOption) labels.push(filters.discountOption);
    if (filters.appraisal) labels.push('あんしん鑑定対象');
    if (filters.listingType) labels.push(filters.listingType);
    if (filters.guarantee) labels.push('保証付き整備品');
    if (filters.color) labels.push(`色: ${filters.color}`);
    if (filters.shippingOption) labels.push(filters.shippingOption);
    if (filters.shippingFee) labels.push(filters.shippingFee);
    if (filters.timeSale) labels.push(`タイムセール ${filters.timeSale}`);
    if (filters.excludeKeyword) labels.push(`除外: ${filters.excludeKeyword}`);
    return labels;
  }, [filters]);

  const commitTokens = (nextTokens: string[], shouldAddHistory = false) => {
    const normalizedTokens = tokenizeSearchQuery(nextTokens.join(' '));
    const normalizedQuery = joinSearchTokens(normalizedTokens);
    setSearchQuery(normalizedQuery);
    setDraftQuery('');
    setVisibleCount(60);
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

      <div className={`${isResultPage ? 'mx-auto w-full max-w-[1280px] flex-1 px-4 py-10 pb-24 md:px-9' : 'mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 pb-24 md:px-7'}`}>
        {!isResultPage && <div className="mb-7 grid grid-cols-2 gap-4 md:max-w-[625px]">
          <button type="button" onClick={() => openBrowseDirectory('category')} className="flex min-h-[57px] items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 py-3 text-sm font-bold text-white hover:border-[var(--shop-blue)]">カテゴリから探す</button>
          <button type="button" onClick={() => openBrowseDirectory('brand')} className="flex min-h-[57px] items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 py-3 text-sm font-bold text-white hover:border-[var(--shop-blue)]">ブランドから探す</button>
        </div>}

        {query ? (
          <div className="grid gap-10 lg:grid-cols-[268px_minmax(0,1fr)]">
            <aside className="hidden lg:block" aria-label="検索結果を絞り込む"><FilterSidebar idPrefix="search-desktop" {...filterProps} /></aside>
            <SearchResults results={results.slice(0, visibleCount)} totalCount={results.length} rawCount={rawResults.length} openItem={openItem} setLiked={setLiked} query={queryText} compact={isDeviceFrame} sortOrder={sortOrder} activeFilterLabels={activeFilterLabels} onClearFilters={clearFilters} onLoadMore={() => setVisibleCount((current) => current + 60)} onCycleSort={() => { setVisibleCount(60); setSortOrder((current) => current === 'new' ? 'priceAsc' : current === 'priceAsc' ? 'priceDesc' : current === 'priceDesc' ? 'likes' : 'new'); }} onOpenFilters={() => setIsFilterOpen(true)} />
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

const SearchResults: React.FC<{ results: MercariItem[]; totalCount: number; rawCount: number; openItem: (id: string) => void; setLiked: (id: string, liked: boolean) => unknown; query: string; compact?: boolean; sortOrder: string; activeFilterLabels: string[]; onClearFilters: () => void; onLoadMore: () => void; onCycleSort: () => void; onOpenFilters: () => void }> = ({ results, totalCount, rawCount, openItem, setLiked, query, compact = false, sortOrder, activeFilterLabels, onClearFilters, onLoadMore, onCycleSort, onOpenFilters }) => (
  <section aria-labelledby="search-results-title">
    <div className="mb-4 flex items-center justify-between gap-3"><div><h2 id="search-results-title" className="text-base font-bold text-white">「{query}」の検索結果</h2><p className="mt-1 text-xs text-[var(--shop-muted)]" aria-live="polite">{results.length}件の商品{activeFilterLabels.length > 0 && <span>（全{rawCount}件から絞り込み中）</span>}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={onCycleSort} className="flex items-center gap-1 rounded-full border border-[var(--shop-border)] px-2.5 py-1.5 text-[10px] text-[var(--shop-muted)] hover:text-white"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />{sortOrder === 'new' ? '新しい順' : sortOrder === 'priceAsc' ? '価格の安い順' : sortOrder === 'priceDesc' ? '価格の高い順' : 'いいね順'}</button><button type="button" onClick={onOpenFilters} className="rounded-full border border-[var(--shop-border)] px-2.5 py-1.5 text-[10px] text-[var(--shop-muted)] hover:text-white lg:hidden">絞り込み{activeFilterLabels.length > 0 && ` ${activeFilterLabels.length}`}</button></div></div>
    <div className="mb-6 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3" aria-label="適用中の絞り込み">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-black text-white">適用中の条件</span>{activeFilterLabels.length === 0 ? <span className="text-xs text-[var(--shop-muted)]">なし</span> : activeFilterLabels.map((label) => <span key={label} className="rounded-full border border-[var(--shop-blue)]/40 bg-[#16394d] px-2.5 py-1 text-[10px] font-bold text-[var(--shop-blue)]">{label}</span>)}{activeFilterLabels.length > 0 && <button type="button" onClick={onClearFilters} className="ml-auto text-[10px] font-bold text-[var(--shop-blue)] hover:text-white">すべて解除</button>}</div>
    </div>
    {results.length === 0 ? <div className="rounded-lg border border-dashed border-[var(--shop-border)] py-16 text-center text-sm text-[var(--shop-muted)]">一致する商品が見つかりませんでした</div> : <><div className={`grid grid-cols-3 gap-1.5 ${compact ? '' : 'sm:gap-2.5 md:grid-cols-4 md:gap-4 lg:grid-cols-5'}`}>{results.map((item) => <ProductCard key={item.id} item={item} compact={compact} onOpen={() => openItem(item.id)} onLike={(liked) => setLiked(item.id, liked)} />)}</div>{results.length < totalCount && <button type="button" onClick={onLoadMore} className="mx-auto mt-8 block rounded-full border border-[var(--shop-blue)] px-6 py-2.5 text-xs font-bold text-[var(--shop-blue)] hover:bg-[#16394d]">さらに60件読み込む（残り{totalCount - results.length}件）</button>}</>}
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
