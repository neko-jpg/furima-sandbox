'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, CheckCircle2, ChevronLeft, Flag, Heart, MessageCircle, Send, Share2, ShieldCheck, Star, Truck, UserPlus, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { MercariItem } from '../../types/mercari';
import { Footer } from '../Footer';
import { AvatarImage } from '../ui/AvatarImage';
import { ShopImage } from '../ui/ShopImage';

interface ItemDetailViewProps {
  item: MercariItem;
  onClose: () => void;
}

export const ItemDetailView: React.FC<ItemDetailViewProps> = ({ item, onClose }) => {
  const { isAuthenticated, requestLogin, setLiked, setSaved, savedItemIds, addComment, startPurchase, items, openItem, isDeviceFrame, isSearchOpen, searchQuery, activeActor, getFollowSummary, followUser, unfollowUser } = useMercari();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [commentInput, setCommentInput] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'profile' | 'shipping' | 'report' | null>(null);
  const liked = Boolean(item.isLiked);
  const saved = savedItemIds.includes(item.id);
  const isUnavailable = Boolean(item.isSold);
  const inventoryQuantity = item.isSold ? 0 : item.inventoryQuantity ?? 1;
  const buyerShippingCost = item.shippingFee.includes('送料込み') ? 0 : 800;
  const displayedPurchaseTotal = item.price + buyerShippingCost;
  const attributeEntries = Object.entries(item.attributes ?? {});
  const inventoryPolicyLabel = item.inventoryPolicy === 'MULTI' ? '複数在庫（在庫数を減算）' : '一点在庫（購入でSOLD）';
  const relatedItems = items.filter((candidate) => candidate.id !== item.id && !candidate.isAuction).slice(0, 6);
  const sellerId = item.sellerId ?? 'seller_01';
  const followSummaryResult = getFollowSummary(sellerId);
  const isFollowingSeller = followSummaryResult.ok && followSummaryResult.data.isFollowing;

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirstControl = () => dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.setTimeout(focusFirstControl, 0);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previousActiveElement?.isConnected) previousActiveElement.focus({ preventScroll: true });
    };
  }, [onClose]);

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 2200);
  };
  const handleLike = () => {
    const result = setLiked(item.id, !liked);
    if (result.ok) showFeedback(liked ? 'いいねを解除しました' : 'いいねしました');
  };
  const handleSave = () => {
    const result = setSaved(item.id, !saved);
    if (result.ok) showFeedback(saved ? '保存を解除しました' : '商品を保存しました');
  };
  const handlePurchase = () => {
    if (isUnavailable) return;
    const result = startPurchase(item.id);
    if (!result.ok) showFeedback(result.message || '購入確認を開始できませんでした');
  };
  const handleFollow = () => {
    if (sellerId === activeActor.id) return;
    if (!isAuthenticated) { requestLogin('フォローするにはログインが必要です。'); return; }
    const result = isFollowingSeller ? unfollowUser(sellerId) : followUser(sellerId);
    showFeedback(result.ok ? (isFollowingSeller ? 'フォローを解除しました' : 'フォローしました') : (result.message || 'フォロー操作に失敗しました'));
  };
  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#item=${encodeURIComponent(item.id)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url: shareUrl });
        showFeedback('商品ページを共有しました');
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      showFeedback('商品ページのリンクをコピーしました');
    } catch {
      showFeedback('共有をキャンセルしました');
    }
  };
  const handleCommentSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = addComment(item.id, commentInput);
    if (!result.ok) { setCommentError(result.message || 'コメントを送信できませんでした。'); return; }
    setCommentInput('');
    setCommentError(null);
  };

  return (
    <div ref={dialogRef} className={`${isDeviceFrame ? 'absolute' : 'fixed'} inset-0 z-50 flex flex-col overflow-y-auto bg-[var(--shop-bg)] animate-fade-in`} role="dialog" aria-modal="true" aria-labelledby="item-detail-title" data-testid="item-detail-view">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--shop-border)] bg-[rgba(31,31,33,.94)] px-3 py-2.5 backdrop-blur-xl">
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white hover:bg-[var(--shop-surface-raised)]" aria-label={isSearchOpen && searchQuery ? '商品詳細を閉じて検索結果へ戻る' : '商品詳細を閉じる'} data-testid="back-button"><ChevronLeft className="h-6 w-6" /></button>
        <div className="flex items-center gap-1 text-white"><button type="button" onClick={() => void handleShare()} aria-label="商品をシェア" className="rounded-full p-1.5 hover:bg-[var(--shop-surface-raised)]"><Share2 className="h-5 w-5" /></button><button type="button" onClick={handleLike} aria-label={liked ? 'いいねを外す' : 'いいねする'} className={`rounded-full p-1.5 hover:bg-[var(--shop-surface-raised)] ${liked ? 'text-[var(--shop-accent)]' : 'text-white'}`} data-testid="detail-like-btn"><Heart className={`h-5 w-5 ${liked ? 'fill-current' : ''}`} /></button></div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-32 md:px-7">
        <div className="flex items-center gap-1 overflow-x-auto py-4 text-xs text-[var(--shop-muted)] no-scrollbar"><button type="button" onClick={onClose} className="shrink-0 font-bold text-white hover:text-[var(--shop-blue)]">{isSearchOpen && searchQuery ? '検索結果へ戻る' : 'ホーム'}</button><span>/</span><span className="shrink-0">{item.category.join(' / ')}</span></div>
        <div className={`grid gap-6 pb-8 md:grid-cols-[minmax(0,1.08fr)_minmax(340px,.92fr)] md:gap-8 ${isDeviceFrame ? 'grid-cols-1' : ''}`}>
          <section className={`min-w-0 ${isDeviceFrame ? '' : 'md:sticky md:top-20 md:self-start'}`}>
            <div className="relative aspect-square overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[#37373a] md:rounded-2xl"><ShopImage src={item.images[activeImageIdx] || item.images[0]} alt={item.title} width={960} height={960} className="h-full w-full object-cover" loading="eager" />{isUnavailable && <span className="absolute -left-9 top-7 z-10 w-32 -rotate-45 bg-[var(--shop-accent)] py-1.5 text-center text-xs font-black tracking-widest text-white shadow-lg">SOLD</span>}{item.isAuction && <span className="absolute left-3 top-3 rounded-full bg-[#00c853] px-3 py-1 text-xs font-black text-white">オークション</span>}<span className="absolute bottom-3 right-3 rounded-full bg-black/65 px-2.5 py-1 text-[11px] text-white">{activeImageIdx + 1} / {item.images.length}</span></div>
            {item.images.length > 1 && <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">{item.images.map((image, index) => <button type="button" key={image} onClick={() => setActiveImageIdx(index)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${activeImageIdx === index ? 'border-[var(--shop-accent)]' : 'border-transparent'}`} aria-label={`商品画像${index + 1}`}><ShopImage src={image} alt="" width={128} height={128} className="h-full w-full object-cover" /></button>)}</div>}
            {item.sourceAttribution && <p className="mt-2 text-[10px] leading-4 text-[var(--shop-subtle)]">画像提供: {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-[var(--shop-muted)] underline decoration-[var(--shop-border)] underline-offset-2 hover:text-white">{item.sourceAttribution}</a> : item.sourceAttribution}</p>}
          </section>

          <section className="min-w-0">
            <div className="flex items-start justify-between gap-4"><h1 id="item-detail-title" className="text-lg font-bold leading-7 text-white md:text-2xl md:leading-9">{item.title}</h1><button type="button" onClick={handleSave} aria-label={saved ? '保存を解除' : '商品を保存'} className={`shrink-0 rounded-full p-2 hover:bg-[var(--shop-surface-raised)] ${saved ? 'text-[var(--shop-blue)]' : 'text-[var(--shop-muted)]'}`}><Bookmark className={`h-5 w-5 ${saved ? 'fill-current' : ''}`} /></button></div>
            {item.isDemo && <div className="mt-3 rounded-xl border border-[var(--shop-blue)]/35 bg-[#143247]/60 px-3 py-2.5" role="note"><div className="flex items-center justify-between gap-3"><span className="text-xs font-black text-[var(--shop-blue)]">サンドボックス商品</span><span className={`text-[10px] font-bold ${isUnavailable ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-muted)]'}`}>{isUnavailable ? 'SOLD' : `デモ在庫 ${inventoryQuantity}点`}</span></div><p className="mt-1 text-[10px] leading-4 text-[var(--shop-muted)]">画像を使った操作確認用の出品です。実物の商品・決済・配送は発生しません。</p>{item.productFamilyName && <p className="mt-1 text-[10px] leading-4 text-[var(--shop-muted)]">{item.productFamilyName}{item.variantName ? ` / ${item.variantName}` : ''} ・ {inventoryPolicyLabel}</p>}</div>}
            <div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-3xl font-black tracking-tight text-white md:text-4xl">¥{(item.currentBid ?? item.price).toLocaleString()}</div>{item.isAuction && <p className="mt-1 text-xs text-[var(--shop-muted)]">現在の最高入札 {item.bidsCount ?? 0}件 ・ {item.timeLeft || '残り1日'}</p>}<p className="mt-1 text-xs text-[var(--shop-muted)]">税込・送料込み</p></div><div className="text-right text-xs text-[var(--shop-muted)]"><Heart className="mr-1 inline h-4 w-4" />{item.likesCount}<span className="ml-3"><MessageCircle className="mr-1 inline h-4 w-4" />{item.comments.length}</span></div></div>
            <div className="my-5 grid grid-cols-2 divide-x divide-[var(--shop-border)] rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3 text-center text-xs"><div><div className="text-[var(--shop-muted)]">配送料の負担</div><div className="mt-1 font-bold text-white">{item.shippingFee}</div></div><div><div className="text-[var(--shop-muted)]">発送まで</div><div className="mt-1 font-bold text-white">{item.shippingDays}</div></div></div>
            <div className="space-y-2.5"><button type="button" onClick={handlePurchase} disabled={isUnavailable} className="w-full rounded-xl bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white shadow-[0_8px_18px_rgba(255,59,74,.18)] transition-colors hover:bg-[var(--shop-accent-strong)] disabled:cursor-not-allowed disabled:bg-[#55555a]" data-testid="detail-purchase-btn">{isUnavailable ? 'SOLD' : item.isAuction ? '入札する' : '購入手続きへ'}</button><button type="button" onClick={handleLike} className={`w-full rounded-xl border py-3 text-sm font-bold transition-colors ${liked ? 'border-[var(--shop-accent)] text-[var(--shop-accent)]' : 'border-[var(--shop-border)] text-white hover:bg-[var(--shop-surface)]'}`}><Heart className={`mr-2 inline h-4 w-4 ${liked ? 'fill-current' : ''}`} />{liked ? 'いいね済み' : 'いいねする'}</button></div>
            <div className="mt-6 border-t border-[var(--shop-border)] pt-5"><h2 className="mb-3 text-sm font-bold text-white">出品者</h2><div className="flex items-center gap-3"><AvatarImage src={item.seller.avatar} mediaRef={item.seller.avatarRef} alt="" className="h-12 w-12 rounded-full object-cover" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-white">{item.seller.name}{item.seller.isVerified && <span className="inline-flex items-center gap-1 rounded-full bg-[#16394d] px-2 py-0.5 text-[10px] font-bold text-[var(--shop-blue)]"><CheckCircle2 className="h-3 w-3" />本人確認済み</span>}</div><div className="mt-1 flex items-center gap-1 text-xs text-[var(--shop-muted)]"><RatingStars rating={item.seller.rating} /><span className="ml-1">{item.seller.rating.toFixed(1)}（{item.seller.ratingsCount}件）</span></div></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={handleFollow} disabled={sellerId === activeActor.id} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold ${isFollowingSeller ? 'border-[var(--shop-blue)] text-[var(--shop-blue)]' : 'border-[var(--shop-border)] text-white'} disabled:cursor-default disabled:opacity-60`} aria-label={sellerId === activeActor.id ? '自分の出品' : isFollowingSeller ? '出品者のフォローを解除' : '出品者をフォロー'}><UserPlus className="h-3.5 w-3.5" />{sellerId === activeActor.id ? '自分の出品' : isFollowingSeller ? 'フォロー中' : 'フォロー'}</button><button type="button" onClick={() => setSheet('profile')} className="rounded-lg border border-[var(--shop-border)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--shop-surface)]">信頼情報</button></div></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]"><div className="rounded-lg bg-[var(--shop-surface)] p-2"><span className="block text-[var(--shop-muted)]">取引実績</span><strong className="mt-0.5 block text-white">{(item.seller.completedSales ?? item.seller.ratingsCount * 2).toLocaleString()}件</strong></div><div className="rounded-lg bg-[var(--shop-surface)] p-2"><span className="block text-[var(--shop-muted)]">フォロワー</span><strong className="mt-0.5 block text-white">{followSummaryResult.ok ? followSummaryResult.data.followerCount.toLocaleString() : 0}人</strong></div><div className="rounded-lg bg-[var(--shop-surface)] p-2"><span className="block text-[var(--shop-muted)]">発送目安</span><strong className="mt-0.5 block text-white">{item.shippingDays}</strong></div></div></div>
          </section>
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <section className="border-t border-[var(--shop-border)] pt-5"><h2 className="mb-3 text-base font-bold text-white">商品説明</h2><p className="whitespace-pre-wrap text-sm leading-7 text-[var(--shop-text)]">{item.description}</p></section>
            <section className="border-t border-[var(--shop-border)] pt-5"><h2 className="mb-3 text-base font-bold text-white">商品情報</h2><dl className="divide-y divide-[var(--shop-border)] rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] text-sm"><InfoRow label="カテゴリー" value={item.category.join(' / ')} />{item.productFamilyName && <InfoRow label="商品ファミリー" value={item.productFamilyName} />}{item.variantName && <InfoRow label="バリエーション" value={item.variantName} />}{item.productType && <InfoRow label="商品タイプ" value={item.productType} />}<InfoRow label="商品の状態" value={item.condition} /><InfoRow label="在庫状態" value={item.isDemo ? (isUnavailable ? 'SOLD（デモ在庫 0点）' : `販売中（デモ在庫 ${inventoryQuantity}点）`) : (isUnavailable ? 'SOLD' : '販売中')} />{item.inventoryPolicy && <InfoRow label="在庫ポリシー" value={inventoryPolicyLabel} />}{attributeEntries.map(([key, value]) => <InfoRow key={key} label={key} value={value} />)}<InfoRow label="配送料の負担" value={item.shippingFee} /><InfoRow label="配送の方法" value={item.shippingMethod} /><InfoRow label="発送元の地域" value={item.origin} /></dl></section>
            <section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--shop-blue)]" /><div><h2 className="text-sm font-bold text-white">Furima Sandboxの取引サポート</h2><p className="mt-1 text-xs leading-5 text-[var(--shop-muted)]">支払い・発送・受取・相互評価を、Domain Eventと一緒にシミュレーションできます。</p><div className="mt-3 grid gap-2 text-xs text-[var(--shop-text)] sm:grid-cols-3"><span className="rounded-lg bg-[var(--shop-surface-raised)] px-2.5 py-2">✓ 決済はエミュレータ</span><span className="rounded-lg bg-[var(--shop-surface-raised)] px-2.5 py-2">✓ 配送状態を段階管理</span><span className="rounded-lg bg-[var(--shop-surface-raised)] px-2.5 py-2">✓ 評価・売上反映を再現</span></div></div></div></section>
            {!item.isAuction && <section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-white">購入前の金額イメージ</h2><span className="rounded-full bg-[#16394d] px-2 py-1 text-[10px] font-bold text-[var(--shop-blue)]">デモ内訳</span></div><div className="space-y-2 text-xs"><div className="flex justify-between text-[var(--shop-muted)]"><span>商品価格</span><span className="text-white">¥{item.price.toLocaleString()}</span></div><div className="flex justify-between text-[var(--shop-muted)]"><span>送料</span><span className="text-white">{buyerShippingCost ? `購入者負担 ¥${buyerShippingCost.toLocaleString()}` : '出品者負担'}</span></div><div className="flex justify-between text-[var(--shop-muted)]"><span>購入者手数料</span><span className="text-white">¥0（デモ）</span></div><div className="flex justify-between border-t border-[var(--shop-border)] pt-2 text-sm font-black text-white"><span>支払い予定額</span><span className="text-[var(--shop-accent)]">¥{displayedPurchaseTotal.toLocaleString()}</span></div></div><button type="button" onClick={() => setSheet('shipping')} className="mt-3 text-xs font-bold text-[var(--shop-blue)] hover:text-white">返品・補償・配送ポリシーを確認 →</button></section>}
            <section className="border-t border-[var(--shop-border)] pt-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold text-white">コメント（{item.comments.length}）</h2><button type="button" onClick={() => setSheet('report')} className="text-[var(--shop-muted)]" aria-label="コメントを報告"><Flag className="h-4 w-4" /></button></div>{isAuthenticated ? <form onSubmit={handleCommentSubmit} className="mb-4 flex gap-2"><label htmlFor="comment-input" className="sr-only">コメント</label><input id="comment-input" value={commentInput} onChange={(event) => setCommentInput(event.target.value)} placeholder="コメントを入力" className="min-w-0 flex-1 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[var(--shop-subtle)] focus:border-[var(--shop-blue)]" data-testid="comment-input" /><button type="submit" className="rounded-lg bg-[var(--shop-blue)] px-3 text-white" aria-label="コメントを送信"><Send className="h-4 w-4" /></button></form> : <div className="mb-4 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 text-center"><p className="text-sm text-[var(--shop-muted)]">コメントするにはログインが必要です。</p><button type="button" onClick={() => requestLogin('コメントするにはログインが必要です。')} className="mt-3 rounded-lg border border-[var(--shop-blue)] px-5 py-2 text-sm font-bold text-[var(--shop-blue)]">ログインしてコメント</button></div>}{commentError && <p className="mb-3 text-xs text-red-300" role="alert">{commentError}</p>}<div className="space-y-4">{item.comments.length === 0 ? <p className="py-5 text-center text-xs text-[var(--shop-muted)]">まだコメントはありません。</p> : item.comments.map((comment) => <div key={comment.id} className="flex gap-3"><ShopImage src={comment.userAvatar} alt="" width={64} height={64} className="h-8 w-8 rounded-full object-cover" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-white">{comment.userName}</span><span className="text-[10px] text-[var(--shop-subtle)]">{comment.date}</span></div><p className="mt-1 text-sm leading-6 text-[var(--shop-text)]">{comment.text}</p></div></div>)}</div></section>
          </div>
          <aside className="space-y-4"><section><h2 className="mb-3 text-sm font-bold text-white">おすすめの商品</h2><div className="grid grid-cols-2 gap-2">{relatedItems.map((related) => <button type="button" key={related.id} onClick={() => openItem(related.id)} className="overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] text-left hover:border-[var(--shop-blue)]"><ShopImage src={related.images[0]} alt={related.title} width={320} height={320} className="aspect-square w-full object-cover" loading="lazy" /><div className="p-2"><p className="line-clamp-2 text-[11px] leading-4 text-white">{related.title}</p><p className="mt-1 text-xs font-bold text-white">¥{related.price.toLocaleString()}</p></div></button>)}</div></section><button type="button" onClick={() => setSheet('shipping')} className="flex w-full items-center justify-between rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 text-left text-sm font-bold text-white"><span className="flex items-center gap-2"><Truck className="h-4 w-4 text-[var(--shop-blue)]" />配送について</span><X className="h-4 w-4 rotate-45 text-[var(--shop-muted)]" /></button></aside>
        </div>
      </main>

      {feedback && <div className="sticky bottom-[74px] z-30 mx-auto w-fit max-w-[calc(100%-32px)] rounded-full border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] px-4 py-2 text-xs font-bold text-white shadow-xl" role="status">{feedback}</div>}
      {sheet && <DetailSheet type={sheet} seller={item.seller.name} onClose={() => setSheet(null)} />}
      <div className="sticky bottom-0 z-20 border-t border-[var(--shop-border)] bg-[rgba(31,31,33,.96)] px-4 py-3 backdrop-blur-xl"><div className="mx-auto flex max-w-[1120px] items-center gap-2"><button type="button" onClick={handleLike} className="hidden w-16 rounded-lg border border-[var(--shop-border)] py-2.5 text-[var(--shop-muted)] sm:block" aria-label="いいね"><Heart className={`mx-auto h-5 w-5 ${liked ? 'fill-current text-[var(--shop-accent)]' : ''}`} /></button><button type="button" disabled={isUnavailable} onClick={handlePurchase} className="flex-1 rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-[#55555a]" data-testid="fixed-purchase-btn">{isUnavailable ? 'SOLD' : item.isAuction ? '入札する' : '購入手続きへ'}</button></div></div>
      <Footer />
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="grid grid-cols-[110px_1fr] gap-3 px-4 py-3"><dt className="text-[var(--shop-muted)]">{label}</dt><dd className="text-right text-white">{value}</dd></div>;
const RatingStars: React.FC<{ rating: number }> = ({ rating }) => <span className="inline-flex text-[#ffc107]">{[0, 1, 2, 3, 4].map((index) => <Star key={index} className={`h-3.5 w-3.5 ${index + 0.5 <= rating ? 'fill-current' : ''}`} />)}</span>;

const DetailSheet: React.FC<{ type: 'profile' | 'shipping' | 'report'; seller: string; onClose: () => void }> = ({ type, seller, onClose }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirstControl = () => sheetRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const frame = window.requestAnimationFrame(focusFirstControl);
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('keydown', handleKeyDown); if (previousActiveElement?.isConnected) previousActiveElement.focus({ preventScroll: true }); };
  }, [onClose]);
  const content = type === 'profile'
    ? { title: `${seller}の信頼情報`, body: '評価・出品履歴・本人確認状況を確認できます。', points: ['本人確認済み（デモ）', '過去の取引評価を表示', '平均返信率・発送目安を表示'] }
    : type === 'shipping'
      ? { title: '配送・返品ポリシー', body: 'デモ用の配送・取引フローです。実際の配送や返金は発生しません。', points: ['送料込み（出品者負担）・匿名配送を表示', '発送目安と配送方法を購入前に確認', '困った場合は取引キャンセルをシミュレート'] }
      : { title: '商品を報告', body: '不適切な商品や説明を見つけた場合の報告フォームです。', points: ['禁止出品物・危険物', '著作権・個人情報の掲載', '説明と実物が異なる場合'] };
  return <div className="absolute inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={content.title}><div ref={sheetRef} className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up"><div className="flex items-center justify-between"><h2 className="text-base font-black text-white">{content.title}</h2><button type="button" onClick={onClose} aria-label="詳細を閉じる" className="rounded-full p-1 text-[var(--shop-muted)]"><X className="h-5 w-5" /></button></div><p className="mt-4 text-sm leading-6 text-[var(--shop-muted)]">{content.body}</p><ul className="mt-4 space-y-2">{content.points.map((point) => <li key={point} className="flex items-start gap-2 rounded-lg bg-[var(--shop-surface-raised)] px-3 py-2 text-xs text-white"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--shop-blue)]" />{point}</li>)}</ul><button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-[var(--shop-accent)] py-3 text-sm font-black text-white">閉じる</button></div></div>;
};
