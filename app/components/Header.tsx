'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Layers3, Monitor, Search, ScanLine, Tag, X } from 'lucide-react';
import { useMercari } from '../context/MercariContext';
import { joinSearchTokens, tokenizeSearchQuery } from './searchUtils';
import type { HomeTab, MainTab } from '../types/mercari';
import { isBrowseDirectoryRoute } from './views/BrowseDirectoryView';

const desktopCategories = [
  ['My Shops', 'ショップ'],
  ['ゲーム・おもちゃ・グッズ', 'ゲーム・おもちゃ・グッズ'],
  ['本・雑誌・漫画', '本・雑誌・漫画'],
  ['メンズ', 'メンズ'],
  ['レディース', 'レディース'],
  ['ベビー・キッズ', 'ベビー・キッズ'],
] as const;

export const ShopMark: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <span
    className={`furima-sandbox-logo ${compact ? 'furima-sandbox-logo--compact' : ''}`}
    role="img"
    aria-label="Furima Sandbox"
  />
);

export const Header: React.FC = () => {
  const { mainTab, navigateToTab, homeTab, setHomeTab, categoryName, isSearchOpen, isDeviceFrame, setIsDeviceFrame, openCategory } = useMercari();
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateViewport = () => setIsNarrowViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  const mobileMode = isDeviceFrame || isNarrowViewport;
  const openHome = () => { navigateToTab('home'); setHomeTab('recommend'); };
  const openHomeTab = (tab: HomeTab) => { navigateToTab('home'); setHomeTab(tab); };
  const navigateCategory = (category: string) => { openCategory(category); };

  return (
    <header className="relative sticky top-0 z-40 border-b border-[var(--shop-border)] bg-[rgba(31,31,33,.96)] shadow-[0_6px_20px_rgba(0,0,0,.16)] backdrop-blur-xl" data-testid="shop-header">
      <div className={`mx-auto flex h-[58px] w-full max-w-[1368px] items-center gap-4 px-4 ${mobileMode ? '' : isSearchOpen ? 'md:h-[64px]' : 'md:h-[80px]'} md:px-0`}>
        <button type="button" className={mobileMode ? 'hidden shrink-0' : 'hidden shrink-0 md:block'} onClick={openHome} aria-label="Furima Sandboxホームへ戻る" data-testid="shop-logo"><ShopMark /></button>
        <div className={`grid flex-1 grid-cols-3 items-center ${mobileMode ? '' : 'md:block'}`}>
          <button type="button" className={mobileMode ? 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : 'justify-self-start md:hidden'} onClick={openHome} aria-label="Furima Sandboxホームへ戻る"><ShopMark compact={mobileMode} /></button>
          <HeaderSearch mobileMode={mobileMode} />
        </div>
        {!mobileMode && <GuestActions />}
        {mobileMode && isDeviceFrame && <button type="button" onClick={() => setIsDeviceFrame(false)} aria-label="PC表示に切り替える" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[var(--shop-muted)]"><Monitor className="h-4 w-4" /></button>}
      </div>
      {!mobileMode && !isSearchOpen && !isBrowseDirectoryRoute(categoryName) && <DesktopCategoryNav mainTab={mainTab} categoryName={categoryName} homeTab={homeTab} onHomeTab={openHomeTab} onCategory={navigateCategory} />}
    </header>
  );
};

const HeaderSearch: React.FC<{ mobileMode: boolean }> = ({ mobileMode }) => {
  const { searchQuery, setSearchQuery, setIsSearchOpen, searchHistory, addSearchHistory, clearSearchHistory, openCategory } = useMercari();
  const [draftQuery, setDraftQuery] = useState('');
  const [savedQueries, setSavedQueries] = useState<string[]>([]);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tokens = useMemo(() => tokenizeSearchQuery(searchQuery), [searchQuery]);

  useEffect(() => {
    if (mobileMode) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsAutocompleteOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [mobileMode]);

  const openSearchResults = (query = joinSearchTokens(tokens)) => {
    const nextQuery = query.trim();
    if (nextQuery) {
      setSearchQuery(nextQuery);
      addSearchHistory(nextQuery);
    }
    setDraftQuery('');
    setIsAutocompleteOpen(false);
    setIsSearchOpen(true);
  };

  const openDirectory = (mode: 'category' | 'brand') => {
    setIsAutocompleteOpen(false);
    setSearchQuery('');
    openCategory(mode === 'category' ? 'カテゴリー一覧' : 'ブランド一覧');
  };

  const handleDraftChange = (value: string) => {
    const parts = value.split(/[\s\u3000]+/u);
    const hasSeparator = /[\s\u3000]/u.test(value);
    if (!hasSeparator) {
      setDraftQuery(value);
      return;
    }
    const completed = parts.slice(0, -1).filter(Boolean);
    if (completed.length) setSearchQuery(joinSearchTokens(tokenizeSearchQuery([...tokens, ...completed].join(' '))));
    setDraftQuery(parts.at(-1) ?? '');
  };

  const removeToken = (index: number) => {
    setSearchQuery(joinSearchTokens(tokens.filter((_, tokenIndex) => tokenIndex !== index)));
    setDraftQuery('');
  };

  const toggleSavedQuery = (query: string) => {
    setSavedQueries((previous) => previous.includes(query) ? previous.filter((item) => item !== query) : [...previous, query]);
  };

  if (mobileMode) {
    return <button type="button" onClick={() => setIsSearchOpen(true)} aria-label="商品を検索" className="absolute right-12 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[var(--shop-muted)] hover:bg-[var(--shop-surface)] hover:text-white" data-testid="search-bar-trigger"><Search className="h-[19px] w-[19px]" /></button>;
  }

  return <div ref={rootRef} className="relative md:ml-9 md:w-full md:max-w-[560px]" data-testid="search-bar-trigger">
    <form onSubmit={(event) => { event.preventDefault(); openSearchResults(joinSearchTokens(tokenizeSearchQuery([...tokens, draftQuery].join(' ')))); }} role="search" aria-label="商品検索" className="flex h-9 min-h-0 w-full items-center gap-2 rounded-[7px] border border-[var(--shop-border)] bg-[#202022] px-3 py-1 focus-within:border-[var(--shop-blue)]">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" onFocus={() => setIsAutocompleteOpen(true)}>
        {tokens.map((token, index) => <span key={`${token}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--shop-border)] bg-[#2d2d30] px-3 py-1.5 text-sm text-white"><span className="truncate">{token}</span><button type="button" onClick={() => removeToken(index)} aria-label={`${token}を削除`} className="rounded-full text-[var(--shop-muted)] hover:text-white"><X className="h-3.5 w-3.5" /></button></span>)}
        <input value={draftQuery} onChange={(event) => handleDraftChange(event.target.value)} onFocus={() => setIsAutocompleteOpen(true)} placeholder={tokens.length ? '' : 'なにをお探しですか？'} aria-label="検索キーワードを入力" className="min-w-[100px] flex-1 bg-transparent py-1 text-sm text-white outline-none placeholder:text-[var(--shop-muted)]" />
      </div>
      <button type="button" aria-label="画像からさがす" onClick={() => setIsAutocompleteOpen(true)} className="shrink-0 text-[var(--shop-muted)] hover:text-white"><ScanLine className="h-[19px] w-[19px]" /></button>
      <button type="submit" aria-label="検索" className="shrink-0 text-[var(--shop-muted)] hover:text-white"><Search className="h-[19px] w-[19px]" /></button>
    </form>
    {isAutocompleteOpen && <div id="search-bar-autocomplete" role="combobox" aria-controls="search-bar-autocomplete-menu" aria-expanded="true" className="absolute left-0 top-full z-[70] mt-2 max-h-[min(620px,calc(100vh-120px))] w-full overflow-y-auto rounded-lg border border-[var(--shop-border)] bg-[#232325] p-4 shadow-[0_18px_44px_rgba(0,0,0,.45)]">
      <div id="search-bar-autocomplete-menu"><div className="mb-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => openDirectory('category')} className="flex items-center justify-center gap-2 rounded-full bg-[#303032] py-3 text-sm font-bold text-white hover:bg-[var(--shop-surface-raised)]"><Layers3 className="h-4 w-4" />カテゴリー</button><button type="button" onClick={() => openDirectory('brand')} className="flex items-center justify-center gap-2 rounded-full bg-[#303032] py-3 text-sm font-bold text-white hover:bg-[var(--shop-surface-raised)]"><Tag className="h-4 w-4" />ブランド</button></div>
      <div className="mb-3 flex items-center justify-between border-b border-[var(--shop-border)] pb-3"><h2 className="text-lg font-black text-white">検索履歴</h2>{searchHistory.length > 0 && <button type="button" onClick={clearSearchHistory} className="text-sm font-bold text-[var(--shop-blue)] hover:text-white">クリア</button>}</div>
      <div className="divide-y divide-[var(--shop-border)]">{searchHistory.slice(0, 8).map((historyQuery) => { const saved = savedQueries.includes(historyQuery); return <div key={historyQuery} className="flex items-center gap-3 py-4"><button type="button" onClick={() => openSearchResults(historyQuery)} className="min-w-0 flex-1 truncate text-left text-base font-bold text-white hover:text-[var(--shop-blue)]">{historyQuery}</button><button type="button" aria-label={saved ? `${historyQuery}の保存を解除` : `${historyQuery}の検索条件を保存`} onClick={() => toggleSavedQuery(historyQuery)} className={`shrink-0 hover:text-[var(--shop-accent)] ${saved ? 'text-[var(--shop-accent)]' : 'text-white'}`}><Heart className={`h-5 w-5 ${saved ? 'fill-current' : ''}`} /></button><button type="button" aria-label={`${historyQuery}を検索`} onClick={() => openSearchResults(historyQuery)} className="shrink-0 text-[var(--shop-muted)] hover:text-white"><span aria-hidden="true" className="text-2xl leading-none">›</span></button></div>; })}</div>
      {searchHistory.length === 0 && <p className="py-8 text-center text-sm text-[var(--shop-muted)]">検索履歴はありません</p>}
      <button type="button" onClick={() => setIsSearchOpen(true)} className="mt-4 text-xs font-bold text-[var(--shop-blue)] hover:text-white">検索のヘルプ</button></div>
    </div>}
  </div>;
};

const GuestActions: React.FC = () => {
  const { activePersona, setIsSandboxPanelOpen, navigateToTab } = useMercari();
  return <div className="flex shrink-0 items-center gap-1.5">
    <button type="button" onClick={() => setIsSandboxPanelOpen(true)} className="mr-1 flex items-center gap-2 rounded-full border border-[var(--shop-border)] bg-[var(--shop-surface)] py-1.5 pl-1.5 pr-3 text-sm font-bold text-white hover:border-[var(--shop-blue)]" aria-label="体験ユーザーを切り替える"><img src={activePersona.avatar} alt="" className="h-7 w-7 rounded-full object-cover" /><span className="max-w-24 truncate">{activePersona.name}</span></button>
    <button type="button" onClick={() => navigateToTab('notifications')} className="rounded-md px-2.5 py-2 text-sm font-bold text-white hover:bg-[var(--shop-surface)]">お知らせ</button>
    <button type="button" onClick={() => navigateToTab('sell')} className="rounded-md bg-[var(--shop-accent)] px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(255,59,74,.2)] hover:bg-[var(--shop-accent-strong)]">出品</button>
    <button type="button" className="rounded-md px-2 py-2 text-xs font-bold text-[var(--shop-muted)] hover:text-white">日本語</button>
  </div>;
};

const NavCategoryLabel: React.FC<{ label: string }> = ({ label }) => <span className="whitespace-nowrap">{label}</span>;

const DesktopCategoryNav: React.FC<{ mainTab: MainTab; categoryName: string | null; homeTab: HomeTab; onHomeTab: (tab: HomeTab) => void; onCategory: (query: string) => void }> = ({ mainTab, categoryName, homeTab, onHomeTab, onCategory }) => (
  <div className="hidden border-t border-[var(--shop-border)] bg-[rgba(17,17,18,.96)] md:block">
    <nav className="shop-category-font no-scrollbar mx-auto flex h-[64px] w-full max-w-[1280px] items-stretch justify-between overflow-x-auto px-9" aria-label="商品カテゴリナビゲーション">
      {([['recommend', 'おすすめ'], ['mylist', 'マイリスト'], ['auction', 'オークション']] as const).map(([tab, label]) => { const active = mainTab === 'home' && homeTab === tab; return <button type="button" key={tab} onClick={() => onHomeTab(tab)} aria-current={active ? 'page' : undefined} className={`relative flex h-full shrink-0 items-center justify-center whitespace-nowrap px-6 text-base font-medium tracking-[.01em] transition-colors ${active ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-muted)] hover:text-white'}`}>{label}{active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-[var(--shop-accent)]" />}</button>; })}
      {desktopCategories.map(([label, query]) => { const active = mainTab === 'category' && categoryName === query; return <button type="button" key={label} onClick={() => onCategory(query)} aria-current={active ? 'page' : undefined} className={`relative flex h-full shrink-0 items-center justify-center whitespace-nowrap px-6 text-base font-medium tracking-[.01em] transition-colors ${active ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-muted)] hover:text-white'}`}><NavCategoryLabel label={label} />{active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-[var(--shop-accent)]" />}</button>; })}
    </nav>
  </div>
);
