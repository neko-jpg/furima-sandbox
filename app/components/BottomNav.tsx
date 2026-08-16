'use client';

import React from 'react';
import { Bell, Camera, Home, UserRound } from 'lucide-react';
import { useMercari } from '../context/MercariContext';
import type { MainTab } from '../types/mercari';

const tabs: Array<{ tab: MainTab; label: string; icon: React.ElementType }> = [
  { tab: 'home', label: 'ホーム', icon: Home },
  { tab: 'notifications', label: 'お知らせ', icon: Bell },
  { tab: 'sell', label: '出品', icon: Camera },
  { tab: 'mypage', label: 'マイページ', icon: UserRound },
];

export const BottomNav: React.FC = () => {
  const { mainTab, navigateToTab, notifications, isDeviceFrame } = useMercari();
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;
  const handleTabClick = (tab: MainTab) => { navigateToTab(tab); };
  const positioning = isDeviceFrame ? 'absolute inset-x-0 bottom-0' : 'fixed inset-x-0 bottom-0 md:hidden';
  return <nav className={`${positioning} z-40 flex h-[58px] items-stretch justify-around border-t border-[var(--shop-border)] bg-[rgba(31,31,33,.97)] px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgba(0,0,0,.16)] backdrop-blur-xl`} data-testid="bottom-navigation" aria-label="モバイルナビゲーション">{tabs.map(({ tab, label, icon: Icon }) => <button key={tab} type="button" onClick={() => handleTabClick(tab)} aria-current={mainTab === tab ? 'page' : undefined} className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${mainTab === tab ? 'font-bold text-white' : 'text-[var(--shop-muted)]'}`} data-testid={`nav-${tab}`}><Icon className={`h-[21px] w-[21px] ${mainTab === tab ? 'text-[var(--shop-accent)]' : ''}`} strokeWidth={mainTab === tab ? 2.6 : 1.8} />{tab === 'notifications' && unreadCount > 0 && <span className="absolute right-[calc(50%-16px)] top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--shop-accent)] px-0.5 text-[8px] font-black text-white">{unreadCount}</span>}<span>{label}</span></button>)}</nav>;
};
