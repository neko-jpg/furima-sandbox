'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Heart, Layers3, LogOut, Monitor, Search, ScanLine, ShoppingBag, Tag, UserRound, Users, X } from 'lucide-react';
import { useMercari } from '../context/MercariContext';
import { joinSearchTokens, tokenizeSearchQuery } from './searchUtils';
import type { HomeTab, MainTab, MyPagePanel } from '../types/mercari';
import { isBrowseDirectoryRoute } from './views/BrowseDirectoryView';
import { HOME_TABS } from './homeTabs';
import { AvatarImage } from './ui/AvatarImage';

const desktopCategories = [
  ['My Shops', 'ショップ'],
  ['ゲーム・おもちゃ・グッズ', 'ゲーム・おもちゃ・グッズ'],
  ['本・雑誌・漫画', '本・雑誌・漫画'],
  ['メンズ', 'メンズ'],
  ['レディース', 'レディース'],
  ['ベビー・キッズ', 'ベビー・キッズ'],
] as const;
const SAVED_QUERY_STORAGE_KEY = 'shop-saved-queries-v1';

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
  const [savedQueries, setSavedQueries] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(SAVED_QUERY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as unknown : [];
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 10) : [];
    } catch {
      return [];
    }
  });
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tokens = useMemo(() => tokenizeSearchQuery(searchQuery), [searchQuery]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_QUERY_STORAGE_KEY, JSON.stringify(savedQueries.slice(0, 10)));
    } catch {
      // Storage can be unavailable in private browsing or embedded previews.
    }
  }, [savedQueries]);

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
    setSavedQueries((previous) => previous.includes(query) ? previous.filter((item) => item !== query) : [query, ...previous].slice(0, 10));
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

const accountMenuItems = [
  { label: 'マイページ', panel: null, icon: UserRound },
  { label: 'プロフィール', panel: 'profile', icon: UserRound },
  { label: 'フォローリスト', panel: 'followers', icon: Users },
  { label: '購入した商品', panel: 'purchases', icon: ShoppingBag },
] as const;

