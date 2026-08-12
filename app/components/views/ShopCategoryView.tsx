'use client';

import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Search } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { ProductCard } from '../ui/ShopPrimitives';

export const shopCategoryGroups = [
  { name: 'ファッション', icon: '👕', items: ['レディース', 'メンズ'] },
  { name: 'ベビー・キッズ', icon: '🧸', items: ['ベビー服(~95cm)', 'ベビーシューズ', 'ベビー用ファッション小物', 'ベビー家具・寝具', 'ベビー用セーフティグッズ', 'キッズ服(100cm~)', 'キッズシューズ', 'キッズファッション小物', '子ども用家具・寝具'] },
  { name: 'ゲーム・おもちゃ・グッズ', icon: '🎮', items: ['テレビゲーム', 'トレーディングカード', 'キャラクターグッズ', 'フィギュア', 'おもちゃ', 'パズル・ボードゲーム'] },
  { name: 'テレビ・オーディオ・カメラ', icon: '📺', items: ['テレビ・映像機器', 'オーディオ機器', 'カメラ', '望遠鏡・光学機器'] },
  { name: '生活家電・空調', icon: '🧺', items: ['生活家電', '冷暖房・空調', '電池・充電池'] },
  { name: 'スポーツ', icon: '🏀', items: ['ゴルフ', '野球', 'サッカー・フットサル', 'バスケットボール', '卓球', 'テニス'] },
  { name: 'キッチン・日用品・その他', icon: '⬛', items: ['キッチン・食器', '掃除用具', '洗濯用品', 'タオル・バス用品', 'スリッパ・サンダル', 'トイレ用品', '芳香剤・除湿剤・防虫剤', '文房具・事務用品', '防犯・セーフティ', '防災関連グッズ', '季節・年中行事', '冠婚葬祭・宗教用品', 'まとめ売り'] },
  { name: '本・雑誌・漫画', icon: '📚', items: ['本', '雑誌', '漫画', '絵本・児童書'] },
  { name: '食品・飲料・酒', icon: '🍎', items: ['食品', 'お菓子', '飲料・お酒', '米・穀物'] },
] as const;

const categoryKey = (name: string) => `ショップカテゴリ:${name}`;

export const isShopCategoryRoute = (name: string | null): boolean => Boolean(name?.startsWith('ショップカテゴリ:'));

export const ShopCategoryView: React.FC = () => {
  const { categoryName, navigateToTab, openCategory, items, openItem, setLiked, isDeviceFrame, setIsSearchOpen, setSearchQuery } = useMercari();
  const selected = categoryName?.startsWith('ショップカテゴリ:') ? categoryName.slice('ショップカテゴリ:'.length) : null;
  const selectedGroup = shopCategoryGroups.find((group) => group.name === selected);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const shopItems = items.filter((item) => !item.isAuction);
  const results = useMemo(() => {
    if (!selected) return [];
    const categoryResults = shopItems.filter((item) => item.category.some((value) => value.includes(selected) || selected.includes(value)));
    return selectedSubcategory ? categoryResults.filter((item) => item.category.some((value) => value.includes(selectedSubcategory) || selectedSubcategory.includes(value))) : categoryResults;
  }, [selected, selectedSubcategory, shopItems]);
  const openSearch = () => { setSearchQuery(selected || ''); setIsSearchOpen(true); };

  if (selected && selectedGroup) {
    return <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="shop-category-view">
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-14 pt-6 md:px-7 lg:px-9">
        <button type="button" onClick={() => openCategory('ショップカテゴリ一覧')} className="mb-6 flex items-center gap-1 text-sm font-bold text-[var(--shop-blue)] hover:text-white"><ArrowLeft className="h-4 w-4" />ショップカテゴリ</button>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs text-[var(--shop-muted)]">My Shops / カテゴリ</p><h1 className="text-2xl font-black text-white md:text-3xl">{selectedGroup.icon} {selectedGroup.name}</h1><p className="mt-2 text-sm text-[var(--shop-muted)]">My Shopsの商品をカテゴリから探せます</p></div><button type="button" onClick={openSearch} className="flex items-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-4 py-2.5 text-sm font-bold text-white hover:border-[var(--shop-blue)]"><Search className="h-4 w-4" />このカテゴリを検索</button></div>
        <div className="mb-8 flex flex-wrap gap-2 border-b border-[var(--shop-border)] pb-6">{selectedGroup.items.map((item) => <button type="button" key={item} onClick={() => setSelectedSubcategory((current) => current === item ? null : item)} className={`rounded-full border px-3 py-2 text-xs font-bold transition-colors ${selectedSubcategory === item ? 'border-[var(--shop-blue)] bg-[var(--shop-blue)]/15 text-[var(--shop-blue)]' : 'border-[var(--shop-border)] bg-[var(--shop-surface)] text-white hover:border-[var(--shop-blue)]'}`}>{item}</button>)}</div>
        {selectedSubcategory && results.length === 0 ? <div className="rounded-lg border border-dashed border-[var(--shop-border)] py-16 text-center text-sm text-[var(--shop-muted)]">「{selectedSubcategory}」の商品は見つかりませんでした。</div> : <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 ${isDeviceFrame ? '' : 'lg:gap-5'}`}>{(results.length ? results : shopItems).slice(0, 20).map((item) => <ProductCard key={item.id} item={item} compact={isDeviceFrame} onOpen={() => openItem(item.id)} onLike={(liked) => setLiked(item.id, liked)} />)}</div>}
      </div>
    </div>;
  }

  return <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="shop-category-view">
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-14 pt-6 md:px-7 lg:px-9">
      <div className="mb-7 flex items-end justify-between gap-4"><div><button type="button" onClick={() => navigateToTab('category')} className="mb-4 flex items-center gap-1 text-sm font-bold text-[var(--shop-blue)] hover:text-white"><ArrowLeft className="h-4 w-4" />My Shops</button><p className="mb-2 text-xs text-[var(--shop-muted)]">ホーム / My Shops / カテゴリー</p><h1 className="text-2xl font-black text-white md:text-3xl">My Shops カテゴリー</h1></div><button type="button" onClick={() => { setSearchQuery(''); setIsSearchOpen(true); }} className="hidden items-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-4 py-2.5 text-sm font-bold text-white hover:border-[var(--shop-blue)] sm:flex"><Search className="h-4 w-4" />My Shopsを検索</button></div>
      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2 lg:grid-cols-3">{shopCategoryGroups.map((group) => <section key={group.name}><button type="button" onClick={() => openCategory(categoryKey(group.name))} className="mb-4 flex w-full items-center justify-between text-left text-lg font-black text-white hover:text-[var(--shop-blue)]"><span className="flex items-center gap-2"><span aria-hidden="true">{group.icon}</span>{group.name}</span><ChevronRight className="h-5 w-5 text-[var(--shop-muted)]" /></button><div className="flex flex-wrap gap-2">{group.items.map((item) => <button type="button" key={item} onClick={() => openCategory(categoryKey(group.name))} className="rounded-lg bg-[var(--shop-surface)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--shop-surface-raised)] hover:text-[var(--shop-blue)]">{item}</button>)}</div></section>)}</div>
    </div>
  </div>;
};
