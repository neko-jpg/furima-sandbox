'use client';

/* eslint-disable @next/next/no-img-element */

import React from 'react';
import { ChevronRight, CreditCard, FileText, HelpCircle, Heart, History, PackageCheck, Settings, ShieldCheck, ShoppingBag, Users, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { Footer } from '../Footer';

export const MyPageView: React.FC = () => {
  const { user, items, navigateToTab, setHomeTab, isDeviceFrame, activeActor, sandboxSnapshot, getTransactions, shipOrder, markDelivered, reviewOrder, cancelOrder } = useMercari();
  const likedCount = items.filter((item) => item.isLiked).length;
  const transactions = getTransactions(activeActor.id);
  const wallet = sandboxSnapshot.wallets.find((candidate) => candidate.actorId === activeActor.id);
  const [activeMenu, setActiveMenu] = React.useState<string | null>(null);
  const goToMyList = () => { navigateToTab('home'); setHomeTab('mylist'); };

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="mypage-view">
      <div className="mx-auto max-w-[1080px] px-4 pb-10 md:px-7">
        <div className="border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">マイページ</h1></div>
        <div className={`grid gap-5 py-5 ${isDeviceFrame ? '' : 'lg:grid-cols-[300px_1fr]'}`}>
          <aside className="space-y-4">
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><div className="flex items-center gap-3"><img src={user.avatar} alt={user.name} className="h-14 w-14 rounded-full object-cover" /><div><p className="font-bold text-white">{user.name}<ChevronRight className="ml-1 inline h-4 w-4 text-[var(--shop-muted)]" /></p><p className="mt-1 text-xs text-[var(--shop-warning)]">★ {user.rating.toFixed(1)}（{user.ratingsCount}）</p></div></div><div className="mt-4 flex items-center gap-2 text-xs font-bold text-[var(--shop-success)]"><ShieldCheck className="h-4 w-4" />本人確認済み</div></div>
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><p className="text-xs text-[var(--shop-muted)]">{activeActor.role === 'seller' ? '売上金' : 'Sandboxウォレット残高'}</p><p className="mt-1 text-2xl font-black text-white">¥{(wallet?.availableBalance ?? user.salesBalance).toLocaleString()}</p>{(wallet?.heldBalance ?? 0) > 0 && <p className="mt-1 text-[11px] text-[var(--shop-warning)]">取引保留中 ¥{wallet?.heldBalance.toLocaleString()}</p>}<div className="mt-4 border-t border-[var(--shop-border)] pt-4"><p className="text-xs text-[var(--shop-muted)]">ポイント</p><p className="mt-1 font-bold text-white">P {wallet?.points ?? user.points}</p><p className="mt-2 text-xs font-bold text-[var(--shop-success)]">{user.hasDPointLinked ? 'ポイント連携済み' : 'ポイントを連携する'}</p></div></div>
          </aside>
          <div className="space-y-5">
            <TransactionCenter transactions={transactions} actorId={activeActor.id} onShip={shipOrder} onDeliver={markDelivered} onReview={reviewOrder} onCancel={cancelOrder} />
            <ManagementGroup title="商品管理"><ManagementButton icon={<Heart className="text-[var(--shop-accent)]" />} label="いいねした商品" value={String(likedCount)} onClick={goToMyList} /><ManagementButton icon={<History className="text-[var(--shop-blue)]" />} label="閲覧履歴" onClick={goToMyList} /><ManagementButton icon={<Users className="text-[var(--shop-success)]" />} label="フォローリスト" onClick={() => setActiveMenu('フォローリスト')} /><ManagementButton icon={<PackageCheck className="text-[var(--shop-warning)]" />} label="出品した商品" onClick={() => setActiveMenu('出品した商品')} /><ManagementButton icon={<ShoppingBag className="text-purple-400" />} label="購入した商品" onClick={() => setActiveMenu('購入した商品')} /><ManagementButton icon={<FileText className="text-[var(--shop-muted)]" />} label="下書き一覧" onClick={() => setActiveMenu('下書き一覧')} /></ManagementGroup>
            <ManagementGroup title="設定・ヘルプ"><ManagementButton icon={<CreditCard className="text-[var(--shop-muted)]" />} label="支払い方法" onClick={() => setActiveMenu('支払い方法')} /><ManagementButton icon={<Settings className="text-[var(--shop-muted)]" />} label="アカウント設定" onClick={() => setActiveMenu('アカウント設定')} /><ManagementButton icon={<HelpCircle className="text-[var(--shop-muted)]" />} label="ヘルプ・ガイド" onClick={() => setActiveMenu('ヘルプ・ガイド')} /></ManagementGroup>
      </div>
      {activeMenu && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${activeMenu}の詳細`}><div className="w-full max-w-md rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-black text-white">{activeMenu}</h2><button type="button" onClick={() => setActiveMenu(null)} aria-label="詳細を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div><p className="mt-5 rounded-lg bg-[var(--shop-surface-raised)] p-4 text-sm leading-6 text-[var(--shop-muted)]">この画面はMercari AI Agent Hackathon for PM用のモックです。実際のアカウントや決済情報は変更せず、画面遷移と操作感だけを体験できます。</p><button type="button" onClick={() => setActiveMenu(null)} className="mt-5 w-full rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-black text-white">閉じる</button></div></div>}
    </div>
      </div>
      <Footer />
    </div>
  );
};

const transactionStatusLabels: Record<string, string> = {
  PAYMENT_PENDING: '支払い待ち',
  AWAITING_SHIPMENT: '発送待ち',
  SHIPPED: '発送済み',
  DELIVERED: '配達済み・受取評価待ち',
  BUYER_REVIEWED: '購入者評価済み・出品者評価待ち',
  SELLER_REVIEWED: '出品者評価済み',
  COMPLETED: '取引完了・売上反映',
  CANCELED: 'キャンセル',
  CANCEL_REQUESTED: 'キャンセル申請中',
  REFUNDED: '返金済み',
};

const TransactionCenter: React.FC<{
  transactions: ReturnType<ReturnType<typeof useMercari>['getTransactions']>;
  actorId: string;
  onShip: ReturnType<typeof useMercari>['shipOrder'];
  onDeliver: ReturnType<typeof useMercari>['markDelivered'];
  onReview: ReturnType<typeof useMercari>['reviewOrder'];
  onCancel: ReturnType<typeof useMercari>['cancelOrder'];
}> = ({ transactions, actorId, onShip, onDeliver, onReview, onCancel }) => {
  const [feedback, setFeedback] = React.useState<string | null>(null);
  if (transactions.length === 0) return null;
  const act = (result: { ok: boolean; message?: string }) => setFeedback(result.ok ? '取引状態を更新しました' : result.message ?? '取引操作に失敗しました');
  return <section className="rounded-xl border border-[#2b5367] bg-[#122b3a]/70 p-4" aria-labelledby="transaction-center-title"><div className="flex items-center justify-between gap-3"><div><h2 id="transaction-center-title" className="text-sm font-black text-white">取引センター</h2><p className="mt-1 text-[11px] text-[var(--shop-muted)]">Actor: {actorId} ・ 購入→発送→受取→相互評価</p></div><span className="rounded-full bg-[#16394d] px-2 py-1 text-[10px] font-bold text-[var(--shop-blue)]">{transactions.length}件</span></div><div className="mt-3 space-y-2">{transactions.map((transaction) => <div key={transaction.id} className="rounded-lg border border-white/10 bg-black/15 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-bold text-white">{transaction.titleSnapshot}</p><p className="mt-1 text-[11px] text-[var(--shop-muted)]">{transaction.orderId} ・ ¥{transaction.total.toLocaleString()}</p></div><span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-[#c5eaff]">{transactionStatusLabels[transaction.status] ?? transaction.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{transaction.status === 'AWAITING_SHIPMENT' && transaction.sellerId === actorId && <button type="button" onClick={() => act(onShip(transaction.id))} className="rounded-md bg-[var(--shop-blue)] px-3 py-1.5 text-[11px] font-bold text-[#0d202b]">発送する</button>}{transaction.status === 'SHIPPED' && transaction.buyerId === actorId && <button type="button" onClick={() => act(onDeliver(transaction.id))} className="rounded-md bg-[var(--shop-blue)] px-3 py-1.5 text-[11px] font-bold text-[#0d202b]">配達完了</button>}{transaction.status === 'DELIVERED' && transaction.buyerId === actorId && <button type="button" onClick={() => act(onReview(transaction.id, 5, '良い取引でした'))} className="rounded-md bg-[var(--shop-accent)] px-3 py-1.5 text-[11px] font-bold text-white">受取評価する</button>}{transaction.status === 'BUYER_REVIEWED' && transaction.sellerId === actorId && <button type="button" onClick={() => act(onReview(transaction.id, 5, 'ありがとうございました'))} className="rounded-md bg-[var(--shop-accent)] px-3 py-1.5 text-[11px] font-bold text-white">出品者評価する</button>}{['PAYMENT_PENDING', 'AWAITING_SHIPMENT'].includes(transaction.status) && <button type="button" onClick={() => act(onCancel(transaction.id, 'Sandbox UIからのキャンセル'))} className="rounded-md border border-white/15 px-3 py-1.5 text-[11px] font-bold text-[var(--shop-muted)]">キャンセル</button>}</div></div>)}</div>{feedback && <p className="mt-3 text-[11px] text-[#9dd8f5]" role="status">{feedback}</p>}</section>;
};

const ManagementGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <section><h2 className="mb-2 text-sm font-bold text-white">{title}</h2><div className="divide-y divide-[var(--shop-border)] overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)]">{children}</div></section>;
const ManagementButton: React.FC<{ icon: React.ReactNode; label: string; value?: string; onClick?: () => void }> = ({ icon, label, value, onClick }) => <button type="button" onClick={onClick} className="flex w-full items-center justify-between px-4 py-4 text-left text-sm text-white transition-colors hover:bg-[var(--shop-surface-raised)]"><span className="flex items-center gap-3">{icon}{label}</span><span className="flex items-center gap-2 text-xs text-[var(--shop-muted)]">{value}<ChevronRight className="h-4 w-4" /></span></button>;
