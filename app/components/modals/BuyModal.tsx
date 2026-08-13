'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Gavel, MapPin, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';

export const BuyModal: React.FC = () => {
  const { buyingItem, setBuyingItemId, purchaseItem, placeBid, updateCheckout, marketplaceState } = useMercari();
  const activePaymentMethods = marketplaceState.paymentMethods.filter((method) => method.userId === marketplaceState.currentUserId).map((method) => method.label);
  const activeAddresses = marketplaceState.addresses.filter((address) => address.userId === marketplaceState.currentUserId).map((address) => `〒${address.postalCode} ${address.prefecture}${address.city} ${address.line1}`);
  const [isCompleted, setIsCompleted] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [changeSheet, setChangeSheet] = useState<'payment' | 'address' | null>(null);
  const [paymentMethod, setPaymentMethod] = useState(() => activePaymentMethods[0] ?? 'クレジットカード');
  const [shippingAddress, setShippingAddress] = useState(() => activeAddresses[0] ?? '配送先未設定');

  useEffect(() => {
    if (!buyingItem) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBuyingItemId(null);
        setIsCompleted(false);
        setPurchaseError(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [buyingItem, setBuyingItemId]);

  if (!buyingItem) return null;
  const isAuction = Boolean(buyingItem.isAuction);
  const minimumBid = (buyingItem.currentBid ?? buyingItem.price) + 100;
  const paymentFee = paymentMethod.includes('コンビニ') ? 100 : 0;
  const checkoutTotal = buyingItem.price + paymentFee;

  const handleClose = () => {
    setBuyingItemId(null);
    setIsCompleted(false);
    setPurchaseError(null);
    setBidAmount('');
    setChangeSheet(null);
  };

  const handleConfirm = () => {
    const result = isAuction ? placeBid(buyingItem.id, Number(bidAmount || minimumBid)) : purchaseItem(buyingItem.id);
    if (!result.ok) {
      setPurchaseError(result.message || (result.error === 'ALREADY_SOLD' ? 'この商品はすでに売り切れています。' : '処理に失敗しました。入力内容を確認してください。'));
      return;
    }
    setPurchaseError(null);
    setIsCompleted(true);
  };

  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="buy-modal-title" data-testid="buy-modal">
      <div className="flex max-h-[90%] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--shop-border)] px-5 py-4">
          <h2 id="buy-modal-title" className="text-sm font-extrabold text-white">{isCompleted ? (isAuction ? '入札完了（デモ）' : '購入完了（デモ）') : (isAuction ? '入札内容の確認（デモ）' : '購入内容の確認（デモ）')}</h2>
          <button type="button" onClick={handleClose} aria-label="購入画面を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)] hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {isCompleted ? (
          <div className="space-y-4 overflow-y-auto p-6 text-center animate-fade-in">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"><CheckCircle2 className="h-10 w-10" /></div>
            <div><h3 className="text-lg font-black text-white">{isAuction ? '入札を受け付けました' : '購入手続きが完了しました'}</h3><p className="mt-1 text-xs text-[var(--shop-muted)]">Furima Sandbox内の架空取引です。次はマイページから取引を進められます。</p></div>
            <div className="flex items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-left"><img src={buyingItem.images[0]} alt="" className="h-14 w-14 rounded-lg object-cover" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-white">{buyingItem.title}</div><div className="mt-0.5 text-sm font-black text-white">¥{(isAuction ? (buyingItem.currentBid ?? buyingItem.price) : buyingItem.price).toLocaleString()}</div>{isAuction && <div className="text-[10px] text-[var(--shop-muted)]">入札 {buyingItem.bidsCount ?? 0}件</div>}</div></div>
            <button type="button" onClick={handleClose} className="w-full rounded-xl bg-[var(--shop-accent)] py-3 text-xs font-bold text-white transition-colors hover:bg-[var(--shop-accent-strong)]" data-testid="complete-close-btn">商品詳細に戻る</button>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto p-5">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3"><img src={buyingItem.images[0]} alt="" className="h-14 w-14 rounded-lg object-cover" /><div className="min-w-0 flex-1"><div className="line-clamp-2 text-xs font-bold text-white">{buyingItem.title}</div><div className="mt-1 text-base font-black text-white">¥{(buyingItem.currentBid ?? buyingItem.price).toLocaleString()}</div>{isAuction && <div className="mt-0.5 text-[10px] text-[var(--shop-muted)]">現在の最高入札額 ・ 入札 {buyingItem.bidsCount ?? 0}件</div>}</div></div>
            {isAuction ? (
              <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-4"><div className="flex items-center gap-2 text-xs font-bold text-white"><Gavel className="h-4 w-4 text-[var(--shop-accent)]" />入札額を入力</div><div className="relative mt-3"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[var(--shop-muted)]">¥</span><input id="bid-amount" type="number" min={minimumBid} step="100" value={bidAmount || String(minimumBid)} onChange={(event) => setBidAmount(event.target.value)} className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3 pl-8 pr-3 text-right text-lg font-black text-white outline-none focus:border-[var(--shop-blue)]" /><p className="mt-2 text-[10px] text-[var(--shop-muted)]">最低入札額：¥{minimumBid.toLocaleString()}</p></div></div>
            ) : <><div className="space-y-1.5 text-xs"><div className="flex items-center justify-between font-bold text-[var(--shop-muted)]"><span className="flex items-center gap-1.5"><CreditCard className="h-4 w-4 text-[var(--shop-blue)]" />支払い方法</span><button type="button" onClick={() => setChangeSheet('payment')} className="text-[var(--shop-blue)]">変更</button></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-[var(--shop-text)]">{paymentMethod}</div></div><div className="space-y-1.5 text-xs"><div className="flex items-center justify-between font-bold text-[var(--shop-muted)]"><span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-emerald-400" />配送先</span><button type="button" onClick={() => setChangeSheet('address')} className="text-[var(--shop-blue)]">変更</button></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-[var(--shop-text)]">{shippingAddress}</div></div><div className="flex items-center justify-between border-t border-[var(--shop-border)] pt-3 text-sm font-bold text-white"><span>支払い金額</span><span className="text-xl font-black text-[var(--shop-accent)]">¥{checkoutTotal.toLocaleString()}</span></div></>}
            {purchaseError && <p className="text-xs text-red-300" role="alert">{purchaseError}</p>}
            <button type="button" onClick={handleConfirm} className="w-full rounded-xl bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white shadow-lg transition-colors hover:bg-[var(--shop-accent-strong)]" data-testid="confirm-purchase-btn">{isAuction ? '入札を確定する（デモ）' : '購入を確定する（デモ）'}</button>
            <p className="text-center text-[10px] text-[var(--shop-subtle)]">{isAuction ? '入札後も現在価格が更新され、再入札できます。' : '購入すると取引が開始され、支払い・発送・評価の順に進みます。'}</p>
            {changeSheet && <CheckoutSheet type={changeSheet} current={changeSheet === 'payment' ? paymentMethod : shippingAddress} options={changeSheet === 'payment' ? activePaymentMethods : activeAddresses} onClose={() => setChangeSheet(null)} onSelect={(value) => { if (changeSheet === 'payment') { setPaymentMethod(value); updateCheckout(buyingItem.id, value); } else setShippingAddress(value); setChangeSheet(null); }} />}
          </div>
        )}
      </div>
    </div>
  );
};

