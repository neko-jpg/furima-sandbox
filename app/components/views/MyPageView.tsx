'use client';

/* eslint-disable @next/next/no-img-element */

import React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, CreditCard, Eye, FileText, HelpCircle, Heart, History, ImagePlus, PackageCheck, PauseCircle, Pencil, PlayCircle, RotateCcw, Save, Settings, ShieldCheck, ShoppingBag, Trash2, Users, WalletCards, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import type { ActorProfile, FollowDirection, MercariItem, MyPagePanel, TransactionRecord } from '../../types/mercari';
import { deleteListingMediaMany, getListingMedia, prepareListingMedia } from '../../media/listingMediaStore';
import { Footer } from '../Footer';
import { AvatarImage } from '../ui/AvatarImage';

const DRAFT_STORAGE_KEY = 'furima-listing-drafts-v3';
const OPEN_DRAFT_STORAGE_KEY = 'furima-listing-open-draft-id';

interface LocalDraftRecord {
  draftId?: string;
  name?: string;
  form?: { title?: string; price?: string };
  media?: unknown[];
  updatedAt?: string;
}

type ListingFilter = 'all' | 'active' | 'sold';

const readLocalDrafts = (): LocalDraftRecord[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((draft): draft is LocalDraftRecord => Boolean(draft && typeof draft === 'object'))
      : [];
  } catch {
    return [];
  }
};

