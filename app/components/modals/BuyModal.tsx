'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, Gavel, MapPin, ShieldCheck, Tag, WalletCards, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const BuyModal: React.FC = () => {
  const { buyingItem, setBuyingItemId, purchaseItem, placeBid } = useMercari();
  const modalRef = useRef<HTMLDivElement>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [changeSheet, setChangeSheet] = useState<'payment' | 'address' | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('クレジットカード（VISA **** 1234）');
  const [shippingAddress, setShippingAddress] = useState('〒150-0001 東京都渋谷区 Furima Sandboxハウス 1-1');
  const [hasAgreed, setHasAgreed] = useState(false);
  const [couponApplied, setCouponApplied] = useState(false);
  const [pointsApplied, setPointsApplied] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setBuyingItemId(null);
    setIsCompleted(false);
    setPurchaseError(null);
    setBidAmount('');
    setChangeSheet(null);
    setHasAgreed(false);
    setCouponApplied(false);
    setPointsApplied(false);
    setOrderId(null);
  }, [setBuyingItemId]);

  useEffect(() => {
    if (!buyingItem) return undefined;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const focusFirstControl = () => modalRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (changeSheet) setChangeSheet(null);
        else handleClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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
      if (previousActiveElement?.isConnected) previousActiveElement.focus();
    };
  }, [buyingItem, changeSheet, handleClose]);

  if (!buyingItem) return null;
  const isAuction = Boolean(buyingItem.isAuction);
  const minimumBid = (buyingItem.currentBid ?? buyingItem.price) + 100;
  const shippingCost = buyingItem.shippingFee.includes('送料込み') ? 0 : 800;
  const couponDiscount = couponApplied ? Math.min(500, buyingItem.price) : 0;
  const pointsDiscount = pointsApplied ? Math.min(200, Math.max(0, buyingItem.price - couponDiscount)) : 0;
  const total = Math.max(0, buyingItem.price + shippingCost - couponDiscount - pointsDiscount);

  const handleConfirm = () => {
    if (!hasAgreed) {
      setPurchaseError('取引条件とデモ規約を確認してから確定してください。');
      return;
    }
    const result = isAuction ? placeBid(buyingItem.id, Number(bidAmount || minimumBid)) : purchaseItem(buyingItem.id);
    if (!result.ok) {
      setPurchaseError(result.message || (result.error === 'ALREADY_SOLD' ? 'この商品はすでに売り切れています。' : '処理に失敗しました。入力内容を確認してください。'));
      return;
    }
    setPurchaseError(null);
    setOrderId(`DEMO-${buyingItem.id.slice(-6).toUpperCase()}`);
    setIsCompleted(true);
  };

  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="buy-modal-title" data-testid="buy-modal">
      <div ref={modalRef} className="relative flex max-h-[92%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--shop-border)] px-5 py-4">
          <div><p className="text-[10px] font-bold tracking-[.08em] text-[var(--shop-blue)]">SANDBOX CHECKOUT</p><h2 id="buy-modal-title" className="mt-0.5 text-sm font-extrabold text-white">{isCompleted ? (isAuction ? '入札完了（デモ）' : '購入完了（デモ）') : (isAuction ? '入札内容の確認（デモ）' : '購入内容の確認（デモ）')}</h2></div>
          <button type="button" onClick={handleClose} aria-label="購入画面を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)] hover:text-white" data-testid="close-buy-modal-btn"><X className="h-5 w-5" /></button>
        </div>

        {isCompleted ? (
          <div className="space-y-4 overflow-y-auto p-6 text-center animate-fade-in">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"><CheckCircle2 className="h-10 w-10" /></div>
            <div><h3 className="text-lg font-black text-white">{isAuction ? '入札を受け付けました' : '購入手続きが完了しました'}</h3><p className="mt-1 text-xs text-[var(--shop-muted)]">これはハッカソン用のシミュレーションです。実際の決済・配送は発生しません。</p></div>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-left"><img src={buyingItem.images[0]} alt="" className="h-14 w-14 rounded-lg object-cover" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-white">{buyingItem.title}</div><div className="mt-0.5 text-sm font-black text-white">¥{(isAuction ? (buyingItem.currentBid ?? buyingItem.price) : total).toLocaleString()}</div>{isAuction && <div className="text-[10px] text-[var(--shop-muted)]">入札 {buyingItem.bidsCount ?? 0}件</div>}</div></div>
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3 text-left text-xs"><div className="flex justify-between text-[var(--shop-muted)]"><span>デモ注文番号</span><span className="font-bold text-white">{orderId}</span></div><div className="mt-2 flex justify-between text-[var(--shop-muted)]"><span>次にできること</span><span className="font-bold text-[var(--shop-blue)]">商品詳細へ戻る</span></div></div>
            <button type="button" onClick={handleClose} className="w-full rounded-xl bg-[var(--shop-accent)] py-3 text-xs font-bold text-white transition-colors hover:bg-[var(--shop-accent-strong)]" data-testid="complete-close-btn">商品詳細に戻る</button>
          </div>
        ) : (
          <div className="shop-scrollbar space-y-4 overflow-y-auto p-5" aria-describedby="buy-modal-description">
            <div id="buy-modal-description" className="rounded-lg border border-[#2b5367] bg-[#153247] px-3 py-2 text-[11px] leading-5 text-[#c5eaff]"><span className="font-bold">確認ポイント：</span>商品・金額・支払い方法・配送先を見てから、下の同意チェックを入れて確定します。</div>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3"><img src={buyingItem.images[0]} alt="" className="h-16 w-16 rounded-lg object-cover" /><div className="min-w-0 flex-1"><div className="line-clamp-2 text-xs font-bold text-white">{buyingItem.title}</div><div className="mt-1 text-base font-black text-white">¥{(buyingItem.currentBid ?? buyingItem.price).toLocaleString()}</div>{isAuction && <div className="mt-0.5 text-[10px] text-[var(--shop-muted)]">現在の最高入札額 ・ 入札 {buyingItem.bidsCount ?? 0}件</div>}</div></div>

            {isAuction ? (
              <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-4"><div className="flex items-center gap-2 text-xs font-bold text-white"><Gavel className="h-4 w-4 text-[var(--shop-accent)]" />入札額を入力</div><div className="relative mt-3"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[var(--shop-muted)]">¥</span><input id="bid-amount" type="number" min={minimumBid} step="100" value={bidAmount || String(minimumBid)} onChange={(event) => setBidAmount(event.target.value)} className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3 pl-8 pr-3 text-right text-lg font-black text-white outline-none focus:border-[var(--shop-blue)]" /><p className="mt-2 text-[10px] text-[var(--shop-muted)]">最低入札額：¥{minimumBid.toLocaleString()} ・ 入札後も再入札できます</p></div></div>
            ) : (
              <>
                <div className="space-y-1.5 text-xs"><div className="flex items-center justify-between font-bold text-[var(--shop-muted)]"><span className="flex items-center gap-1.5"><CreditCard className="h-4 w-4 text-[var(--shop-blue)]" />支払い方法</span><button type="button" onClick={() => setChangeSheet('payment')} className="text-[var(--shop-blue)] hover:text-white">変更</button></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-[var(--shop-text)]">{paymentMethod}</div></div>
                <div className="space-y-1.5 text-xs"><div className="flex items-center justify-between font-bold text-[var(--shop-muted)]"><span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-emerald-400" />配送先</span><button type="button" onClick={() => setChangeSheet('address')} className="text-[var(--shop-blue)] hover:text-white">変更</button></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-[var(--shop-text)]">{shippingAddress}</div></div>
                <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-4"><div className="mb-3 flex items-center gap-2 text-xs font-bold text-white"><WalletCards className="h-4 w-4 text-[var(--shop-blue)]" />支払い金額の内訳</div><div className="space-y-2 text-xs"><CostRow label="商品価格" value={`¥${buyingItem.price.toLocaleString()}`} /><CostRow label="送料" value={shippingCost ? `¥${shippingCost.toLocaleString()}` : '出品者負担'} /><CostRow label="購入者手数料" value="¥0（デモ）" />{couponApplied && <CostRow label="Sandboxクーポン" value={`-¥${couponDiscount.toLocaleString()}`} accent />}{pointsApplied && <CostRow label="保有ポイント" value={`-¥${pointsDiscount.toLocaleString()}`} accent />}<div className="flex justify-between border-t border-[var(--shop-border)] pt-2 text-sm font-black text-white"><span>支払い予定額</span><span className="text-lg text-[var(--shop-accent)]">¥{total.toLocaleString()}</span></div></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setCouponApplied((value) => !value)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${couponApplied ? 'border-[var(--shop-accent)] bg-[#4d1e26] text-[var(--shop-accent)]' : 'border-[var(--shop-border)] text-[var(--shop-muted)] hover:text-white'}`}><Tag className="h-3 w-3" />{couponApplied ? 'クーポン適用中' : 'クーポンを試す'}</button><button type="button" onClick={() => setPointsApplied((value) => !value)} className={`rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${pointsApplied ? 'border-emerald-400 bg-[#163d30] text-emerald-300' : 'border-[var(--shop-border)] text-[var(--shop-muted)] hover:text-white'}`}>{pointsApplied ? 'ポイント適用中' : 'ポイントを試す'}</button></div></div>
              </>
            )}

            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3"><div className="flex items-start gap-2.5 text-xs text-[var(--shop-text)]"><input id="purchase-policy" aria-label="取引条件・デモ規約を確認しました" type="checkbox" checked={hasAgreed} onChange={(event) => { setHasAgreed(event.target.checked); setPurchaseError(null); }} className="mt-0.5 h-4 w-4 accent-[var(--shop-accent)]" /> <span><span className="font-bold text-white">取引条件・デモ規約を確認しました</span><span className="mt-1 block leading-5 text-[var(--shop-muted)]">確定すると、通常商品はSOLD、オークションは入札履歴に反映されます。実サービスの決済・返金は行われません。</span></span></div><div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--shop-muted)]"><ShieldCheck className="h-4 w-4 text-[var(--shop-blue)]" />返品・補償ポリシーはデモ用に表示しています</div></div>
            {purchaseError && <p className="text-xs text-red-300" role="alert">{purchaseError}</p>}
            <button type="button" onClick={handleConfirm} disabled={!hasAgreed} className="w-full rounded-xl bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white shadow-lg transition-colors hover:bg-[var(--shop-accent-strong)] disabled:cursor-not-allowed disabled:bg-[#55555a]" data-testid="confirm-purchase-btn">{isAuction ? '入札を確定する（デモ）' : '購入を確定する（デモ）'}</button>
            <p className="text-center text-[10px] text-[var(--shop-subtle)]">{isAuction ? '現在価格と入札件数が即時に更新されます。' : '購入後は商品カードとAPIスナップショットがSOLDに更新されます。'}</p>
            {changeSheet && <CheckoutSheet type={changeSheet} current={changeSheet === 'payment' ? paymentMethod : shippingAddress} onClose={() => setChangeSheet(null)} onSelect={(value) => { if (changeSheet === 'payment') setPaymentMethod(value); else setShippingAddress(value); setChangeSheet(null); }} />}
          </div>
        )}
      </div>
    </div>
  );
};