const CheckoutSheet: React.FC<{ type: 'payment' | 'address'; current: string; options: string[]; onClose: () => void; onSelect: (value: string) => void }> = ({ type, current, options, onClose, onSelect }) => {
  return <div className="absolute inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={type === 'payment' ? '支払い方法を変更' : '配送先を変更'}><div className="w-full max-w-md rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up"><div className="flex items-center justify-between"><h3 className="font-black text-white">{type === 'payment' ? '支払い方法を変更' : '配送先を変更'}</h3><button type="button" onClick={onClose} aria-label="選択を閉じる" className="rounded-full p-1 text-[var(--shop-muted)]"><X className="h-5 w-5" /></button></div><div className="mt-4 space-y-2">{options.map((option) => <button type="button" key={option} onClick={() => onSelect(option)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left text-xs ${current === option ? 'border-[var(--shop-blue)] bg-[#16394d] text-white' : 'border-[var(--shop-border)] bg-[var(--shop-surface-raised)] text-[var(--shop-muted)]'}`}>{option}{current === option && <span className="text-[var(--shop-blue)]">選択中</span>}</button>)}</div><button type="button" onClick={onClose} className="mt-4 w-full rounded-xl border border-[var(--shop-border)] py-3 text-sm font-bold text-white">キャンセル</button></div></div>;
};
