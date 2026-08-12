'use client';

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export const filterCategories = [
  'すべて',
  'ファッション',
  'ベビー・キッズ',
  'ゲーム・おもちゃ・グッズ',
  'ホビー・楽器・アート',
  'チケット',
  '本・雑誌・漫画',
  'CD・DVD・ブルーレイ',
  'スマホ・タブレット・パソコン',
  'テレビ・オーディオ・カメラ',
  '生活家電・空調',
  'スポーツ',
  'アウトドア・釣り・旅行用品',
  'コスメ・美容',
  'ダイエット・健康',
  '食品・飲料・酒',
  'キッチン・日用品・その他',
  '家具・インテリア',
  'ペット用品',
  'DIY・工具',
  'フラワー・ガーデニング',
  'ハンドメイド・手芸',
  '車・バイク・自転車',
] as const;

const subcategories: Record<string, string[]> = {
  'ゲーム・おもちゃ・グッズ': ['すべて', 'テレビゲーム', 'トレーディングカード', 'キャラクターグッズ', 'フィギュア', 'タレントグッズ', 'おもちゃ', 'ドール・お人形遊び', 'パズル・ボードゲーム', 'ミリタリー', 'シール・ステッカー', 'ミニチュア', '手品', 'パーティグッズ'],
  '本・雑誌・漫画': ['すべて', '本', '雑誌', '漫画', '絵本・児童書', '文学・小説', 'ビジネス・経済'],
  ファッション: ['すべて', 'トップス', 'ジャケット・アウター', 'パンツ', 'バッグ', '靴', 'アクセサリー'],
  'スマホ・タブレット・パソコン': ['すべて', 'スマートフォン本体', 'タブレット', 'ノートPC', 'デスクトップPC', 'PC周辺機器'],
  'ベビー・キッズ': ['すべて', 'ベビー服', 'キッズ服', 'おもちゃ', 'ベビーカー', 'チャイルドシート'],
};

export type FilterState = {
  category: string;
  subcategory: string;
  brand: string;
  size: string;
  salesStatus: 'all' | 'available' | 'sold';
  sellerType: string;
  condition: string;
  minPrice: string;
  maxPrice: string;
  discountOption: string;
  appraisal: string;
  listingType: string;
  guarantee: string;
  color: string;
  shippingOption: string;
  shippingFee: string;
  timeSale: string;
  excludeKeyword: string;
};

export const createFilterState = (category = 'すべて'): FilterState => ({
  category,
  subcategory: 'すべて',
  brand: '',
  size: '',
  salesStatus: 'all',
  sellerType: '',
  condition: '',
  minPrice: '',
  maxPrice: '',
  discountOption: '',
  appraisal: '',
  listingType: '',
  guarantee: '',
  color: '',
  shippingOption: '',
  shippingFee: '',
  timeSale: '',
  excludeKeyword: '',
});

type FilterKey = keyof FilterState;

type FilterSidebarProps = {
  categoryName?: string;
  state: FilterState;
  onChange: <K extends FilterKey>(key: K, value: FilterState[K]) => void;
  onClear: () => void;
  onCategoryChange?: (value: string) => void;
  idPrefix?: string;
};

