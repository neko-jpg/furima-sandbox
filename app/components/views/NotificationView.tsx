'use client';

import React, { useEffect, useState } from 'react';
import { Bell, ChevronRight, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';

export const NotificationView: React.FC = () => {
  const { notifications, activeNotification, openNotification, setActiveNotification } = useMercari();
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'you' | 'campaign'>('you');
  const filtered = notifications.filter((item) => activeSubTab === 'all' || item.type === activeSubTab);
  useEffect(() => {
    if (!activeNotification) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveNotification(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeNotification, setActiveNotification]);

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="notification-view">
      <div className="mx-auto max-w-[980px] px-4 pb-24 md:px-7"><div className="flex items-center justify-between border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">お知らせ</h1><button type="button" disabled aria-disabled="true" data-feature-status="sandbox-out-of-scope" className="cursor-not-allowed text-xs font-bold text-[var(--shop-muted)]">ニュース（対象外）</button></div>
        <div className="my-4 flex gap-2" role="tablist" aria-label="お知らせの種類">{([['all', 'すべて'], ['you', 'あなた宛'], ['campaign', 'キャンペーン']] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={activeSubTab === tab} onClick={() => setActiveSubTab(tab)} className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${activeSubTab === tab ? 'border-[var(--shop-blue)] bg-[#16394d] font-bold text-[var(--shop-blue)]' : 'border-[var(--shop-border)] text-[var(--shop-muted)] hover:text-white'}`}>{label}</button>)}</div>
        <div className="divide-y divide-[var(--shop-border)] overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)]">{filtered.map((item) => <button key={item.id} type="button" onClick={() => openNotification(item.id)} className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[var(--shop-surface-raised)]" data-testid={`notification-item-${item.id}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--shop-accent)] text-white"><Bell className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className={`block line-clamp-2 text-sm leading-5 ${item.isRead ? 'text-[var(--shop-muted)]' : 'font-bold text-white'}`}>{item.title}</span><span className="mt-1 block text-xs text-[var(--shop-subtle)]">{item.date}</span></span>{!item.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--shop-accent)]" aria-label="未読" />}<ChevronRight className="mt-2 h-4 w-4 shrink-0 text-[var(--shop-subtle)]" /></button>)}</div>
        <button type="button" disabled aria-disabled="true" data-feature-status="sandbox-out-of-scope" className="mt-5 flex w-full cursor-not-allowed items-center justify-between rounded-lg border border-[var(--shop-border)] bg-[#122b3a] px-4 py-3 text-sm font-bold text-[var(--shop-muted)]">キャンペーン（Sandbox対象外）</button>
      </div>
      {activeNotification && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="notification-dialog-title"><div className="w-full max-w-md rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-fade-in"><div className="flex items-center justify-between border-b border-[var(--shop-border)] pb-4"><h2 id="notification-dialog-title" className="font-bold text-white">お知らせ詳細</h2><button type="button" onClick={() => setActiveNotification(null)} aria-label="お知らせを閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)] hover:text-white"><X className="h-5 w-5" /></button></div><p className="mt-5 text-sm font-bold leading-6 text-white">{activeNotification.title}</p><p className="mt-3 text-sm leading-6 text-[var(--shop-muted)]">{activeNotification.content}</p><p className="mt-4 text-right text-xs text-[var(--shop-subtle)]">{activeNotification.date}</p><button type="button" onClick={() => setActiveNotification(null)} className="mt-5 w-full rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-bold text-white">閉じる</button></div></div>}
    </div>
  );
};
