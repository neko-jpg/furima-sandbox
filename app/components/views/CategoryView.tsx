'use client';

import React, { useMemo, useState } from 'react';
import { ChevronRight, RotateCcw, Save, SlidersHorizontal, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { createFilterState, FilterSidebar, FilterState, filterCategories } from '../ui/FilterSidebar';
import { ProductCard } from '../ui/ShopPrimitives';

const categoryAliases: Record<string, string[]> = {
  'ゲーム・おもちゃ・グッズ': ['ゲーム・おもちゃ', 'ゲーム・おもちゃ・グッズ', 'ゲーム', 'トレーディングカード', 'ホビー', 'フィギュア'],
  'ホビー・楽器・アート': ['ホビー', '楽器', 'アート', 'フィギュア'],
  '本・雑誌・漫画': ['本・マンガ', '本・雑誌・漫画', '本', 'マンガ', '漫画', '雑誌'],
  'CD・DVD・ブルーレイ': ['CD', 'DVD', 'ブルーレイ', '音楽', '映画'],
  'スマホ・タブレット・パソコン': ['家電・スマホ', 'スマホ', 'タブレット', 'PC', 'パソコン'],
  PC: ['PC', 'パソコン', 'ノートPC', 'タブレット'],
  'テレビ・オーディオ・カメラ': ['テレビ', 'オーディオ', 'カメラ'],
  '生活家電・空調': ['家電・スマホ', '生活家電', '空調'],
  ファッション: ['ファッション', 'レディース', 'メンズ'],
  メンズ: ['メンズ', 'ファッション'],
  レディース: ['レディース', 'ファッション'],
  'ベビー・キッズ': ['ベビー', 'キッズ'],
  '家具・インテリア': ['インテリア・住まい・小物', '家具', 'インテリア'],
};

const conditionChips = ['新品・未使用', '目立った傷や汚れなし'];

export const CategoryView: React.FC = () => {
  const { categoryName, navigateToTab, openCategory, items, openItem, setLiked, isDeviceFrame } = useMercari();
  const title = categoryName && categoryName !== 'すべてのカテゴリ' ? categoryName : 'すべての商品';
  const selectedCategory = filterCategories.includes(title as (typeof filterCategories)[number]) ? title : 'すべて';
  const [filters, setFilters] = useState<FilterState>(() => createFilterState(selectedCategory));
  const [sort, setSort] = useState<'recommended' | 'new' | 'priceAsc' | 'priceDesc'>('recommended');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((current) => ({ ...(current.category === selectedCategory ? current : createFilterState(selectedCategory)), category: selectedCategory, [key]: value }));
  };

  const activeFilters = filters.category === selectedCategory ? filters : createFilterState(selectedCategory);

  const sourceItems = useMemo(() => {
    const normalItems = items.filter((item) => !item.isAuction);
    if (!categoryName || categoryName === 'すべてのカテゴリ') return normalItems;
    const aliases = categoryAliases[categoryName] ?? [categoryName];
    const matched = normalItems.filter((item) => item.category.some((value) => aliases.some((alias) => value.includes(alias))));
    return matched.length ? matched : normalItems;
  }, [categoryName, items]);

  const results = useMemo(() => {
    const normalizedBrand = activeFilters.brand.trim().toLowerCase();
    const normalizedExclude = activeFilters.excludeKeyword.trim().toLowerCase();
    const normalizedColor = activeFilters.color.toLowerCase();
    const normalizedSize = activeFilters.size.toLowerCase();
    return [...sourceItems]
      .filter((item) => activeFilters.salesStatus === 'all' || (activeFilters.salesStatus === 'available' ? !item.isSold : item.isSold))
      .filter((item) => !activeFilters.condition || item.condition === activeFilters.condition)
      .filter((item) => !activeFilters.minPrice || item.price >= Number(activeFilters.minPrice))
      .filter((item) => !activeFilters.maxPrice || item.price <= Number(activeFilters.maxPrice))
      .filter((item) => activeFilters.subcategory === 'すべて' || item.category.some((value) => value.includes(activeFilters.subcategory)))
      .filter((item) => !normalizedBrand || `${item.title} ${item.description} ${item.category.join(' ')} ${item.seller.name}`.toLowerCase().includes(normalizedBrand))
      .filter((item) => !normalizedSize || `${item.title} ${item.description} ${item.category.join(' ')}`.toLowerCase().includes(normalizedSize))
      .filter((item) => !normalizedColor || `${item.title} ${item.description}`.toLowerCase().includes(normalizedColor))
      .filter((item) => !activeFilters.shippingFee || item.shippingFee === activeFilters.shippingFee)
      .filter((item) => !activeFilters.shippingOption || item.shippingMethod.includes(activeFilters.shippingOption.replace('メルカリ便', '配送')))
      .filter((item) => !activeFilters.listingType || (activeFilters.listingType === 'オークション' ? item.isAuction : !item.isAuction))
      .filter((item) => !normalizedExclude || !`${item.title} ${item.description}`.toLowerCase().includes(normalizedExclude))
      .sort((a, b) => sort === 'priceAsc' ? a.price - b.price : sort === 'priceDesc' ? b.price - a.price : sort === 'new' ? b.id.localeCompare(a.id) : b.likesCount - a.likesCount);
  }, [activeFilters, sort, sourceItems]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  };
  const clearFilters = () => setFilters(createFilterState(selectedCategory));
  const handleCategoryChange = (value: string) => openCategory(value === 'すべて' ? 'すべてのカテゴリ' : value);

  const filterProps = { state: activeFilters, onChange: updateFilter, onClear: clearFilters, onCategoryChange: handleCategoryChange };
  const appliedFilterChips = [
    activeFilters.minPrice ? `¥${Number(activeFilters.minPrice).toLocaleString()}~` : '',
    activeFilters.maxPrice ? `~¥${Number(activeFilters.maxPrice).toLocaleString()}` : '',
    activeFilters.sellerType,
    activeFilters.shippingFee,
  ].filter(Boolean);

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="category-view">
      <div className="mx-auto max-w-[1280px] px-4 pb-14 pt-5 md:px-7 lg:px-9">
        <div className="mb-5 flex items-center gap-2 text-xs text-[var(--shop-blue)]">
          <button type="button" onClick={() => navigateToTab('home')} className="hover:text-white">ホーム</button>
          <ChevronRight className="h-3.5 w-3.5 text-[var(--shop-subtle)]" aria-hidden="true" />
          <span className="text-[var(--shop-muted)]">{title}</span>
        </div>

        <div className="grid gap-10 lg:grid-cols-[268px_minmax(0,1fr)]">
          <aside className="hidden self-start lg:sticky lg:top-4 lg:block" aria-label="商品を絞り込む">
            <FilterSidebar categoryName={selectedCategory} idPrefix="category-desktop" {...filterProps} />
          </aside>

          <section className="min-w-0" aria-labelledby="category-title">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h1 id="category-title" className="text-2xl font-black tracking-tight text-white md:text-[28px]">{title}</h1>
                <label className="relative mt-4 block w-[126px]">
                  <span className="sr-only">販売状況</span>
                  <select value={activeFilters.salesStatus === 'available' ? 'available' : activeFilters.salesStatus === 'sold' ? 'sold' : 'all'} onChange={(event) => updateFilter('salesStatus', event.target.value as FilterState['salesStatus'])} aria-label="販売状況" className="h-10 w-full appearance-none rounded-md border border-[var(--shop-border)] bg-[var(--shop-bg)] px-3 pr-8 text-xs font-bold text-white outline-none focus:border-[var(--shop-blue)]">
                    <option value="all">全ての商品</option>
                    <option value="available">販売中のみ</option>
                    <option value="sold">売り切れのみ</option>
                  </select>
                  <span className="pointer-events-none absolute right-3 top-3 text-xs text-[var(--shop-subtle)]">⌄</span>
                </label>
              </div>
              <button type="button" onClick={() => setIsFilterOpen(true)} className="flex items-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2 text-xs font-bold text-white hover:border-[var(--shop-blue)] lg:hidden">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />絞り込み
              </button>
              <div className="hidden items-center gap-2 sm:flex lg:pt-12">
                <label className="relative block">
                  <span className="sr-only">並び替え</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="並び替え" className="h-9 appearance-none rounded-md border border-[var(--shop-border)] bg-[var(--shop-bg)] px-3 pr-8 text-xs font-bold text-white outline-none focus:border-[var(--shop-blue)]">
                    <option value="recommended">おすすめ順</option>
                    <option value="new">新しい順</option>
                    <option value="priceAsc">価格の安い順</option>
                    <option value="priceDesc">価格の高い順</option>
                  </select>
                  <span className="pointer-events-none absolute right-2.5 top-2.5 text-xs text-[var(--shop-subtle)]">⌄</span>
                </label>
                <button type="button" onClick={() => showNotice('検索条件を保存しました')} className="flex h-9 items-center gap-1 rounded-md border border-[var(--shop-accent)] px-3 text-xs font-bold text-[var(--shop-accent)] hover:bg-[rgba(255,59,74,.08)]">
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />検索条件を保存する
                </button>
              </div>
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-[var(--shop-border)] pb-4">
              {conditionChips.map((value) => <FilterChip key={value} label={value} active={activeFilters.condition === value} onClick={() => updateFilter('condition', activeFilters.condition === value ? '' : value)} />)}
              {appliedFilterChips.map((value) => <FilterChip key={value} label={value} active onClick={() => undefined} />)}
            </div>

            <div className="mb-5 flex items-center justify-end">
              <button type="button" onClick={clearFilters} className="flex items-center gap-1 text-xs font-bold text-[var(--shop-blue)] hover:text-white"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />クリア</button>
            </div>

            {results.length ? (
              <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:gap-4 ${isDeviceFrame ? '' : 'xl:grid-cols-5'}`}>
                {results.map((item) => <ProductCard key={item.id} item={item} compact={isDeviceFrame} onOpen={() => openItem(item.id)} onLike={(liked) => setLiked(item.id, liked)} />)}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--shop-border)] px-5 py-20 text-center text-sm text-[var(--shop-muted)]">
                条件に一致する商品がありません。
                <button type="button" onClick={clearFilters} className="mt-4 block w-full text-[var(--shop-blue)]">条件をクリアする</button>
              </div>
            )}
          </section>
        </div>
      </div>

      {isFilterOpen && (
        <div className="absolute inset-0 z-[60] flex items-end bg-black/65 p-3 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="カテゴリを絞り込む">
          <div className="max-h-[88%] w-full overflow-y-auto rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-bg)] p-5 animate-slide-up">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-black text-white">絞り込み</h2><button type="button" onClick={() => setIsFilterOpen(false)} aria-label="絞り込みを閉じる" className="rounded-full p-1 text-[var(--shop-muted)]"><X className="h-5 w-5" /></button></div>
            <FilterSidebar idPrefix="category-mobile" categoryName={selectedCategory} {...filterProps} />
            <button type="button" onClick={() => setIsFilterOpen(false)} className="mt-5 w-full rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-black text-white">商品を見る</button>
          </div>
        </div>
      )}
      {notice && <div className="pointer-events-none absolute bottom-16 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-[#111113]/95 px-4 py-2 text-xs font-bold text-white shadow-xl" role="status">{notice}</div>}
    </div>
  );
};

const FilterChip: React.FC<{ label: string; active?: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button type="button" onClick={onClick} className={`rounded-full border px-3 py-2 text-xs font-bold transition-colors ${active ? 'border-[var(--shop-blue)] bg-[#16394d] text-[var(--shop-blue)]' : 'border-[var(--shop-border)] text-[var(--shop-muted)] hover:border-white hover:text-white'}`}>{label}</button>
);