const GuestActions: React.FC = () => {
  const { requestLogin, navigateToTab, activeActor, user, profile, openMyPagePanel, switchActor } = useMercari();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  const closeAccountMenu = () => setIsAccountMenuOpen(false);
  const focusFirstMenuItem = () => {
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
  };

  useEffect(() => {
    if (!isAccountMenuOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeAccountMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAccountMenu();
        accountButtonRef.current?.focus({ preventScroll: true });
        return;
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !menuRef.current) return;
      const menuItems = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
      if (currentIndex < 0 || menuItems.length === 0) return;
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown'
        ? (currentIndex + 1) % menuItems.length
        : (currentIndex - 1 + menuItems.length) % menuItems.length;
      menuItems[nextIndex]?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  const openMenuItem = (panel: MyPagePanel | null) => {
    closeAccountMenu();
    if (!activeActor.authenticated) {
      requestLogin('マイページの機能を利用するにはログインが必要です。');
      return;
    }
    openMyPagePanel(panel);
  };

  const logout = () => {
    const result = switchActor('guest');
    closeAccountMenu();
    if (result.ok) navigateToTab('home');
  };

  return <div className="flex shrink-0 items-center gap-1.5">
    <div ref={menuRef} className="relative hidden md:block">
      <button
        ref={accountButtonRef}
        type="button"
        onClick={() => setIsAccountMenuOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsAccountMenuOpen(true);
            focusFirstMenuItem();
          }
        }}
        aria-haspopup="menu"
        aria-expanded={isAccountMenuOpen}
        aria-controls="desktop-account-menu"
        className="inline-flex items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-sm font-bold text-white hover:border-[var(--shop-border)] hover:bg-[var(--shop-surface)]"
        data-testid="account-menu-trigger"
        title={`現在のactor: ${activeActor.id}`}
      >
        <AvatarImage src={user.avatar} mediaRef={profile?.avatarRef} alt="" className="h-8 w-8 rounded-full object-cover" />
        <span className="max-w-[130px] truncate">{user.name}</span>
        <ChevronDown className={`h-4 w-4 text-[var(--shop-muted)] transition-transform ${isAccountMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {isAccountMenuOpen && <div id="desktop-account-menu" role="menu" aria-label="アカウントメニュー" className="absolute right-0 top-full z-[90] mt-2 w-[272px] overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[#262628] p-2 shadow-[0_18px_44px_rgba(0,0,0,.45)]">
        {accountMenuItems.map(({ label, panel, icon: Icon }) => <button key={label} type="button" role="menuitem" onClick={() => openMenuItem(panel)} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-bold text-white hover:bg-[var(--shop-surface-raised)] focus:bg-[var(--shop-surface-raised)] focus:outline-none">
          <Icon className="h-4 w-4 shrink-0 text-[var(--shop-muted)]" aria-hidden="true" />
          <span className="flex-1">{label}</span>
          <ChevronRight className="h-4 w-4 text-[var(--shop-muted)]" aria-hidden="true" />
        </button>)}
        <div className="my-2 border-t border-[var(--shop-border)]" />
        <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-bold text-[var(--shop-blue)] hover:bg-[var(--shop-surface-raised)] focus:bg-[var(--shop-surface-raised)] focus:outline-none">
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">ログアウト</span>
        </button>
      </div>}
    </div>
    {!activeActor.authenticated && <><button type="button" onClick={() => requestLogin('ログインすると、いいね・保存・購入などの機能を利用できます。')} className="rounded-md px-2.5 py-2 text-sm font-bold text-white hover:bg-[var(--shop-surface)]">ログイン</button><button type="button" onClick={() => requestLogin('会員登録すると、商品を購入・出品できます。')} className="rounded-md px-2.5 py-2 text-sm font-bold text-white hover:bg-[var(--shop-surface)]">会員登録</button></>}
    <button type="button" onClick={() => navigateToTab('notifications')} className="rounded-md px-2.5 py-2 text-sm font-bold text-white hover:bg-[var(--shop-surface)]">お知らせ</button>
    <button type="button" onClick={() => navigateToTab('sell')} className="rounded-md bg-[var(--shop-accent)] px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(255,59,74,.2)] hover:bg-[var(--shop-accent-strong)]">出品</button>
    <button type="button" disabled aria-disabled="true" data-feature-status="sandbox-out-of-scope" className="cursor-not-allowed rounded-md px-2 py-2 text-xs font-bold text-[var(--shop-muted)]">日本語（固定）</button>
  </div>;
};

const NavCategoryLabel: React.FC<{ label: string }> = ({ label }) => <span className="whitespace-nowrap">{label}</span>;

const DesktopCategoryNav: React.FC<{ mainTab: MainTab; categoryName: string | null; homeTab: HomeTab; onHomeTab: (tab: HomeTab) => void; onCategory: (query: string) => void }> = ({ mainTab, categoryName, homeTab, onHomeTab, onCategory }) => (
  <div className="hidden border-t border-[var(--shop-border)] bg-[rgba(17,17,18,.96)] md:block">
    <nav className="shop-category-font no-scrollbar mx-auto flex h-[64px] w-full max-w-[1280px] items-stretch justify-between overflow-x-auto px-9" aria-label="商品カテゴリナビゲーション">
      {HOME_TABS.map(({ tab, label }) => { const active = mainTab === 'home' && homeTab === tab; return <button type="button" key={tab} onClick={() => onHomeTab(tab)} aria-current={active ? 'page' : undefined} className={`relative flex h-full shrink-0 items-center justify-center whitespace-nowrap px-6 text-base font-medium tracking-[.01em] transition-colors ${active ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-muted)] hover:text-white'}`}>{label}{active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-[var(--shop-accent)]" />}</button>; })}
      {desktopCategories.map(([label, query]) => { const active = mainTab === 'category' && categoryName === query; return <button type="button" key={label} onClick={() => onCategory(query)} aria-current={active ? 'page' : undefined} className={`relative flex h-full shrink-0 items-center justify-center whitespace-nowrap px-6 text-base font-medium tracking-[.01em] transition-colors ${active ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-muted)] hover:text-white'}`}><NavCategoryLabel label={label} />{active && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-[var(--shop-accent)]" />}</button>; })}
    </nav>
  </div>
);