const formatDate = (value?: string): string => {
  if (!value) return '日時不明';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '日時不明' : date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const listingStatusLabels: Record<string, string> = {
  ACTIVE: '出品中', HELD: '審査中', RESERVED: '取引中', SOLD: '売却済み', ARCHIVED: '停止中', DRAFT: '下書き',
};

export const MyPageView: React.FC = () => {
  const {
    user, profile, wallet, items, navigateToTab, setHomeTab, isDeviceFrame, activeActor, getTransactions, getListingDrafts,
    shipOrder, markDelivered, reviewOrder, cancelOrder, openItem, pauseListing, resumeListing, relistItem,
    getWallet, depositWallet, withdrawWallet, updateProfile, myPagePanel, setMyPagePanel,
    getFollowList, followUser, unfollowUser,
  } = useMercari();
  const activePanel: MyPagePanel | null = myPagePanel;
  const setActivePanel = setMyPagePanel;
  const [localDrafts, setLocalDrafts] = React.useState<LocalDraftRecord[]>(readLocalDrafts);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [walletMode, setWalletMode] = React.useState<'deposit' | 'withdraw'>('deposit');
  const [walletAmount, setWalletAmount] = React.useState('');
  const [listingFilter, setListingFilter] = React.useState<ListingFilter>('all');
  const [followTab, setFollowTab] = React.useState<FollowDirection>('following');
  const [profileDraft, setProfileDraft] = React.useState(() => ({ displayName: profile?.displayName ?? user.name, bio: profile?.bio ?? '', avatarRef: profile?.avatarRef ?? '' }));
  const [profilePreview, setProfilePreview] = React.useState(() => profile?.avatar ?? user.avatar ?? '/favicon.svg');
  const profileInputRef = React.useRef<HTMLInputElement>(null);

  const refreshDrafts = React.useCallback(() => setLocalDrafts(readLocalDrafts()), []);
  React.useEffect(() => {
    window.addEventListener('furima-listing-drafts-changed', refreshDrafts);
    return () => window.removeEventListener('furima-listing-drafts-changed', refreshDrafts);
  }, [refreshDrafts]);

  const likedCount = items.filter((item) => item.isLiked).length;
  const transactions = getTransactions(activeActor.id);
  const sales = transactions.filter((transaction) => transaction.sellerId === activeActor.id);
  const purchases = transactions.filter((transaction) => transaction.buyerId === activeActor.id);
  const ownListings = items
    .filter((item) => activeActor.role === 'admin' || activeActor.role === 'platform' || item.sellerId === activeActor.id)
    .sort((left, right) => (right.updatedAt ?? right.createdAt ?? '').localeCompare(left.updatedAt ?? left.createdAt ?? ''));
  const activeListings = ownListings.filter((item) => ['ACTIVE', 'HELD', 'RESERVED'].includes(item.listingStatus ?? ''));
  const soldListings = ownListings.filter((item) => item.listingStatus === 'SOLD');
  const visibleListings = listingFilter === 'sold' ? soldListings : listingFilter === 'active' ? activeListings : ownListings;
  const domainDrafts = getListingDrafts();
  const draftIds = new Set(domainDrafts.map((draft) => draft.draftId));
  const localOnlyDrafts = localDrafts.filter((draft) => !draft.draftId || !draftIds.has(draft.draftId));
  const draftCount = domainDrafts.length + localOnlyDrafts.length;
  const followingResult = getFollowList('following');
  const followersResult = getFollowList('followers');
  const followingUsers = followingResult.ok ? followingResult.data.users : [];
  const followerUsers = followersResult.ok ? followersResult.data.users : [];

  React.useEffect(() => {
    let cancelled = false;
    if (profile?.avatarRef) void getListingMedia(profile.avatarRef).then((preview) => { if (!cancelled && preview) setProfilePreview(preview); });
    return () => { cancelled = true; };
  }, [profile?.avatarRef]);

  const goToMyList = () => { navigateToTab('home'); setHomeTab('mylist'); };
  const showFeedback = (message: string) => { setFeedback(message); window.setTimeout(() => setFeedback(null), 2600); };
  const handleListingAction = (item: MercariItem, action: 'pause' | 'resume' | 'relist') => {
    const result = action === 'pause' ? pauseListing(item.id) : action === 'resume' ? resumeListing(item.id) : relistItem(item.id);
    showFeedback(result.ok ? (action === 'pause' ? '出品を停止しました' : action === 'resume' ? '出品を再開しました' : '再出品しました') : (result.message ?? '操作できませんでした'));
  };
  const openDraft = (draftId?: string) => {
    if (!draftId || typeof window === 'undefined') return;
    window.localStorage.setItem(OPEN_DRAFT_STORAGE_KEY, draftId);
    navigateToTab('sell');
  };
  const openWallet = (mode: 'deposit' | 'withdraw' = 'deposit') => { setWalletMode(mode); setWalletAmount(''); setActivePanel('wallet'); };
  const openListings = (filter: ListingFilter = 'all') => { setListingFilter(filter); setActivePanel('listings'); };
  const openFollowers = (direction: FollowDirection = 'following') => { setFollowTab(direction); setActivePanel('followers'); };
  const openProfileEditor = () => { setProfileDraft({ displayName: profile?.displayName ?? user.name, bio: profile?.bio ?? '', avatarRef: profile?.avatarRef ?? '' }); setProfilePreview(profile?.avatar ?? user.avatar ?? '/favicon.svg'); setActivePanel('profile'); };
  const runWalletOperation = () => {
    const amount = Number(walletAmount);
    const result = walletMode === 'deposit' ? depositWallet(amount) : withdrawWallet(amount);
    showFeedback(result.ok ? `${walletMode === 'deposit' ? '入金' : '出金'}しました` : (result.message ?? 'ウォレット操作に失敗しました'));
    if (result.ok) setWalletAmount('');
  };
  const handleProfileImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const prepared = await prepareListingMedia(file, 'album');
      setProfileDraft((current) => ({ ...current, avatarRef: prepared.ref.id }));
      setProfilePreview(prepared.previewUrl);
      showFeedback('プロフィール画像を選択しました。保存すると反映されます。');
    } catch {
      showFeedback('プロフィール画像を読み込めませんでした。JPEG・PNG・WebPなどを選択してください。');
    }
  };
  const saveProfile = () => {
    const previousAvatarRef = profile?.avatarRef;
    const result = updateProfile({ displayName: profileDraft.displayName, bio: profileDraft.bio, avatarRef: profileDraft.avatarRef });
    showFeedback(result.ok ? 'プロフィールを保存しました' : (result.message ?? 'プロフィールを保存できませんでした'));
    if (result.ok) {
      if (previousAvatarRef && previousAvatarRef !== profileDraft.avatarRef) void deleteListingMediaMany([previousAvatarRef]);
      setActivePanel(null);
    }
  };
  const removeProfileImage = () => { setProfileDraft((current) => ({ ...current, avatarRef: '' })); setProfilePreview('/favicon.svg'); };
  const handleFollowToggle = (targetActorId: string, currentlyFollowing: boolean) => {
    const result = currentlyFollowing ? unfollowUser(targetActorId) : followUser(targetActorId);
    showFeedback(result.ok ? (currentlyFollowing ? 'フォローを解除しました' : 'フォローしました') : (result.message ?? 'フォロー操作に失敗しました'));
  };

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="mypage-view">
      <div className="mx-auto max-w-[1080px] px-4 pb-24 md:px-7">
        <div className="border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">マイページ</h1><p className="mt-1 text-xs text-[var(--shop-muted)]">出品・購入・取引・下書きをまとめて確認できます。</p></div>
        <div className={`grid gap-5 py-5 ${isDeviceFrame ? '' : 'lg:grid-cols-[300px_1fr]'}`}>
          <aside className="space-y-4">
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><div className="flex items-center gap-3"><img src={profilePreview} alt={user.name} className="h-14 w-14 rounded-full object-cover" /><div className="min-w-0 flex-1"><p className="truncate font-bold text-white">{user.name}<ChevronRight className="ml-1 inline h-4 w-4 text-[var(--shop-muted)]" /></p><p className="mt-1 text-xs text-[var(--shop-warning)]">★ {user.rating.toFixed(1)}（{user.ratingsCount}）</p></div><button type="button" onClick={openProfileEditor} className="rounded-lg border border-[var(--shop-border)] p-2 text-[var(--shop-blue)] hover:bg-[var(--shop-surface-raised)]" aria-label="プロフィールを編集"><Pencil className="h-4 w-4" /></button></div><div className="mt-4 flex items-center gap-2 text-xs font-bold text-[var(--shop-success)]"><ShieldCheck className="h-4 w-4" />本人確認済み</div><p className="mt-3 rounded-lg bg-[var(--shop-surface-raised)] px-3 py-2 text-[11px] text-[var(--shop-muted)]">現在のSandbox actor：{activeActor.name}</p></div>
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[var(--shop-muted)]">{activeActor.role === 'seller' ? '売上金・ウォレット' : 'Sandboxウォレット'}</p><p className="mt-1 text-2xl font-black text-white">¥{(wallet?.availableBalance ?? user.salesBalance).toLocaleString()}</p></div><WalletCards className="h-6 w-6 text-[var(--shop-blue)]" /></div><div className="mt-2 grid grid-cols-2 gap-2 text-[11px]"><div className="rounded-lg bg-[var(--shop-surface-raised)] p-2"><span className="block text-[var(--shop-muted)]">利用可能</span><strong className="text-white">¥{(wallet?.availableBalance ?? 0).toLocaleString()}</strong></div><div className="rounded-lg bg-[var(--shop-surface-raised)] p-2"><span className="block text-[var(--shop-muted)]">取引保留</span><strong className="text-[var(--shop-warning)]">¥{(wallet?.heldBalance ?? 0).toLocaleString()}</strong></div></div><p className="mt-2 text-[11px] text-[var(--shop-muted)]">合計残高 ¥{((wallet?.availableBalance ?? 0) + (wallet?.heldBalance ?? 0)).toLocaleString()}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => openWallet('deposit')} className="flex-1 rounded-lg bg-[var(--shop-blue)] px-2 py-2 text-xs font-black text-[#06202e]"><ArrowDownToLine className="mr-1 inline h-3.5 w-3.5" />入金</button><button type="button" onClick={() => openWallet('withdraw')} className="flex-1 rounded-lg border border-[var(--shop-border)] px-2 py-2 text-xs font-bold text-white"><ArrowUpFromLine className="mr-1 inline h-3.5 w-3.5" />出金</button></div><div className="mt-4 border-t border-[var(--shop-border)] pt-4"><p className="text-xs text-[var(--shop-muted)]">ポイント</p><p className="mt-1 font-bold text-white">P {wallet?.points ?? user.points}</p><p className="mt-2 text-xs font-bold text-[var(--shop-success)]">{user.hasDPointLinked ? 'ポイント連携済み' : 'ポイントを連携する'}</p></div></div>
          </aside>
          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="アカウント状況"><SummaryCard label="出品中" value={activeListings.length} onClick={() => openListings('active')} /><SummaryCard label="売却済み" value={soldListings.length} onClick={() => openListings('sold')} /><SummaryCard label="取引" value={transactions.length} onClick={() => setActivePanel('purchases')} /><SummaryCard label="下書き" value={draftCount} onClick={() => setActivePanel('drafts')} /></section>
            {activeActor.role !== 'seller' && ownListings.length === 0 && <p className="rounded-xl border border-[#2b5367] bg-[#122b3a]/70 p-3 text-xs leading-5 text-[#c5eaff]">出品した商品を確認するには、Sandbox Inspectorでseller actorへ切り替えてください。購入・取引データはactorごとに分離されています。</p>}
            <TransactionCenter transactions={transactions} actorId={activeActor.id} onShip={shipOrder} onDeliver={markDelivered} onReview={reviewOrder} onCancel={cancelOrder} />
             <ManagementGroup title="商品管理"><ManagementButton icon={<Heart className="text-[var(--shop-accent)]" />} label="いいねした商品" value={String(likedCount)} onClick={goToMyList} /><ManagementButton icon={<History className="text-[var(--shop-blue)]" />} label="閲覧履歴" onClick={goToMyList} /><ManagementButton icon={<Users className="text-[var(--shop-success)]" />} label="フォローリスト" value={`${followingUsers.length}人`} onClick={() => openFollowers('following')} /><ManagementButton icon={<PackageCheck className="text-[var(--shop-warning)]" />} label="出品した商品" value={`${ownListings.length}件`} onClick={() => openListings('all')} /><ManagementButton icon={<ShoppingBag className="text-purple-400" />} label="購入した商品" value={`${purchases.length}件`} onClick={() => setActivePanel('purchases')} /><ManagementButton icon={<FileText className="text-[var(--shop-muted)]" />} label="下書き一覧" value={`${draftCount}件`} onClick={() => setActivePanel('drafts')} /></ManagementGroup>
             <ManagementGroup title="設定・ヘルプ"><ManagementButton icon={<WalletCards className="text-[var(--shop-blue)]" />} label="ウォレット明細・入出金" value={`¥${(wallet?.availableBalance ?? 0).toLocaleString()}`} onClick={() => openWallet('deposit')} /><ManagementButton icon={<Pencil className="text-[var(--shop-success)]" />} label="プロフィール編集" onClick={openProfileEditor} /><ManagementButton icon={<CreditCard className="text-[var(--shop-muted)]" />} label="支払い方法" value="Sandbox対象外" disabled /><ManagementButton icon={<Settings className="text-[var(--shop-muted)]" />} label="アカウント設定" value="Sandbox対象外" disabled /><ManagementButton icon={<HelpCircle className="text-[var(--shop-muted)]" />} label="ヘルプ・ガイド" onClick={() => setActivePanel('help')} /></ManagementGroup>
          </div>
        </div>
      </div>
      <Footer />
      {feedback && <div className="fixed bottom-[calc(58px+env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-[110] -translate-x-1/2 rounded-full border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] px-4 py-2 text-xs font-bold text-white shadow-xl" role="status">{feedback}</div>}
      {activePanel === 'listings' && <Panel title={listingFilter === 'sold' ? '売却済み商品' : listingFilter === 'active' ? '出品中の商品' : '出品した商品'} onClose={() => setActivePanel(null)}><p className="mb-3 text-xs text-[var(--shop-muted)]">{listingFilter === 'sold' ? '売却済みの商品だけを表示しています。' : listingFilter === 'active' ? '現在出品中・審査中・取引中の商品を表示しています。' : '出品中・審査中・停止中・売却済みを同じ一覧で確認できます。'}</p>{visibleListings.length ? <div className="space-y-2">{visibleListings.map((item) => <ListingRow key={item.id} item={item} onOpen={() => openItem(item.id)} onAction={handleListingAction} />)}</div> : <EmptyPanel message="この条件に該当する出品はありません。" />}</Panel>}
      {activePanel === 'purchases' && <Panel title="購入・取引履歴" onClose={() => setActivePanel(null)}><p className="mb-3 text-xs text-[var(--shop-muted)]">購入者としての取引と、出品者として売れた商品の取引を確認できます。</p><TransactionList transactions={purchases} emptyMessage="購入・取引中の商品はありません。" onOpen={(itemId) => openItem(itemId)} /><div className="mt-5 border-t border-[var(--shop-border)] pt-4"><h3 className="mb-2 text-sm font-bold text-white">売れた商品・売上反映</h3><TransactionList transactions={sales} emptyMessage="売れた商品はありません。" onOpen={(itemId) => openItem(itemId)} /></div></Panel>}
      {activePanel === 'drafts' && <Panel title="下書き一覧" onClose={() => setActivePanel(null)}><p className="mb-3 text-xs text-[var(--shop-muted)]">端末保存の下書きも表示します。選択すると出品画面で復元できます。</p>{localDrafts.length || domainDrafts.length ? <div className="space-y-2">{[...domainDrafts.map((draft) => ({ id: draft.draftId, name: draft.fields.title || '下書き', price: draft.fields.price, mediaCount: draft.fields.imageRefs?.length ?? draft.fields.images?.length ?? 0, updatedAt: draft.updatedAt })), ...localOnlyDrafts.map((draft) => ({ id: draft.draftId, name: draft.name || draft.form?.title || '下書き', price: draft.form?.price, mediaCount: Array.isArray(draft.media) ? draft.media.length : 0, updatedAt: draft.updatedAt }))].map((draft, index) => <button key={`${draft.id ?? 'local'}-${index}`} type="button" onClick={() => openDraft(draft.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3 text-left hover:bg-[var(--shop-surface-raised)]"><span className="min-w-0"><strong className="block truncate text-sm text-white">{draft.name}</strong><span className="mt-1 block text-[11px] text-[var(--shop-muted)]">{draft.mediaCount}枚 ・ {draft.price ? `¥${Number(draft.price).toLocaleString()}` : '価格未設定'} ・ {formatDate(draft.updatedAt)}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--shop-muted)]" /></button>)}</div> : <EmptyPanel message="保存された下書きはありません。" />}</Panel>}
      {activePanel === 'followers' && <Panel title="フォローリスト" onClose={() => setActivePanel(null)}><FollowListPanel activeTab={followTab} followingUsers={followingUsers} followerUsers={followerUsers} onTabChange={setFollowTab} onToggle={handleFollowToggle} /></Panel>}
      {activePanel === 'wallet' && <Panel title="ウォレット" onClose={() => setActivePanel(null)}><div className="space-y-4"><div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-[var(--shop-surface-raised)] p-3"><span className="block text-[10px] text-[var(--shop-muted)]">利用可能</span><strong className="mt-1 block text-sm text-white">¥{(wallet?.availableBalance ?? 0).toLocaleString()}</strong></div><div className="rounded-lg bg-[var(--shop-surface-raised)] p-3"><span className="block text-[10px] text-[var(--shop-muted)]">取引保留</span><strong className="mt-1 block text-sm text-[var(--shop-warning)]">¥{(wallet?.heldBalance ?? 0).toLocaleString()}</strong></div><div className="rounded-lg bg-[var(--shop-surface-raised)] p-3"><span className="block text-[10px] text-[var(--shop-muted)]">合計</span><strong className="mt-1 block text-sm text-white">¥{((wallet?.availableBalance ?? 0) + (wallet?.heldBalance ?? 0)).toLocaleString()}</strong></div></div><div className="rounded-xl border border-[var(--shop-border)] p-4"><div className="flex gap-2"><button type="button" onClick={() => setWalletMode('deposit')} className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${walletMode === 'deposit' ? 'bg-[var(--shop-blue)] text-[#06202e]' : 'border border-[var(--shop-border)] text-white'}`}>入金</button><button type="button" onClick={() => setWalletMode('withdraw')} className={`flex-1 rounded-lg px-3 py-2 text-xs font-black ${walletMode === 'withdraw' ? 'bg-[var(--shop-accent)] text-white' : 'border border-[var(--shop-border)] text-white'}`}>出金</button></div><div className="mt-3 flex flex-wrap gap-2">{[1000, 5000, 10000].map((amount) => <button key={amount} type="button" onClick={() => setWalletAmount(String(amount))} className="rounded-full border border-[var(--shop-border)] px-3 py-1.5 text-[11px] font-bold text-white hover:border-[var(--shop-blue)]">¥{amount.toLocaleString()}</button>)}</div><div className="mt-3 flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">金額</span><input type="number" min={1} max={1000000} step={1} value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="任意の金額" className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--shop-blue)]" /></label><button type="button" onClick={runWalletOperation} className="rounded-lg bg-[var(--shop-blue)] px-4 py-2.5 text-xs font-black text-[#06202e]">実行</button></div><p className="mt-2 text-[10px] leading-4 text-[var(--shop-muted)]">1〜1,000,000円の整数。取引保留残高は出金できません。外部決済には接続しないSandbox機能です。</p></div><div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-black text-white">台帳明細</h3><button type="button" onClick={() => { const result = getWallet(); showFeedback(result.ok ? '最新の残高を取得しました' : (result.message ?? '取得できませんでした')); }} className="text-[11px] font-bold text-[var(--shop-blue)]">再読み込み</button></div>{wallet?.ledger.length ? <div className="max-h-64 space-y-2 overflow-y-auto">{[...wallet.ledger].reverse().map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--shop-surface-raised)] px-3 py-2 text-[11px]"><span><strong className="block text-white">{{ DEPOSIT: '入金', WITHDRAWAL: '出金', HOLD: '決済保留', CAPTURE: '決済確定', REFUND: '返金', SALE: '売上', FEE: '手数料' }[entry.type]}</strong><span className="text-[var(--shop-muted)]">{formatDate(entry.at)}</span></span><span className={['WITHDRAWAL', 'HOLD', 'FEE'].includes(entry.type) ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-success)]'}>{['WITHDRAWAL', 'HOLD', 'FEE'].includes(entry.type) ? '-' : '+'}¥{entry.amount.toLocaleString()}</span></div>)}</div> : <EmptyPanel message="まだ台帳明細はありません。" />}</div></div></Panel>}
      {activePanel === 'profile' && <Panel title="プロフィール編集" onClose={() => setActivePanel(null)}><div className="space-y-4"><div className="flex items-center gap-4"><img src={profilePreview} alt="プロフィール画像プレビュー" className="h-20 w-20 rounded-full object-cover" /><div className="flex flex-wrap gap-2"><button type="button" onClick={() => profileInputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shop-border)] px-3 py-2 text-xs font-bold text-white"><ImagePlus className="h-4 w-4 text-[var(--shop-blue)]" />画像を選択</button><button type="button" onClick={removeProfileImage} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shop-border)] px-3 py-2 text-xs font-bold text-[var(--shop-muted)]"><Trash2 className="h-4 w-4" />削除</button><input ref={profileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="sr-only" onChange={(event) => void handleProfileImage(event)} /></div></div><label className="block"><span className="mb-1 block text-xs font-bold text-white">表示名 <span className="text-[var(--shop-muted)]">{profileDraft.displayName.length}/60</span></span><input maxLength={60} value={profileDraft.displayName} onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))} className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--shop-blue)]" /></label><label className="block"><span className="mb-1 block text-xs font-bold text-white">自己紹介 <span className="text-[var(--shop-muted)]">{profileDraft.bio.length}/500</span></span><textarea maxLength={500} rows={6} value={profileDraft.bio} onChange={(event) => setProfileDraft((current) => ({ ...current, bio: event.target.value }))} className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] px-3 py-2.5 text-sm leading-5 text-white outline-none focus:border-[var(--shop-blue)]" /></label><p className="text-[11px] leading-5 text-[var(--shop-muted)]">連絡先や外部URLは登録できません。actor identity自体は変更されません。</p><div className="flex gap-2"><button type="button" onClick={() => setActivePanel(null)} className="flex-1 rounded-lg border border-[var(--shop-border)] py-3 text-sm font-bold text-white">キャンセル</button><button type="button" onClick={saveProfile} className="flex-1 rounded-lg bg-[var(--shop-blue)] py-3 text-sm font-black text-[#06202e]"><Save className="mr-1 inline h-4 w-4" />保存</button></div></div></Panel>}
      {activePanel === 'settings' && <Panel title="設定" onClose={() => setActivePanel(null)}><div className="space-y-2 text-sm text-white"><p className="rounded-lg bg-[var(--shop-surface-raised)] p-3">支払い方法・住所・本人確認は外部サービスを含むため、このSandboxの対象外です。</p><p className="rounded-lg bg-[var(--shop-surface-raised)] p-3">Sandboxで利用できるプロフィール編集と仮想ウォレットは、それぞれ専用画面から操作してください。</p></div></Panel>}
      {activePanel === 'help' && <Panel title="ヘルプ・ガイド" onClose={() => setActivePanel(null)}><div className="space-y-2 text-sm text-white"><p className="rounded-lg bg-[var(--shop-surface-raised)] p-3">出品：写真・商品情報・配送・公開前チェックの順に進みます。</p><p className="rounded-lg bg-[var(--shop-surface-raised)] p-3">売却後：取引センターから発送、配達、評価を順番にシミュレートできます。</p></div></Panel>}
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: number; onClick: () => void }> = ({ label, value, onClick }) => <button type="button" onClick={onClick} className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3 text-left hover:bg-[var(--shop-surface-raised)]"><span className="block text-[11px] text-[var(--shop-muted)]">{label}</span><strong className="mt-1 block text-xl text-white">{value}<span className="ml-1 text-[10px] font-normal text-[var(--shop-muted)]">件</span></strong></button>;

