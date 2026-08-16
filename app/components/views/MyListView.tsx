'use client';

import React, { useMemo } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import type { MercariItem } from '../../types/mercari';
import { ShopImage } from '../ui/ShopImage';
import { AvatarImage } from '../ui/AvatarImage';

export const MyListView: React.FC = () => {
  const { items, recentlyViewedIds, openItem, setIsSearchOpen, setSearchQuery, getFollowList } = useMercari();
  const followingResult = getFollowList('following');
  const followingUsers = followingResult.ok ? followingResult.data.users : [];
  const recentlyViewedItems = useMemo(() => {
    const viewed = recentlyViewedIds
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is MercariItem => Boolean(item));
    const viewedIds = new Set(viewed.map((item) => item.id));
    const additional = items.filter((item) => !item.isAuction && !viewedIds.has(item.id));
    return [...viewed, ...additional].slice(0, 10);
  }, [items, recentlyViewedIds]);

  const openSearch = () => {
    setSearchQuery('');
    setIsSearchOpen(true);
  };

  return (
    <div className="space-y-8" data-testid="my-list-view">
      <section>
        <MyListHeading title="保存した検索条件" />
        <p className="mb-4 text-[15px] leading-[21px] text-[var(--shop-muted)]">保存している検索条件はありません</p>
        <hr className="mb-2 border-0 border-t border-[var(--shop-border)]" />
        <div className="mb-0 mt-4 flex min-h-9 items-center justify-end">
          <button type="button" onClick={openSearch} className="inline-flex items-center gap-1 text-[15px] leading-[21px] text-white hover:text-[var(--shop-blue)]">
            検索条件の保存について
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="h-2" aria-hidden="true" />
      </section>

      <section>
        <MyListHeading title="あなたの興味のある商品" />
        <hr className="mb-6 border-0 border-t border-[var(--shop-border)]" />
        <section className="mb-6">
          <div className="mb-6 flex min-h-9 items-center justify-between gap-3">
            <h3 className="text-base font-bold leading-6 text-white md:text-lg">最近閲覧した商品</h3>
            <button type="button" onClick={openSearch} className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-[var(--shop-blue)] hover:text-white">
              すべて見る
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 lg:gap-6">
            {recentlyViewedItems.map((item) => <MyListProductCard key={item.id} item={item} onOpen={() => openItem(item.id)} />)}
          </div>
        </section>
        <hr className="border-0 border-t border-[var(--shop-border)]" />
      </section>

      <section>
        <MyListHeading title="フォロー中のユーザー" />
        {followingUsers.length ? <div className="mb-4 grid gap-2 sm:grid-cols-2">{followingUsers.slice(0, 6).map((profile) => <div key={profile.actorId} className="flex items-center gap-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3"><AvatarImage src={profile.avatar} mediaRef={profile.avatarRef} alt="" className="h-10 w-10 rounded-full object-cover" /><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{profile.displayName}</p><p className="mt-1 truncate text-xs text-[var(--shop-muted)]">{profile.bio || '自己紹介はありません'}</p></div></div>)}</div> : <p className="mb-4 text-[15px] leading-[21px] text-[var(--shop-muted)]">フォローしているアカウントはありません</p>}
        <hr className="mb-2 border-0 border-t border-[var(--shop-border)]" />
        <div className="mb-2 mt-4 flex min-h-9 items-center justify-end">
          <button type="button" onClick={() => setIsSearchOpen(true)} className="inline-flex items-center gap-1 text-[15px] leading-[21px] text-white hover:text-[var(--shop-blue)]">
            フォロー機能について
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
};

const MyListHeading: React.FC<{ title: string }> = ({ title }) => <h2 className="mb-4 text-xl font-bold leading-7 text-[var(--shop-muted)]">{title}</h2>;

const MyListProductCard: React.FC<{ item: MercariItem; onOpen: () => void }> = ({ item, onOpen }) => (
  <article className="group min-w-0">
    <button type="button" onClick={onOpen} className="block w-full text-left" data-testid={`my-list-item-${item.id}`}>
      <div className="relative aspect-square overflow-hidden rounded-lg bg-[var(--shop-surface)]">
        <ShopImage src={item.images[0]} alt={`${item.title}のサムネイル${item.isSold ? ' 売り切れ' : ''}`} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        {item.isSold && <span className="absolute -left-7 top-3 z-10 w-24 -rotate-45 bg-[var(--shop-accent)] py-1 text-center text-[10px] font-black tracking-wide text-white shadow">SOLD</span>}
        <span className="absolute bottom-2 left-2 rounded-full bg-black/85 px-2 py-0.5 text-xs font-black text-white">¥{(item.currentBid ?? item.price).toLocaleString()}</span>
      </div>
      <p className="mt-2 line-clamp-2 min-h-[42px] text-[15px] leading-[21px] text-[#e5e5e5]">{item.title}</p>
    </button>
  </article>
);