const conditions = ['新品・未使用', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり'];
const colors = ['ブラック', 'ホワイト', 'グレー', 'ブラウン', 'レッド', 'ブルー', 'グリーン'];

export const FilterSidebar: React.FC<FilterSidebarProps> = ({ categoryName, state, onChange, onClear, onCategoryChange, idPrefix = 'filter' }) => {
  const selectedCategory = useMemo(() => {
    if (categoryName && filterCategories.includes(categoryName as (typeof filterCategories)[number])) return categoryName;
    return filterCategories.includes(state.category as (typeof filterCategories)[number]) ? state.category : 'すべて';
  }, [categoryName, state.category]);
  const availableSubcategories = subcategories[selectedCategory] ?? ['すべて'];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ category: true });

  const toggle = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));
  const renderSection = (key: string, label: string, content: React.ReactNode) => {
    const isExpanded = Boolean(expanded[key]);
    const contentId = `${idPrefix}-${key}`;
    return (
      <section className="border-b border-[var(--shop-border)]" key={key}>
        <button
          type="button"
          onClick={() => toggle(key)}
          className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left text-xs font-bold text-white transition-colors hover:text-[var(--shop-blue)]"
          aria-expanded={isExpanded}
          aria-controls={contentId}
        >
          <span>{label}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--shop-subtle)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {isExpanded && <div id={contentId} className="pb-4">{content}</div>}
      </section>
    );
  };

  const selectClass = 'h-10 w-full appearance-none rounded-md border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 pr-9 text-xs font-bold text-white outline-none transition-colors focus:border-[var(--shop-blue)]';
  const inputClass = 'h-10 w-full rounded-md border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 text-xs text-white outline-none placeholder:text-[var(--shop-subtle)] focus:border-[var(--shop-blue)]';

  return (
    <div className="w-full bg-[var(--shop-bg)]" data-testid="filter-sidebar">
      <div className="flex items-center justify-between border-b border-[var(--shop-border)] pb-3">
        <h2 className="text-sm font-bold text-white">絞り込み</h2>
        <button type="button" onClick={onClear} className="text-xs font-bold text-[var(--shop-blue)] hover:text-white">クリア</button>
      </div>

      <div className="mt-1">
        {renderSection('category', 'カテゴリー', (
          <div className="space-y-3">
            <label className="relative block">
              <span className="sr-only">大カテゴリー</span>
              <select
                value={selectedCategory}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange('category', value);
                  onChange('subcategory', 'すべて');
                  onCategoryChange?.(value);
                }}
                className={selectClass}
                aria-label="大カテゴリー"
              >
                {filterCategories.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[var(--shop-subtle)]" aria-hidden="true" />
            </label>
            <label className="relative block">
              <span className="sr-only">小カテゴリー</span>
              <select value={availableSubcategories.includes(state.subcategory) ? state.subcategory : 'すべて'} onChange={(event) => onChange('subcategory', event.target.value)} className={selectClass} aria-label="小カテゴリー">
                {availableSubcategories.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[var(--shop-subtle)]" aria-hidden="true" />
            </label>
          </div>
        ))}

        {renderSection('brand', 'ブランド', <input value={state.brand} onChange={(event) => onChange('brand', event.target.value)} placeholder="入力してください" className={inputClass} aria-label="ブランド名" />)}
        {renderSection('size', 'サイズ', <div className="flex flex-wrap gap-2">{['XS', 'S', 'M', 'L', 'XL', 'その他'].map((value) => <ChoiceButton key={value} label={value} active={state.size === value} onClick={() => onChange('size', state.size === value ? '' : value)} />)}</div>)}
        {renderSection('sales', '販売状況', <div className="space-y-2">{[['all', 'すべて'], ['available', '販売中のみ'], ['sold', '売り切れのみ']].map(([value, label]) => <ChoiceButton key={value} label={label} active={state.salesStatus === value} onClick={() => onChange('salesStatus', value as FilterState['salesStatus'])} />)}</div>)}
        {renderSection('seller', '出品者', <div className="flex flex-wrap gap-2">{['個人', 'ショップ'].map((value) => <ChoiceButton key={value} label={value} active={state.sellerType === value} onClick={() => onChange('sellerType', state.sellerType === value ? '' : value)} />)}</div>)}
        {renderSection('condition', '商品の状態', <div className="space-y-2">{conditions.map((value) => <ChoiceButton key={value} label={value} active={state.condition === value} onClick={() => onChange('condition', state.condition === value ? '' : value)} />)}</div>)}
        {renderSection('price', '価格', <div className="flex items-center gap-2"><input aria-label="最低価格" type="number" min="0" inputMode="numeric" value={state.minPrice} onChange={(event) => onChange('minPrice', event.target.value)} placeholder="¥300" className={inputClass} /><span className="shrink-0 text-xs text-[var(--shop-subtle)]">〜</span><input aria-label="最高価格" type="number" min="0" inputMode="numeric" value={state.maxPrice} onChange={(event) => onChange('maxPrice', event.target.value)} placeholder="¥9,999,999" className={inputClass} /></div>)}
        {renderSection('discount', '割引オプション', <div className="flex flex-wrap gap-2">{['クーポン対象', 'タイムセール'].map((value) => <ChoiceButton key={value} label={value} active={state.discountOption === value} onClick={() => onChange('discountOption', state.discountOption === value ? '' : value)} />)}</div>)}
        {renderSection('appraisal', 'あんしん鑑定', <ChoiceButton label="あんしん鑑定対象" active={state.appraisal === '対象'} onClick={() => onChange('appraisal', state.appraisal === '対象' ? '' : '対象')} />)}
        {renderSection('listing', '出品形式', <div className="flex flex-wrap gap-2">{['通常出品', 'オークション'].map((value) => <ChoiceButton key={value} label={value} active={state.listingType === value} onClick={() => onChange('listingType', state.listingType === value ? '' : value)} />)}</div>)}
        {renderSection('guarantee', '保証付き整備品', <ChoiceButton label="保証付き整備品のみ" active={state.guarantee === '対象'} onClick={() => onChange('guarantee', state.guarantee === '対象' ? '' : '対象')} />)}
        {renderSection('color', '色', <div className="flex flex-wrap gap-2">{colors.map((value) => <ChoiceButton key={value} label={value} active={state.color === value} onClick={() => onChange('color', state.color === value ? '' : value)} />)}</div>)}
        {renderSection('shipping', '発送オプション', <div className="flex flex-wrap gap-2">{['匿名配送', 'らくらくメルカリ便', 'ゆうゆうメルカリ便'].map((value) => <ChoiceButton key={value} label={value} active={state.shippingOption === value} onClick={() => onChange('shippingOption', state.shippingOption === value ? '' : value)} />)}</div>)}
        {renderSection('shipping-fee', '配送料の負担', <div className="space-y-2">{['送料込み（出品者負担）', '着払い（購入者負担）'].map((value) => <ChoiceButton key={value} label={value} active={state.shippingFee === value} onClick={() => onChange('shippingFee', state.shippingFee === value ? '' : value)} />)}</div>)}
        {renderSection('time-sale', 'タイムセール割引率', <div className="flex flex-wrap gap-2">{['5%以上', '10%以上', '20%以上'].map((value) => <ChoiceButton key={value} label={value} active={state.timeSale === value} onClick={() => onChange('timeSale', state.timeSale === value ? '' : value)} />)}</div>)}
        {renderSection('exclude', '除外キーワード', <input value={state.excludeKeyword} onChange={(event) => onChange('excludeKeyword', event.target.value)} placeholder="除外するキーワード" className={inputClass} aria-label="除外キーワード" />)}
      </div>
    </div>
  );
};

const ChoiceButton: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button type="button" onClick={onClick} aria-pressed={active} className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors ${active ? 'font-bold text-[var(--shop-blue)]' : 'text-[var(--shop-muted)] hover:text-white'}`}>
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? 'border-[var(--shop-blue)] bg-[var(--shop-blue)] text-[#12202a]' : 'border-[var(--shop-border)]'}`} aria-hidden="true">{active && <Check className="h-3 w-3" />}</span>
    <span>{label}</span>
  </button>
);