const Panel: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => { const { isDeviceFrame } = useMercari(); return <div className={`${isDeviceFrame ? 'absolute' : 'fixed'} inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm`} role="dialog" aria-modal="true" aria-label={`${title}の詳細`}><div className="max-h-[min(760px,calc(100dvh-32px))] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-black text-white">{title}</h2><button type="button" onClick={onClose} aria-label="詳細を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div>{children}<button type="button" onClick={onClose} className="mt-5 w-full rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-black text-white">閉じる</button></div></div>; };

const EmptyPanel: React.FC<{ message: string }> = ({ message }) => <p className="rounded-lg bg-[var(--shop-surface-raised)] p-4 text-center text-sm leading-6 text-[var(--shop-muted)]">{message}</p>;

const FollowListPanel: React.FC<{
  activeTab: FollowDirection;
  followingUsers: ActorProfile[];
  followerUsers: ActorProfile[];
  onTabChange: (direction: FollowDirection) => void;
  onToggle: (actorId: string, currentlyFollowing: boolean) => void;
}> = ({ activeTab, followingUsers, followerUsers, onTabChange, onToggle }) => {
  const { activeActor } = useMercari();
  const users = activeTab === 'following' ? followingUsers : followerUsers;
  const followingIds = new Set(followingUsers.map((profile) => profile.actorId));
  return <div data-testid="follow-list-panel">
    <div className="mb-4 grid grid-cols-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] p-1" role="tablist" aria-label="フォロー一覧の種類">
      {(['following', 'followers'] as const).map((direction) => <button key={direction} type="button" role="tab" aria-selected={activeTab === direction} onClick={() => onTabChange(direction)} className={`rounded-md px-3 py-2 text-xs font-black ${activeTab === direction ? 'bg-[var(--shop-blue)] text-[#06202e]' : 'text-[var(--shop-muted)]'}`}>{direction === 'following' ? `フォロー中 ${followingUsers.length}` : `フォロワー ${followerUsers.length}`}</button>)}
    </div>
    {users.length ? <div className="space-y-2">{users.map((profile) => <div key={profile.actorId} className="flex items-center gap-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3"><AvatarImage src={profile.avatar} mediaRef={profile.avatarRef} alt="" className="h-10 w-10 rounded-full object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-white">{profile.displayName}</p><p className="mt-1 line-clamp-1 text-[11px] text-[var(--shop-muted)]">{profile.bio || '自己紹介はありません'}</p><p className="mt-1 text-[10px] text-[var(--shop-subtle)]">フォロワー {profile.actorId === activeActor.id ? followerUsers.length : '—'}人</p></div>{profile.actorId !== activeActor.id && <button type="button" onClick={() => onToggle(profile.actorId, followingIds.has(profile.actorId))} className={`shrink-0 rounded-md px-3 py-2 text-[11px] font-black ${followingIds.has(profile.actorId) ? 'border border-[var(--shop-border)] text-white' : 'bg-[var(--shop-blue)] text-[#06202e]'}`}>{followingIds.has(profile.actorId) ? 'フォロー中' : 'フォローする'}</button>}</div>)}</div> : <EmptyPanel message={activeTab === 'following' ? 'フォロー中のユーザーはまだいません。商品詳細からフォローできます。' : 'フォロワーはまだいません。'} />}
  </div>;
};

const ListingRow: React.FC<{ item: MercariItem; onOpen: () => void; onAction: (item: MercariItem, action: 'pause' | 'resume' | 'relist') => void }> = ({ item, onOpen, onAction }) => {
  const status = item.listingStatus ?? (item.isSold ? 'SOLD' : 'ACTIVE');
  return <article className="rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3"><div className="flex gap-3"><button type="button" onClick={onOpen} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--shop-surface-raised)]"><img src={item.images[0]} alt="" className="h-full w-full object-cover" /></button><div className="min-w-0 flex-1"><button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-bold text-white hover:underline">{item.title}</button><div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--shop-muted)]"><span className="rounded-full bg-white/10 px-2 py-0.5 font-bold text-white">{listingStatusLabels[status] ?? status}</span><span>¥{item.price.toLocaleString()}</span><span><Eye className="mr-0.5 inline h-3.5 w-3.5" />{item.viewsCount ?? 0}</span><span>いいね {item.likesCount}</span></div></div></div><div className="mt-3 flex flex-wrap gap-2">{status === 'ACTIVE' || status === 'HELD' ? <button type="button" onClick={() => onAction(item, 'pause')} className="inline-flex items-center gap-1 rounded-md border border-white/15 px-3 py-1.5 text-[11px] font-bold text-white"><PauseCircle className="h-3.5 w-3.5" />停止</button> : status === 'ARCHIVED' ? <button type="button" onClick={() => onAction(item, 'resume')} className="inline-flex items-center gap-1 rounded-md border border-[var(--shop-blue)] px-3 py-1.5 text-[11px] font-bold text-[var(--shop-blue)]"><PlayCircle className="h-3.5 w-3.5" />再開</button> : null}{(status === 'SOLD' || status === 'ARCHIVED') && <button type="button" onClick={() => onAction(item, 'relist')} className="inline-flex items-center gap-1 rounded-md bg-[var(--shop-accent)] px-3 py-1.5 text-[11px] font-bold text-white"><RotateCcw className="h-3.5 w-3.5" />再出品</button>}</div></article>;
};

