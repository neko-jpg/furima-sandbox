'use client';

import React from 'react';
import { ArrowRightLeft, ChevronRight, CreditCard, FileText, HelpCircle, Heart, History, PackageCheck, Settings, ShieldCheck, ShoppingBag, Users, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { Footer } from '../Footer';

export const MyPageView: React.FC = () => {
  const { user, activePersona, setIsSandboxPanelOpen, items, navigateToTab, setHomeTab, isDeviceFrame, marketplaceState, transactions, transactionPhase, completePayment, markAsShipped, updateShipmentStatus, rateTransaction, pauseListing, resumeListing, deleteListing, switchPersona } = useMercari();
  const likedCount = items.filter((item) => item.isLiked).length;
  const ownListings = marketplaceState.listings.filter((listing) => listing.sellerId === marketplaceState.currentUserId);
  const openTasks = marketplaceState.tasks.filter((task) => task.userId === marketplaceState.currentUserId && !task.completedAt);
  const [activeMenu, setActiveMenu] = React.useState<string | null>(null);
  const goToMyList = () => { navigateToTab('home'); setHomeTab('mylist'); };

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="mypage-view">
      <div className="mx-auto max-w-[1080px] px-4 pb-10 md:px-7">
        <div className="border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">マイページ</h1></div>
        <div className={`grid gap-5 py-5 ${isDeviceFrame ? '' : 'lg:grid-cols-[300px_1fr]'}`}>
          <aside className="space-y-4">
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><div className="flex items-center gap-3"><img src={user.avatar} alt={user.name} className="h-14 w-14 rounded-full object-cover" /><div className="min-w-0"><p className="truncate font-bold text-white">{user.name}<ChevronRight className="ml-1 inline h-4 w-4 text-[var(--shop-muted)]" /></p><p className="mt-1 text-xs text-[var(--shop-warning)]">★ {user.rating.toFixed(1)}（{user.ratingsCount}）</p><p className="mt-1 truncate text-[10px] font-bold" style={{ color: activePersona.accent }}>{activePersona.role}</p></div></div><div className="mt-4 flex items-center gap-2 text-xs font-bold text-[var(--shop-success)]"><ShieldCheck className="h-4 w-4" />本人確認済み</div><button type="button" onClick={() => setIsSandboxPanelOpen(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[#4c7280] bg-[#18343f] py-2.5 text-xs font-black text-[#a8e6f8]"><ArrowRightLeft className="h-3.5 w-3.5" />別のユーザーとして入る</button></div>
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><p className="text-xs text-[var(--shop-muted)]">売上金</p><p className="mt-1 text-2xl font-black text-white">¥{user.salesBalance.toLocaleString()}</p><div className="mt-4 border-t border-[var(--shop-border)] pt-4"><p className="text-xs text-[var(--shop-muted)]">ポイント</p><p className="mt-1 font-bold text-white">P {user.points}</p><p className="mt-2 text-xs font-bold text-[var(--shop-success)]">{user.hasDPointLinked ? 'ポイント連携済み' : 'ポイントを連携する'}</p></div></div>
          </aside>
          <div className="space-y-5">
            <ManagementGroup title="商品管理"><ManagementButton icon={<Heart className="text-[var(--shop-accent)]" />} label="いいねした商品" value={String(likedCount)} onClick={goToMyList} /><ManagementButton icon={<History className="text-[var(--shop-blue)]" />} label="閲覧履歴" onClick={goToMyList} /><ManagementButton icon={<Users className="text-[var(--shop-success)]" />} label="フォローリスト" onClick={() => setActiveMenu('フォローリスト')} /><ManagementButton icon={<PackageCheck className="text-[var(--shop-warning)]" />} label="出品した商品" onClick={() => setActiveMenu('出品した商品')} /><ManagementButton icon={<ShoppingBag className="text-purple-400" />} label="購入した商品" onClick={() => setActiveMenu('購入した商品')} /><ManagementButton icon={<FileText className="text-[var(--shop-muted)]" />} label="下書き一覧" onClick={() => setActiveMenu('下書き一覧')} /></ManagementGroup>
            <ManagementGroup title="設定・ヘルプ"><ManagementButton icon={<CreditCard className="text-[var(--shop-muted)]" />} label="支払い方法" onClick={() => setActiveMenu('支払い方法')} /><ManagementButton icon={<Settings className="text-[var(--shop-muted)]" />} label="アカウント設定" onClick={() => setActiveMenu('アカウント設定')} /><ManagementButton icon={<HelpCircle className="text-[var(--shop-muted)]" />} label="ヘルプ・ガイド" onClick={() => setActiveMenu('ヘルプ・ガイド')} /></ManagementGroup>
            {(openTasks.length > 0 || transactions.length > 0 || ownListings.length > 0) && <MarketplaceActivity transactions={transactions} ownListings={ownListings} items={items} tasks={openTasks} marketplaceState={marketplaceState} transactionPhase={transactionPhase} completePayment={completePayment} markAsShipped={markAsShipped} updateShipmentStatus={updateShipmentStatus} rateTransaction={rateTransaction} switchPersona={switchPersona} pauseListing={pauseListing} resumeListing={resumeListing} deleteListing={deleteListing} />}
      </div>
      {activeMenu && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${activeMenu}の詳細`}><div className="w-full max-w-md rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-black text-white">{activeMenu}</h2><button type="button" onClick={() => setActiveMenu(null)} aria-label="詳細を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div><p className="mt-5 rounded-lg bg-[var(--shop-surface-raised)] p-4 text-sm leading-6 text-[var(--shop-muted)]">Furima Sandbox内の架空データです。実在するアカウントや決済情報には一切影響せず、同じ市場を複数ユーザーの視点から体験できます。</p><button type="button" onClick={() => setActiveMenu(null)} className="mt-5 w-full rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-black text-white">閉じる</button></div></div>}
    </div>
      </div>
      <Footer />
    </div>
  );
};

const ManagementGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <section><h2 className="mb-2 text-sm font-bold text-white">{title}</h2><div className="divide-y divide-[var(--shop-border)] overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)]">{children}</div></section>;
const ManagementButton: React.FC<{ icon: React.ReactNode; label: string; value?: string; onClick?: () => void }> = ({ icon, label, value, onClick }) => <button type="button" onClick={onClick} className="flex w-full items-center justify-between px-4 py-4 text-left text-sm text-white transition-colors hover:bg-[var(--shop-surface-raised)]"><span className="flex items-center gap-3">{icon}{label}</span><span className="flex items-center gap-2 text-xs text-[var(--shop-muted)]">{value}<ChevronRight className="h-4 w-4" /></span></button>;

const MarketplaceActivity: React.FC<{
  transactions: ReturnType<typeof useMercari>['transactions'];
  ownListings: ReturnType<typeof useMercari>['marketplaceState']['listings'];
  items: ReturnType<typeof useMercari>['items'];
  tasks: ReturnType<typeof useMercari>['marketplaceState']['tasks'];
  marketplaceState: ReturnType<typeof useMercari>['marketplaceState'];
  transactionPhase: ReturnType<typeof useMercari>['transactionPhase'];
  completePayment: ReturnType<typeof useMercari>['completePayment'];
  markAsShipped: ReturnType<typeof useMercari>['markAsShipped'];
  updateShipmentStatus: ReturnType<typeof useMercari>['updateShipmentStatus'];
  rateTransaction: ReturnType<typeof useMercari>['rateTransaction'];
  switchPersona: ReturnType<typeof useMercari>['switchPersona'];
  pauseListing: ReturnType<typeof useMercari>['pauseListing'];
  resumeListing: ReturnType<typeof useMercari>['resumeListing'];
  deleteListing: ReturnType<typeof useMercari>['deleteListing'];
}> = ({ transactions, ownListings, items, tasks, marketplaceState, transactionPhase, completePayment, markAsShipped, updateShipmentStatus, rateTransaction, switchPersona, pauseListing, resumeListing, deleteListing }) => (
  <div className="space-y-5">
    {tasks.length > 0 && (
      <section>
        <h2 className="mb-2 text-sm font-bold text-white">やることリスト</h2>
        <div className="rounded-xl border border-[var(--shop-blue)]/40 bg-[#122b3a] p-4 text-sm text-white">
          {tasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 border-b border-white/10 py-2 last:border-0"><span>{task.type === 'PAYMENT_REQUIRED' ? '支払いを完了してください' : task.type === 'SHIPMENT_REQUIRED' ? '購入された商品を発送してください' : task.type === 'BUYER_RATING_REQUIRED' ? '商品を確認して受取評価してください' : '取引相手を評価してください'}</span><span className="shrink-0 text-xs font-bold text-[var(--shop-blue)]">対応待ち</span></div>)}
        </div>
      </section>
    )}
    {transactions.length > 0 && (
      <section>
        <div className="mb-2 flex items-end justify-between gap-3"><h2 className="text-sm font-bold text-white">取引管理</h2><p className="text-[10px] text-[var(--shop-muted)]">ユーザーを切り替えて同じ取引を続けられます</p></div>
        <div className="space-y-3">{transactions.map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} items={items} marketplaceState={marketplaceState} phase={transactionPhase(transaction.id)} completePayment={completePayment} markAsShipped={markAsShipped} updateShipmentStatus={updateShipmentStatus} rateTransaction={rateTransaction} switchPersona={switchPersona} />)}</div>
      </section>
    )}
    {ownListings.length > 0 && (
      <section>
        <h2 className="mb-2 text-sm font-bold text-white">出品した商品</h2>
        <div className="grid gap-2 sm:grid-cols-2">{ownListings.map((listing) => <div key={listing.id} className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3"><p className="truncate text-sm font-bold text-white">{items.find((item) => item.listingId === listing.id)?.title ?? listing.categoryId}</p><div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--shop-muted)]"><span className="shrink-0">{listing.status === 'PUBLISHED' ? '出品中' : listing.status === 'PAUSED' ? '公開停止中' : listing.status === 'TRANSACTION_STARTED' ? '取引中' : listing.status === 'SOLD' ? '売却済み' : '下書き'}</span><span className="truncate">閲覧 {listing.viewsCount}・検索 {listing.searchCount}・いいね {listing.likesCount}</span></div><p className="mt-2 text-sm font-black text-white">¥{listing.price.toLocaleString()}</p><div className="mt-3 flex gap-2">{listing.status === 'PUBLISHED' && <button type="button" onClick={() => pauseListing(listing.id)} className="rounded-lg border border-[var(--shop-border)] px-2.5 py-1.5 text-xs font-bold text-white">公開停止</button>}{listing.status === 'PAUSED' && <button type="button" onClick={() => resumeListing(listing.id)} className="rounded-lg bg-[var(--shop-blue)] px-2.5 py-1.5 text-xs font-bold text-white">再公開</button>}{['DRAFT', 'PUBLISHED', 'PAUSED'].includes(listing.status) && <button type="button" onClick={() => deleteListing(listing.id)} className="rounded-lg border border-red-400/40 px-2.5 py-1.5 text-xs font-bold text-red-200">削除</button>}</div></div>)}</div>
      </section>
    )}
  </div>
);

const TransactionCard: React.FC<{
  transaction: ReturnType<typeof useMercari>['transactions'][number];
  items: ReturnType<typeof useMercari>['items'];
  marketplaceState: ReturnType<typeof useMercari>['marketplaceState'];
  phase: string | null;
  completePayment: ReturnType<typeof useMercari>['completePayment'];
  markAsShipped: ReturnType<typeof useMercari>['markAsShipped'];
  updateShipmentStatus: ReturnType<typeof useMercari>['updateShipmentStatus'];
  rateTransaction: ReturnType<typeof useMercari>['rateTransaction'];
  switchPersona: ReturnType<typeof useMercari>['switchPersona'];
}> = ({ transaction, items, marketplaceState, phase, completePayment, markAsShipped, updateShipmentStatus, rateTransaction, switchPersona }) => {
  const currentUserId = marketplaceState.currentUserId;
  const isBuyer = transaction.buyerId === currentUserId;
  const isSeller = transaction.sellerId === currentUserId;
  const counterpartId = isBuyer ? transaction.sellerId : transaction.buyerId;
  const counterpart = marketplaceState.users.find((user) => user.id === counterpartId);
  const item = items.find((value) => value.listingId === transaction.listingId || value.id === transaction.listingId.replace(/^listing-/, ''));
  const proceeds = marketplaceState.proceeds.find((record) => record.transactionId === transaction.id);
  const waitingForSellerToShip = transaction.paymentStatus === 'PAID' && transaction.fulfillmentStatus === 'AWAITING_SHIPMENT';
  const waitingForBuyerRating = transaction.fulfillmentStatus === 'DELIVERED' && transaction.buyerRatingStatus === 'PENDING';
  const waitingForSellerRating = transaction.buyerRatingStatus === 'COMPLETED' && transaction.sellerRatingStatus === 'PENDING';

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)]">
      <div className="p-4">
        <div className="flex items-start gap-3">
          {item?.images[0] && <img src={item.images[0]} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${isBuyer ? 'bg-[#173d4d] text-[#83dcfa]' : 'bg-[#3a2d17] text-[#ffcf64]'}`}>{isBuyer ? '購入した取引' : '販売した取引'}</span><span className="text-[10px] text-[var(--shop-muted)]">相手：{counterpart?.displayName ?? 'ユーザー'}</span></div><p className="mt-1 truncate text-sm font-bold text-white">{item?.title ?? '取引商品'}</p><p className="mt-1 text-xs font-bold text-[var(--shop-blue)]">{phase}</p></div>
          <p className="shrink-0 text-sm font-black text-white">¥{transaction.total.toLocaleString()}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {transaction.paymentStatus === 'PENDING' && isBuyer && <ActionButton tone="accent" onClick={() => completePayment(transaction.id)}>支払う</ActionButton>}
          {waitingForSellerToShip && isSeller && <ActionButton tone="blue" onClick={() => markAsShipped(transaction.id)}>発送通知を送る</ActionButton>}
          {transaction.fulfillmentStatus === 'SHIPPED' && isBuyer && <ActionButton tone="outline" onClick={() => updateShipmentStatus(transaction.id, 'DELIVERED')}>配送を完了させる（サンドボックス）</ActionButton>}
          {waitingForBuyerRating && isBuyer && <ActionButton tone="success" onClick={() => rateTransaction(transaction.id, 5, 'ありがとうございました')}>受取評価する</ActionButton>}
          {waitingForSellerRating && isSeller && <ActionButton tone="success" onClick={() => rateTransaction(transaction.id, 5, 'スムーズな取引でした')}>購入者を評価して取引完了</ActionButton>}

          {((waitingForSellerToShip && isBuyer) || (waitingForBuyerRating && isSeller) || (waitingForSellerRating && isBuyer)) && <button type="button" onClick={() => switchPersona(counterpartId)} className="flex items-center gap-2 rounded-lg border border-[#4c7280] bg-[#17333e] px-3 py-2 text-xs font-black text-[#a9e5f7]"><ArrowRightLeft className="h-3.5 w-3.5" />{counterpart?.displayName ?? '相手'}に切り替えて続ける</button>}
        </div>

        {transaction.fulfillmentStatus === 'SHIPPED' && isSeller && <p className="mt-3 rounded-lg bg-black/15 px-3 py-2 text-[10px] leading-5 text-[var(--shop-muted)]">発送通知を送りました。購入者側へ切り替えると、配送完了と受取評価を体験できます。</p>}
        {transaction.transactionStatus === 'COMPLETED' && <div className="mt-3 rounded-lg border border-[var(--shop-success)]/30 bg-[#173428] px-3 py-2 text-xs text-[#b9f3d1]">取引が完了しました。{isSeller && proceeds ? ` 手数料を差し引いた売上 ¥${proceeds.net.toLocaleString()} が反映されています。` : ''}</div>}
      </div>
    </article>
  );
};

const ActionButton: React.FC<{ tone: 'accent' | 'blue' | 'success' | 'outline'; onClick: () => void; children: React.ReactNode }> = ({ tone, onClick, children }) => {
  const tones = { accent: 'bg-[var(--shop-accent)] text-white', blue: 'bg-[var(--shop-blue)] text-[#102530]', success: 'bg-[var(--shop-success)] text-[#10271b]', outline: 'border border-[var(--shop-border)] text-white' };
  return <button type="button" onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-black ${tones[tone]}`}>{children}</button>;
};