const CostRow: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent = false }) => <div className="flex justify-between text-[var(--shop-muted)]"><span>{label}</span><span className={accent ? 'font-bold text-emerald-300' : 'text-white'}>{value}</span></div>;

const CheckoutSheet: React.FC<{ type: 'payment' | 'address'; current: string; onClose: () => void; onSelect: (value: string) => void }> = ({ type, current, onClose, onSelect }) => {
  const options = type === 'payment'
    ? ['クレジットカード（VISA **** 1234）', 'メルペイ残高（¥6,200）', 'コンビニ払い（手数料なし）']
    : ['〒150-0001 東京都渋谷区 shopハウス 1-1', '〒150-0042 東京都渋谷区宇田川町 shopロッカー', '配送先を追加する（デモ）'];
  return <div className="absolute inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={type === 'payment' ? '支払い方法を変更' : '配送先を変更'}><div className="w-full max-w-md rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up"><div className="flex items-center justify-between"><h3 className="font-black text-white">{type === 'payment' ? '支払い方法を変更' : '配送先を変更'}</h3><button type="button" onClick={onClose} aria-label="選択を閉じる" className="rounded-full p-1 text-[var(--shop-muted)]"><X className="h-5 w-5" /></button></div><div className="mt-4 space-y-2">{options.map((option) => <button type="button" key={option} onClick={() => onSelect(option)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-xs ${current === option ? 'border-[var(--shop-blue)] bg-[#16394d] text-white' : 'border-[var(--shop-border)] bg-[var(--shop-surface-raised)] text-[var(--shop-muted)]'}`}>{option}{current === option && <span className="text-[var(--shop-blue)]">選択中</span>}</button>)}</div><button type="button" onClick={onClose} className="mt-4 w-full rounded-xl border border-[var(--shop-border)] py-3 text-sm font-bold text-white">キャンセル</button></div></div>;
};