const transactionStatusLabels: Record<string, string> = { PAYMENT_PENDING: '支払い待ち', AWAITING_SHIPMENT: '発送待ち', SHIPPED: '発送済み', DELIVERED: '配達済み・受取評価待ち', BUYER_REVIEWED: '購入者評価済み・出品者評価待ち', SELLER_REVIEWED: '出品者評価済み', COMPLETED: '取引完了・売上反映', CANCELED: 'キャンセル', CANCEL_REQUESTED: 'キャンセル申請中', REFUNDED: '返金済み' };

const TransactionCenter: React.FC<{ transactions: TransactionRecord[]; actorId: string; onShip: ReturnType<typeof useMercari>['shipOrder']; onDeliver: ReturnType<typeof useMercari>['markDelivered']; onReview: ReturnType<typeof useMercari>['reviewOrder']; onCancel: ReturnType<typeof useMercari>['cancelOrder'] }> = ({ transactions, actorId, onShip, onDeliver, onReview, onCancel }) => {
  const [feedback, setFeedback] = React.useState<string | null>(null);
  if (transactions.length === 0) return null;
  const act = (result: { ok: boolean; message?: string }) => setFeedback(result.ok ? '取引状態を更新しました' : result.message ?? '取引操作に失敗しました');
  return <section className="rounded-xl border border-[#2b5367] bg-[#122b3a]/70 p-4" aria-labelledby="transaction-center-title"><div className="flex items-center justify-between gap-3"><div><h2 id="transaction-center-title" className="text-sm font-black text-white">取引センター</h2><p className="mt-1 text-[11px] text-[var(--shop-muted)]">Actor: {actorId} ・ 購入→発送→受取→相互評価</p></div><span className="rounded-full bg-[#16394d] px-2 py-1 text-[10px] font-bold text-[var(--shop-blue)]">{transactions.length}件</span></div><div className="mt-3 space-y-2">{transactions.map((transaction) => <div key={transaction.id} className="rounded-lg border border-white/10 bg-black/15 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-bold text-white">{transaction.titleSnapshot}</p><p className="mt-1 text-[11px] text-[var(--shop-muted)]">{transaction.orderId} ・ ¥{transaction.total.toLocaleString()}</p></div><span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-[#c5eaff]">{transactionStatusLabels[transaction.status] ?? transaction.status}</span></div><div className="mt-3 flex flex-wrap gap-2">{transaction.status === 'AWAITING_SHIPMENT' && transaction.sellerId === actorId && <button type="button" onClick={() => act(onShip(transaction.id))} className="rounded-md bg-[var(--shop-blue)] px-3 py-1.5 text-[11px] font-bold text-[#0d202b]">発送する</button>}{transaction.status === 'SHIPPED' && transaction.buyerId === actorId && <button type="button" onClick={() => act(onDeliver(transaction.id))} className="rounded-md bg-[var(--shop-blue)] px-3 py-1.5 text-[11px] font-bold text-[#0d202b]">配達完了</button>}{transaction.status === 'DELIVERED' && transaction.buyerId === actorId && <button type="button" onClick={() => act(onReview(transaction.id, 5, '良い取引でした'))} className="rounded-md bg-[var(--shop-accent)] px-3 py-1.5 text-[11px] font-bold text-white">受取評価する</button>}{transaction.status === 'BUYER_REVIEWED' && transaction.sellerId === actorId && <button type="button" onClick={() => act(onReview(transaction.id, 5, 'ありがとうございました'))} className="rounded-md bg-[var(--shop-accent)] px-3 py-1.5 text-[11px] font-bold text-white">出品者評価する</button>}{['PAYMENT_PENDING', 'AWAITING_SHIPMENT'].includes(transaction.status) && <button type="button" onClick={() => act(onCancel(transaction.id, 'Sandbox UIからのキャンセル'))} className="rounded-md border border-white/15 px-3 py-1.5 text-[11px] font-bold text-[var(--shop-muted)]">キャンセル</button>}</div></div>)}</div>{feedback && <p className="mt-3 text-[11px] text-[#9dd8f5]" role="status">{feedback}</p>}</section>;
};

const TransactionList: React.FC<{ transactions: TransactionRecord[]; emptyMessage: string; onOpen: (itemId: string) => void }> = ({ transactions, emptyMessage, onOpen }) => transactions.length ? <div className="space-y-2">{transactions.map((transaction) => <button key={transaction.id} type="button" onClick={() => onOpen(transaction.itemId)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3 text-left hover:bg-[var(--shop-surface-raised)]"><span className="min-w-0"><strong className="block truncate text-sm text-white">{transaction.titleSnapshot}</strong><span className="mt-1 block text-[11px] text-[var(--shop-muted)]">{transaction.orderId} ・ ¥{transaction.total.toLocaleString()} ・ {formatDate(transaction.updatedAt)}</span></span><span className="shrink-0 text-[11px] font-bold text-[var(--shop-blue)]">{transactionStatusLabels[transaction.status] ?? transaction.status}</span></button>)}</div> : <EmptyPanel message={emptyMessage} />;

const ManagementGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <section><h2 className="mb-2 text-sm font-bold text-white">{title}</h2><div className="divide-y divide-[var(--shop-border)] overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)]">{children}</div></section>;
const ManagementButton: React.FC<{ icon: React.ReactNode; label: string; value?: string; onClick?: () => void; disabled?: boolean }> = ({ icon, label, value, onClick, disabled = false }) => <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} data-feature-status={disabled ? 'sandbox-out-of-scope' : 'implemented'} className={`flex w-full items-center justify-between px-4 py-4 text-left text-sm text-white transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--shop-surface-raised)]'}`}><span className="flex items-center gap-3">{icon}{label}</span><span className="flex items-center gap-2 text-xs text-[var(--shop-muted)]">{value}{disabled ? null : <ChevronRight className="h-4 w-4" />}</span></button>;
