'use client';

import React, { useEffect, useState } from 'react';
import { Bookmark, CheckCircle2, ChevronLeft, Flag, Heart, MessageCircle, Send, Share2, ShieldCheck, Star, Truck, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { MercariItem } from '../../types/mercari';
import { Footer } from '../Footer';

interface ItemDetailViewProps {
  item: MercariItem;
  onClose: () => void;
}

export const ItemDetailView: React.FC<ItemDetailViewProps> = ({ item, onClose }) => {
  const { isAuthenticated, requestLogin, setLiked, setSaved, savedItemIds, addComment, startPurchase, items, openItem, isDeviceFrame } = useMercari();
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [commentInput, setCommentInput] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'profile' | 'shipping' | 'report' | null>(null);
  const liked = Boolean(item.isLiked);
  const saved = savedItemIds.includes(item.id);
  const isUnavailable = Boolean(item.isSold);
  const relatedItems = items.filter((candidate) => candidate.id !== item.id && !candidate.isAuction).slice(0, 6);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
  const handlePurchase = () => { if (!isUnavailable) startPurchase(item.id); };
  const handleCommentSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = addComment(item.id, commentInput);
    if (!result.ok) { setCommentError(result.message || 'コメントを送信できませんでした。'); return; }
    setCommentInput('');
    setCommentError(null);
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col overflow-y-auto bg-[var(--shop-bg)] animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="item-detail-title" data-testid="item-detail-view">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--shop-border)] bg-[rgba(31,31,33,.94)] px-3 py-2.5 backdrop-blur-xl">
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white hover:bg-[var(--shop-surface-raised)]" aria-label="商品詳細を閉じる" data-testid="back-button"><ChevronLeft className="h-6 w-6" /></button>
        <div className="flex items-center gap-1 text-white"><button type="button" onClick={() => showFeedback('商品ページのリンクをコピーしました')} aria-label="商品をシェア" className="rounded-full p-1.5 hover:bg-[var(--shop-surface-raised)]"><Share2 className="h-5 w-5" /></button><button type="button" onClick={handleLike} aria-label={liked ? 'いいねを外す' : 'いいねする'} className={`rounded-full p-1.5 hover:bg-[var(--shop-surface-raised)] ${liked ? 'text-[var(--shop-accent)]' : 'text-white'}`} data-testid="detail-like-btn"><Heart className={`h-5 w-5 ${liked ? 'fill-current' : ''}`} /></button></div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-32 md:px-7">
        <div className="flex items-center gap-1 overflow-x-auto py-4 text-xs text-[var(--shop-muted)] no-scrollbar"><button type="button" onClick={onClose} className="shrink-0 hover:text-white">ホーム</button><span>/</span><span className="shrink-0">{item.category.join(' / ')}</span></div>
        <div className={`grid gap-6 pb-8 md:grid-cols-[minmax(0,1.08fr)_minmax(340px,.92fr)] md:gap-8 ${isDeviceFrame ? 'grid-cols-1' : ''}`}>
          <section className={`min-w-0 ${isDeviceFrame ? '' : 'md:sticky md:top-20 md:self-start'}`}>
            <div className="relative aspect-square overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[#37373a] md:rounded-2xl"><img src={item.images[activeImageIdx] || item.images[0]} alt={item.title} className="h-full w-full object-cover" decoding="async" />{isUnavailable && <span className="absolute -left-9 top-7 z-10 w-32 -rotate-45 bg-[var(--shop-accent)] py-1.5 text-center text-xs font-black tracking-widest text-white shadow-lg">SOLD</span>}{item.isAuction && <span className="absolute left-3 top-3 rounded-full bg-[#00c853] px-3 py-1 text-xs font-black text-white">オークション</span>}<span className="absolute bottom-3 right-3 rounded-full bg-black/65 px-2.5 py-1 text-[11px] text-white">{activeImageIdx + 1} / {item.images.length}</span></div>
            {item.images.length > 1 && <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">{item.images.map((image, index) => <button type="button" key={image} onClick={() => setActiveImageIdx(index)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${activeImageIdx === index ? 'border-[var(--shop-accent)]' : 'border-transparent'}`} aria-label={`商品画像${index + 1}`}><img src={image} alt="" className="h-full w-full object-cover" /></button>)}</div>}
          </section>

          <section className="min-w-0">
            <div className="flex items-start justify-between gap-4"><h1 id="item-detail-title" className="text-lg font-bold leading-7 text-white md:text-2xl md:leading-9">{item.title}</h1><button type="button" onClick={handleSave} aria-label={saved ? '保存を解除' : '商品を保存'} className={`shrink-0 rounded-full p-2 hover:bg-[var(--shop-surface-raised)] ${saved ? 'text-[var(--shop-blue)]' : 'text-[var(--shop-muted)]'}`}><Bookmark className={`h-5 w-5 ${saved ? 'fill-current' : ''}`} /></button></div>
            <div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-3xl font-black tracking-tight text-white md:text-4xl">¥{(item.currentBid ?? item.price).toLocaleString()}</div>{item.isAuction && <p className="mt-1 text-xs text-[var(--shop-muted)]">現在の最高入札 {item.bidsCount ?? 0}件 ・ {item.timeLeft || '残り1日'}</p>}<p className="mt-1 text-xs text-[var(--shop-muted)]">税込・送料込み</p></div><div className="text-right text-xs text-[var(--shop-muted)]"><Heart className="mr-1 inline h-4 w-4" />{item.likesCount}<span className="ml-3"><MessageCircle className="mr-1 inline h-4 w-4" />{item.comments.length}</span></div></div>
            <div className="my-5 grid grid-cols-2 divide-x divide-[var(--shop-border)] rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3 text-center text-xs"><div><div className="text-[var(--shop-muted)]">配送料の負担</div><div className="mt-1 font-bold text-white">{item.shippingFee}</div></div><div><div className="text-[var(--shop-muted)]">発送まで</div><div className="mt-1 font-bold text-white">{item.shippingDays}</div></div></div>
            <div className="space-y-2.5"><button type="button" onClick={handlePurchase} disabled={isUnavailable} className="w-full rounded-xl bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white shadow-[0_8px_18px_rgba(255,59,74,.18)] transition-colors hover:bg-[var(--shop-accent-strong)] disabled:cursor-not-allowed disabled:bg-[#55555a]" data-testid="detail-purchase-btn">{isUnavailable ? 'SOLD' : item.isAuction ? '入札する' : '購入手続きへ'}</button><button type="button" onClick={handleLike} className={`w-full rounded-xl border py-3 text-sm font-bold transition-colors ${liked ? 'border-[var(--shop-accent)] text-[var(--shop-accent)]' : 'border-[var(--shop-border)] text-white hover:bg-[var(--shop-surface)]'}`}><Heart className={`mr-2 inline h-4 w-4 ${liked ? 'fill-current' : ''}`} />{liked ? 'いいね済み' : 'いいねする'}</button></div>
            <div className="mt-6 border-t border-[var(--shop-border)] pt-5"><h2 className="mb-3 text-sm font-bold text-white">出品者</h2><div className="flex items-center gap-3"><img src={item.seller.avatar} alt="" className="h-12 w-12 rounded-full object-cover" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-sm font-bold text-white">{item.seller.name}{item.seller.isVerified && <CheckCircle2 className="h-4 w-4 text-[var(--shop-blue)]" />}</div><div className="mt-1 flex items-center gap-1 text-xs text-[var(--shop-muted)]"><RatingStars rating={item.seller.rating} /><span className="ml-1">{item.seller.rating.toFixed(1)}（{item.seller.ratingsCount}件）</span></div></div><button type="button" onClick={() => setSheet('profile')} className="rounded-lg border border-[var(--shop-border)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--shop-surface)]">プロフィール</button></div></div>
          </section>
        </div>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <section className="border-t border-[var(--shop-border)] pt-5"><h2 className="mb-3 text-base font-bold text-white">商品説明</h2><p className="whitespace-pre-wrap text-sm leading-7 text-[var(--shop-text)]">{item.description}</p></section>
            <section className="border-t border-[var(--shop-border)] pt-5"><h2 className="mb-3 text-base font-bold text-white">商品情報</h2><dl className="divide-y divide-[var(--shop-border)] rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] text-sm"><InfoRow label="カテゴリー" value={item.category.join(' / ')} /><InfoRow label="商品の状態" value={item.condition} /><InfoRow label="配送料の負担" value={item.shippingFee} /><InfoRow label="配送の方法" value={item.shippingMethod} /><InfoRow label="発送元の地域" value={item.origin} /></dl></section>
            <section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--shop-blue)]" /><div><h2 className="text-sm font-bold text-white">shopの安心サポート</h2><p className="mt-1 text-xs leading-5 text-[var(--shop-muted)]">支払いと発送をサポート。困ったときはいつでも問い合わせできます。</p></div></div></section>
            <section className="border-t border-[var(--shop-border)] pt-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold text-white">コメント（{item.comments.length}）</h2><button type="button" onClick={() => setSheet('report')} className="text-[var(--shop-muted)]" aria-label="コメントを報告"><Flag className="h-4 w-4" /></button></div>{isAuthenticated ? <form onSubmit={handleCommentSubmit} className="mb-4 flex gap-2"><label htmlFor="comment-input" className="sr-only">コメント</label><input id="comment-input" value={commentInput} onChange={(event) => setCommentInput(event.target.value)} placeholder="コメントを入力" className="min-w-0 flex-1 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[var(--shop-subtle)] focus:border-[var(--shop-blue)]" data-testid="comment-input" /><button type="submit" className="rounded-lg bg-[var(--shop-blue)] px-3 text-white" aria-label="コメントを送信"><Send className="h-4 w-4" /></button></form> : <div className="mb-4 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 text-center"><p className="text-sm text-[var(--shop-muted)]">コメントするにはログインが必要です。</p><button type="button" onClick={() => requestLogin('コメントするにはログインが必要です。')} className="mt-3 rounded-lg border border-[var(--shop-blue)] px-5 py-2 text-sm font-bold text-[var(--shop-blue)]">ログインしてコメント</button></div>}{commentError && <p className="mb-3 text-xs text-red-300" role="alert">{commentError}</p>}<div className="space-y-4">{item.comments.length === 0 ? <p className="py-5 text-center text-xs text-[var(--shop-muted)]">まだコメントはありません。</p> : item.comments.map((comment) => <div key={comment.id} className="flex gap-3"><img src={comment.userAvatar} alt="" className="h-8 w-8 rounded-full object-cover" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-white">{comment.userName}</span><span className="text-[10px] text-[var(--shop-subtle)]">{comment.date}</span></div><p className="mt-1 text-sm leading-6 text-[var(--shop-text)]">{comment.text}</p></div></div>)}</div></section>
          </div>
          <aside className="space-y-4"><section><h2 className="mb-3 text-sm font-bold text-white">おすすめの商品</h2><div className="grid grid-cols-2 gap-2">{relatedItems.map((related) => <button type="button" key={related.id} onClick={() => openItem(related.id)} className="overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] text-left hover:border-[var(--shop-blue)]"><img src={related.images[0]} alt={related.title} className="aspect-square w-full object-cover" loading="lazy" /><div className="p-2"><p className="line-clamp-2 text-[11px] leading-4 text-white">{related.title}</p><p className="mt-1 text-xs font-bold text-white">¥{related.price.toLocaleString()}</p></div></button>)}</div></section><button type="button" onClick={() => setSheet('shipping')} className="flex w-full items-center justify-between rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 text-left text-sm font-bold text-white"><span className="flex items-center gap-2"><Truck className="h-4 w-4 text-[var(--shop-blue)]" />配送について</span><X className="h-4 w-4 rotate-45 text-[var(--shop-muted)]" /></button></aside>
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
  const content = type === 'profile'
    ? { title: `${seller}のプロフィール`, body: '評価・出品履歴・本人確認状況を確認できます。' }
    : type === 'shipping'
      ? { title: '配送について', body: '商品ページに表示されている配送方法と発送までの日数をご確認ください。' }
      : { title: '商品を報告', body: '不適切な商品や説明を見つけた場合の報告フォームです。' };
  return <div className="absolute inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={content.title}><div className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up"><div className="flex items-center justify-between"><h2 className="text-base font-black text-white">{content.title}</h2><button type="button" onClick={onClose} aria-label="詳細を閉じる" className="rounded-full p-1 text-[var(--shop-muted)]"><X className="h-5 w-5" /></button></div><p className="mt-5 rounded-xl bg-[var(--shop-surface-raised)] p-4 text-sm leading-6 text-[var(--shop-muted)]">{content.body}</p><button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-[var(--shop-accent)] py-3 text-sm font-black text-white">閉じる</button></div></div>;
};
