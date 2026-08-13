'use client';

import React from 'react';
import { ArrowRight, Heart, Star } from 'lucide-react';
import type { MercariItem } from '../../types/mercari';

export const SectionHeader: React.FC<{
  title: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, icon, actionLabel = 'すべて見る', onAction }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="flex min-w-0 items-center gap-2 text-base font-bold text-white md:text-lg">
      {icon}
      <span className="truncate">{title}</span>
    </h2>
    {actionLabel && (
      <button type="button" onClick={onAction} disabled={!onAction} className="flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--shop-blue)] enabled:hover:text-white disabled:cursor-default disabled:opacity-80 md:text-sm">
        {actionLabel}
        <ArrowRight className="h-4 w-4" />
      </button>
    )}
  </div>
);

export const RatingStars: React.FC<{ rating: number; size?: 'sm' | 'md' }> = ({ rating, size = 'sm' }) => (
  <span className="inline-flex text-[#ffc107]" aria-label={`評価 ${rating.toFixed(1)}`}>
    {[0, 1, 2, 3, 4].map((index) => (
      <Star key={index} className={`${size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} ${index + 0.5 <= rating ? 'fill-current' : ''}`} />
    ))}
  </span>
);

export const ProductCard: React.FC<{
  item: MercariItem;
  onOpen: () => void;
  onLike?: (liked: boolean) => void;
  compact?: boolean;
}> = ({ item, onOpen, onLike, compact = false }) => (
  <article className={`group relative min-w-0 overflow-hidden border border-[var(--shop-border)] bg-[var(--shop-surface)] transition-transform hover:-translate-y-0.5 hover:border-[#68686f] ${compact ? 'rounded-md' : 'rounded-lg'}`}>
    <button type="button" onClick={onOpen} className="block w-full text-left" data-testid={`item-card-${item.id}`}>
      <div className="relative aspect-square overflow-hidden bg-[#3b3b3e]">
        <img src={item.images[0]} alt={item.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        {item.isSold && <span className="absolute -left-5 top-2 z-10 w-16 -rotate-45 bg-[var(--shop-accent)] py-0.5 text-center text-[8px] font-black tracking-wide text-white shadow">SOLD</span>}
        {item.isDemo && !item.isSold && <span className="absolute right-2 top-2 rounded-full border border-white/15 bg-[#143247]/95 px-1.5 py-0.5 text-[8px] font-black tracking-wide text-[var(--shop-blue)] shadow">DEMO</span>}
        {item.isAuction && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white">入札 {item.bidsCount ?? 0}</span>}
        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-black text-white">¥{(item.currentBid ?? item.price).toLocaleString()}</span>
      </div>
      <div className="hidden p-2.5 sm:block">
        <p className="line-clamp-2 min-h-[35px] text-xs leading-4 text-white md:text-[13px]">{item.title}</p>
        <p className="mt-1 truncate text-[10px] text-[var(--shop-subtle)]">{item.seller.name} ・ ★{item.seller.rating.toFixed(1)}{item.inventoryPolicy === 'MULTI' && !item.isSold && ` ・ 在庫${item.inventoryQuantity ?? 1}点`}</p>
      </div>
    </button>
    {onLike && (
      <button type="button" onClick={() => onLike(!item.isLiked)} aria-label={item.isLiked ? 'いいねを外す' : 'いいねする'} className={`absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1.5 backdrop-blur transition-colors ${item.isLiked ? 'text-[var(--shop-accent)]' : 'text-white hover:text-[var(--shop-accent)]'}`}>
        <Heart className={`h-3.5 w-3.5 ${item.isLiked ? 'fill-current' : ''}`} />
      </button>
    )}
  </article>
);
