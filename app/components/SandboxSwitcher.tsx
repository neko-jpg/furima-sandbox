'use client';

import React from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  CircleDollarSign,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useMercari } from '../context/MercariContext';

export const SandboxToolbar: React.FC = () => {
  const { activePersona, marketplaceState, personas, setIsSandboxPanelOpen, isDeviceFrame } = useMercari();
  const availableListings = marketplaceState.listings.filter((listing) => listing.status === 'PUBLISHED').length;
  const activeTransactions = marketplaceState.transactions.filter((transaction) => transaction.transactionStatus === 'ACTIVE').length;

  return (
    <section className="border-b border-[#31515f] bg-[linear-gradient(90deg,#112b35,#173643_55%,#12272f)] text-white" aria-label="サンドボックス操作バー" data-testid="sandbox-toolbar">
      <div className="mx-auto flex min-h-[56px] w-full max-w-[1368px] items-center gap-3 px-4 md:px-0">
        <div className="hidden items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--shop-success)] md:flex">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--shop-success)] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--shop-success)]" /></span>
          Live sandbox
        </div>

        <button
          type="button"
          onClick={() => setIsSandboxPanelOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5 md:flex-none"
          aria-label={`${activePersona.name}から別の架空ユーザーへ切り替える`}
        >
          <img src={activePersona.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full border-2 border-white/70 object-cover" />
          <span className="min-w-0">
            <span className="block text-[10px] font-bold text-[#9fc6d4]">このユーザーとして体験中</span>
            <span className="block truncate text-sm font-black text-white">{activePersona.name}</span>
          </span>
          <span className="ml-1 hidden rounded-full border border-[#517889] px-2 py-1 text-[10px] font-bold text-[#c5e7f2] sm:inline">切り替える</span>
        </button>

        {!isDeviceFrame && (
          <div className="ml-auto hidden items-center gap-5 md:flex" aria-label="サンドボックス内の市場状況">
            <WorldStat icon={<Users className="h-3.5 w-3.5" />} value={`${personas.length}人`} label="体験ユーザー" />
            <WorldStat icon={<ShoppingBag className="h-3.5 w-3.5" />} value={`${availableListings}件`} label="公開中" />
            <WorldStat icon={<Activity className="h-3.5 w-3.5" />} value={`${activeTransactions}件`} label="進行中の取引" />
          </div>
        )}

        <button type="button" onClick={() => setIsSandboxPanelOpen(true)} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-black text-[#17313b] hover:bg-[#dff4fb]">
          {isDeviceFrame ? 'ユーザー選択' : 'サンドボックスを開く'}
        </button>
      </div>
    </section>
  );
};

const WorldStat: React.FC<{ icon: React.ReactNode; value: string; label: string }> = ({ icon, value, label }) => (
  <div className="flex items-center gap-2">
    <span className="text-[#7fd3ef]">{icon}</span>
    <span><span className="block text-xs font-black leading-none text-white">{value}</span><span className="mt-1 block text-[9px] leading-none text-[#85adbc]">{label}</span></span>
  </div>
);

export const SandboxPanel: React.FC = () => {
  const {
    activePersona,
    personas,
    marketplaceState,
    sandboxActivity,
    isSandboxPanelOpen,
    setIsSandboxPanelOpen,
    switchPersona,
    navigateToTab,
  } = useMercari();

  if (!isSandboxPanelOpen) return null;

  const activeTransaction = marketplaceState.transactions.find((transaction) => transaction.transactionStatus === 'ACTIVE');
  const listing = activeTransaction && marketplaceState.listings.find((candidate) => candidate.id === activeTransaction.listingId);
  const item = listing && marketplaceState.items.find((candidate) => candidate.id === listing.itemId);

  const enterAs = (userId: string) => {
    const result = switchPersona(userId);
    if (result.ok) {
      navigateToTab('mypage');
      setIsSandboxPanelOpen(false);
    }
  };

  const resetScenario = () => {
    window.__FURIMA_SANDBOX_API__?.resetScenario({ requestId: `reset-${Date.now()}` });
    setIsSandboxPanelOpen(false);
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-stretch justify-end bg-black/75 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="sandbox-panel-title" data-testid="sandbox-panel">
      <button type="button" className="min-w-0 flex-1 cursor-default" onClick={() => setIsSandboxPanelOpen(false)} aria-label="サンドボックスを閉じる" />
      <div className="shop-scrollbar h-full w-full max-w-[720px] overflow-y-auto border-l border-[#3e5964] bg-[#172126] shadow-2xl animate-slide-in-right">
        <header className="sticky top-0 z-10 border-b border-[#34464e] bg-[rgba(23,33,38,.96)] px-5 py-5 backdrop-blur-xl md:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--shop-success)]"><Sparkles className="h-3.5 w-3.5" />Furima Sandbox</div>
              <h2 id="sandbox-panel-title" className="text-xl font-black text-white md:text-2xl">誰として市場に入りますか？</h2>
              <p className="mt-2 max-w-xl text-xs leading-5 text-[#9eb0b8]">全員が同じ市場を共有しています。ユーザーを切り替えると、同じ取引が買い手側・売り手側からどう見えるかを続けて体験できます。</p>
            </div>
            <button type="button" onClick={() => setIsSandboxPanelOpen(false)} aria-label="閉じる" className="rounded-full border border-[#40535b] p-2 text-[#a8bac1] hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="space-y-8 p-5 md:p-7">
          <section aria-labelledby="personas-title">
            <div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#6f929f]">Step into a user</p><h3 id="personas-title" className="mt-1 text-base font-black text-white">架空ユーザー</h3></div><span className="text-[10px] text-[#78939e]">データは全ユーザーで共有</span></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {personas.map((persona) => {
                const active = persona.id === activePersona.id;
                return (
                  <article key={persona.id} className={`relative overflow-hidden rounded-2xl border p-4 transition-colors ${active ? 'border-[#75cce8] bg-[#183743]' : 'border-[#36484f] bg-[#202b30] hover:border-[#56737e]'}`}>
                    <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: persona.accent }} />
                    <div className="flex items-start gap-3">
                      <img src={persona.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="truncate font-black text-white">{persona.name}</h4>{persona.isVerified && <ShieldCheck className="h-3.5 w-3.5 text-[var(--shop-success)]" />}{active && <span className="rounded-full bg-[#75cce8] px-2 py-0.5 text-[9px] font-black text-[#10272f]">体験中</span>}</div><p className="mt-0.5 text-[10px] font-bold" style={{ color: persona.accent }}>{persona.role}</p></div>
                    </div>
                    <p className="mt-3 min-h-10 text-[11px] leading-5 text-[#a5b6bc]">{persona.bio}</p>
                    <div className="mt-3 grid grid-cols-3 divide-x divide-[#3a4b52] rounded-lg bg-black/15 py-2 text-center"><MiniStat value={String(persona.listingsCount)} label="出品" /><MiniStat value={String(persona.activeTransactionsCount)} label="取引中" /><MiniStat value={String(persona.pendingTasksCount)} label="やること" /></div>
                    <button type="button" disabled={active} onClick={() => enterAs(persona.id)} className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-black ${active ? 'cursor-default bg-white/5 text-[#78939e]' : 'bg-white text-[#172126] hover:bg-[#dff4fb]'}`}>{active ? <><Check className="h-4 w-4" />このユーザーで体験中</> : <>このユーザーとして入る<ArrowRight className="h-4 w-4" /></>}</button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-[#3c5360] bg-[linear-gradient(135deg,#233842,#1d2b31)] p-5" aria-labelledby="cycle-title">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--shop-success)]">Shared transaction</p><h3 id="cycle-title" className="mt-1 text-base font-black text-white">ユーザー間の循環を試す</h3></div><PackageCheck className="h-6 w-6 text-[#77d7f5]" /></div>
            <p className="mt-2 text-xs text-[#9fb3bb]">「{item?.title ?? 'ミントグリーンのニット'}」の取引が最初から進行中です。</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <CycleStep number="1" actor="Natsuki" action="購入" done={Boolean(activeTransaction)} />
              <CycleStep number="2" actor="サクラ" action="発送" done={Boolean(activeTransaction && activeTransaction.fulfillmentStatus !== 'AWAITING_SHIPMENT')} />
              <CycleStep number="3" actor="Natsuki" action="受取評価" done={Boolean(activeTransaction && activeTransaction.buyerRatingStatus === 'COMPLETED')} />
              <CycleStep number="4" actor="サクラ" action="評価・売上" done={Boolean(activeTransaction?.transactionStatus === 'COMPLETED')} />
            </div>
            <button type="button" onClick={() => { navigateToTab('mypage'); setIsSandboxPanelOpen(false); }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#76d2ef] py-3 text-xs font-black text-[#10272f] hover:bg-[#a4e5f8]">{activePersona.name}のやることを見る<ArrowRight className="h-4 w-4" /></button>
          </section>

          <section aria-labelledby="activity-title">
            <div className="mb-3 flex items-end justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#6f929f]">Event stream</p><h3 id="activity-title" className="mt-1 text-base font-black text-white">市場で起きたこと</h3></div><span className="text-[10px] text-[#78939e]">APIから同じ履歴を取得可能</span></div>
            <div className="space-y-2">
              {sandboxActivity.length ? sandboxActivity.slice(0, 8).map((entry) => <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-[#34464d] bg-[#202b30] p-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#183b48] text-[#74d5f3]"><Activity className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="text-xs font-bold text-white"><span className="text-[#82d9f4]">{entry.actorName}</span> が{entry.title}</p><p className="mt-0.5 truncate text-[10px] text-[#8197a0]">{entry.description}</p></div></div>) : <p className="rounded-xl border border-dashed border-[#40535b] p-5 text-center text-xs text-[#8197a0]">取引を始めると、ここに市場イベントが流れます。</p>}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-[#3a484e] bg-[#1b2428] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2c373c] text-[#9fb1b8]"><CircleDollarSign className="h-5 w-5" /></div><div><p className="text-xs font-bold text-white">初期シナリオへ戻す</p><p className="mt-0.5 text-[10px] text-[#7f959e]">出品・取引・評価など、この端末上の操作をリセットします。</p></div></div>
            <button type="button" onClick={resetScenario} className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#4b5c63] px-3 py-2 text-xs font-bold text-[#c1d0d5] hover:bg-white/5"><RotateCcw className="h-3.5 w-3.5" />リセット</button>
          </section>
        </div>
      </div>
    </div>
  );
};

const MiniStat: React.FC<{ value: string; label: string }> = ({ value, label }) => <div><p className="text-xs font-black text-white">{value}</p><p className="mt-0.5 text-[9px] text-[#718993]">{label}</p></div>;

const CycleStep: React.FC<{ number: string; actor: string; action: string; done: boolean }> = ({ number, actor, action, done }) => (
  <div className={`rounded-xl border p-3 ${done ? 'border-[#3c7860] bg-[#173b2d]' : 'border-[#43545b] bg-black/15'}`}>
    <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-black ${done ? 'bg-[var(--shop-success)] text-[#10271b]' : 'bg-[#405159] text-white'}`}>{done ? <Check className="h-3 w-3" /> : number}</div>
    <p className="mt-2 text-[10px] font-bold text-[#8fa6af]">{actor}</p>
    <p className="text-xs font-black text-white">{action}</p>
  </div>
);
