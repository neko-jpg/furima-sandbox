'use client';

import React, { useState } from 'react';
import { useMercari } from '../../context/MercariContext';
import { X, CheckCircle2, ShieldCheck, CreditCard, MapPin } from 'lucide-react';

export const BuyModal: React.FC = () => {
  const { buyingItem, setBuyingItem, toggleLikeItem } = useMercari();
  const [isCompleted, setIsCompleted] = useState(false);

  if (!buyingItem) return null;

  const handleConfirmPurchase = () => {
    setIsCompleted(true);
    buyingItem.isSold = true;
  };

  const handleClose = () => {
    setBuyingItem(null);
    setIsCompleted(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
      data-testid="buy-modal"
    >
      <div className="bg-[#1e1e1e] border border-[#2c2c2e] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-[#1e1e1e] border-b border-[#2c2c2e] p-4 flex items-center justify-between">
          <h2 className="font-extrabold text-sm text-white">
            {isCompleted ? '購入完了デモ' : '購入内容の確認 (デモ用)'}
          </h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isCompleted ? (
          /* Purchase Completed State */
          <div className="p-6 text-center space-y-4 animate-fade-in">
            <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div>
              <h3 className="text-lg font-black text-white">購入手続きが完了しました！</h3>
              <p className="text-xs text-gray-400 mt-1">
                (※これはハッカソンデモ用のシミュレーション画面です)
              </p>
            </div>

            <div className="bg-[#2a2a2d] p-3 rounded-xl text-left flex items-center gap-3 border border-[#3a3a3c]">
              <img
                src={buyingItem.images[0]}
                alt=""
                className="w-14 h-14 object-cover rounded-lg"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-white truncate">{buyingItem.title}</div>
                <div className="text-sm font-black text-white mt-0.5">
                  ¥{buyingItem.price.toLocaleString()}
                </div>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-full bg-[#ff0211] hover:bg-[#e5020f] text-white font-bold py-3 rounded-xl text-xs transition-colors"
              data-testid="complete-close-btn"
            >
              商品詳細に戻る
            </button>
          </div>
        ) : (
          /* Confirmation Form State */
          <div className="p-5 space-y-4">
            {/* Item Info Summary */}
            <div className="flex items-center gap-3 bg-[#2a2a2d] p-3 rounded-xl border border-[#3a3a3c]">
              <img
                src={buyingItem.images[0]}
                alt=""
                className="w-14 h-14 object-cover rounded-lg"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-gray-200 line-clamp-1">
                  {buyingItem.title}
                </div>
                <div className="text-base font-black text-white mt-1">
                  ¥{buyingItem.price.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-gray-400 font-bold">
                <span className="flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-blue-400" /> 支払い方法
                </span>
                <span className="text-blue-400 cursor-pointer">変更</span>
              </div>
              <div className="bg-[#2a2a2d] p-3 rounded-xl text-gray-200 border border-[#3a3a3c]">
                クレジットカード (VISA **** 1234)
              </div>
            </div>

            {/* Shipping Address */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-gray-400 font-bold">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-400" /> 配送先住所
                </span>
                <span className="text-blue-400 cursor-pointer">変更</span>
              </div>
              <div className="bg-[#2a2a2d] p-3 rounded-xl text-gray-200 border border-[#3a3a3c]">
                〒100-0001 東京都千代田区千代田1-1 Natsuki宛
              </div>
            </div>

            {/* Total Price */}
            <div className="flex items-center justify-between pt-2 border-t border-[#2c2c2e] text-sm font-bold text-white">
              <span>支払金額</span>
              <span className="text-xl font-black text-[#ff0211]">
                ¥{buyingItem.price.toLocaleString()}
              </span>
            </div>

            {/* Confirm Purchase Button */}
            <button
              onClick={handleConfirmPurchase}
              className="w-full bg-[#ff0211] hover:bg-[#e5020f] text-white font-black text-sm py-3.5 rounded-xl shadow-lg transition-all"
              data-testid="confirm-purchase-btn"
            >
              購入する (デモ実行)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
