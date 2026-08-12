'use client';

import React, { useState } from 'react';
import { useMercari } from '../../context/MercariContext';
import { MercariItem } from '../../types/mercari';
import {
  ChevronLeft,
  Share2,
  Heart,
  MessageCircle,
  Copy,
  Bookmark,
  Flag,
  ShieldCheck,
  ChevronRight,
  Star,
  CheckCircle2,
  Send,
} from 'lucide-react';
import { Footer } from '../Footer';

interface ItemDetailViewProps {
  item: MercariItem;
  onClose: () => void;
}

export const ItemDetailView: React.FC<ItemDetailViewProps> = ({
  item,
  onClose,
}) => {
  const { toggleLikeItem, addComment, setBuyingItem, items, setSelectedItem } =
    useMercari();
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [commentInput, setCommentInput] = useState('');

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (commentInput.trim()) {
      addComment(item.id, commentInput);
      setCommentInput('');
    }
  };

  const isLiked = item.isLiked;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#121212] flex flex-col overflow-y-auto no-scrollbar animate-fade-in"
      data-testid="item-detail-view"
    >
      {/* Top Fixed Navigation Bar */}
      <div className="sticky top-0 z-20 bg-[#1e1e1e]/90 backdrop-blur-md border-b border-[#2c2c2e] px-3 py-2.5 flex items-center justify-between">
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-[#2c2c2e] rounded-full transition-colors text-white"
          data-testid="back-button"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-3 text-white">
          <button className="p-1.5 hover:bg-[#2c2c2e] rounded-full transition-colors">
            <Share2 className="w-5 h-5" />
          </button>
          <button
            onClick={() => toggleLikeItem(item.id)}
            className={`p-1.5 hover:bg-[#2c2c2e] rounded-full transition-colors ${
              isLiked ? 'text-[#ff0211]' : 'text-white'
            }`}
            data-testid="detail-like-btn"
          >
            <Heart className={`w-5 h-5 ${isLiked ? 'fill-[#ff0211]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Scroll Body */}
      <div className="flex-1 space-y-4 pb-24">
        {/* Product Photo Gallery */}
        <div className="relative aspect-square bg-black w-full max-w-md mx-auto">
          <img
            src={item.images[activeImageIdx] || item.images[0]}
            alt={item.title}
            className="w-full h-full object-contain"
          />

          {item.isSold && (
            <div className="absolute top-4 left-4 bg-[#ff0211] text-white text-sm font-black px-3 py-1 tracking-wider shadow-lg transform -rotate-12">
              SOLD
            </div>
          )}

          {item.images.length > 1 && (
            <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-xs text-white text-xs px-2.5 py-1 rounded-full font-medium">
              {activeImageIdx + 1} / {item.images.length}
            </div>
          )}
        </div>

        {/* Image Thumbnails */}
        {item.images.length > 1 && (
          <div className="flex items-center gap-2 px-4 overflow-x-auto no-scrollbar">
            {item.images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => setActiveImageIdx(idx)}
                className={`relative w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                  activeImageIdx === idx ? 'border-[#ff0211]' : 'border-transparent opacity-60'
                }`}
              >
                <img src={img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Title & Price */}
        <div className="px-4 space-y-2">
          <h1 className="text-base sm:text-lg font-bold text-white leading-snug">{item.title}</h1>

          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">
              ¥{item.price.toLocaleString()}
            </span>
            <span className="text-xs text-gray-400 font-medium">(税込) 送料込み</span>
          </div>
        </div>

        {/* Shipping Method Information Box */}
        <div className="mx-4 p-3 bg-[#1e1e1e] rounded-xl border border-[#2c2c2e] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-emerald-500/20 text-emerald-400 rounded-md flex items-center justify-center font-bold">
              📦
            </div>
            <div>
              <span className="bg-emerald-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold mr-1.5">
                {item.shippingMethod.split(' ')[0]}
              </span>
              <span className="text-gray-300">
                この商品はネコポス(送料 ¥210)で配送されました
              </span>
            </div>
          </div>
        </div>

        {/* Interaction Action Buttons */}
        <div className="px-4 grid grid-cols-5 gap-2 text-center text-[11px] text-gray-300 py-2 border-y border-[#2c2c2e]">
          <button
            onClick={() => toggleLikeItem(item.id)}
            className={`flex flex-col items-center justify-center p-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors ${
              isLiked ? 'text-[#ff0211]' : ''
            }`}
          >
            <Heart className={`w-5 h-5 mb-0.5 ${isLiked ? 'fill-[#ff0211]' : ''}`} />
            <span>{item.likesCount}</span>
          </button>

          <button className="flex flex-col items-center justify-center p-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors">
            <MessageCircle className="w-5 h-5 mb-0.5 text-gray-300" />
            <span>{item.comments.length}</span>
          </button>

          <button className="flex flex-col items-center justify-center p-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors">
            <Copy className="w-5 h-5 mb-0.5 text-gray-300" />
            <span>コピー出品</span>
          </button>

          <button className="flex flex-col items-center justify-center p-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors">
            <Bookmark className="w-5 h-5 mb-0.5 text-gray-300" />
            <span>保存</span>
          </button>

          <button className="flex flex-col items-center justify-center p-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors">
            <Flag className="w-5 h-5 mb-0.5 text-gray-300" />
            <span>通報</span>
          </button>
        </div>

        {/* Inline Buy/Transaction Button */}
        <div className="px-4 py-2">
          {item.isSold ? (
            <button
              disabled
              className="w-full bg-[#1e1e1e] border border-[#ff0211]/50 text-[#ff0211] font-bold py-3.5 rounded-xl text-center text-sm"
              data-testid="sold-out-button"
            >
              取引画面を表示する
            </button>
          ) : (
            <button
              onClick={() => setBuyingItem(item)}
              className="w-full bg-[#ff0211] hover:bg-[#e5020f] active:scale-[0.99] text-white font-black text-base py-3.5 rounded-xl shadow-lg transition-all text-center"
              data-testid="buy-button"
            >
              購入手続きへ
            </button>
          )}
        </div>

        {/* Description Section */}
        <div className="px-4 pt-4 border-t border-[#2c2c2e] space-y-2">
          <h2 className="font-bold text-sm text-gray-200">商品の説明</h2>
          <p className="text-xs sm:text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
            {item.description}
          </p>
          <div className="text-xs text-gray-500 pt-1">🕒 半年以上前</div>
        </div>

        {/* Item Info Table */}
        <div className="px-4 pt-4 border-t border-[#2c2c2e] space-y-3">
          <h2 className="font-bold text-sm text-gray-200">商品の情報</h2>
          <div className="bg-[#1e1e1e] rounded-xl overflow-hidden border border-[#2c2c2e] text-xs">
            <div className="flex border-b border-[#2c2c2e] p-3">
              <span className="w-28 text-gray-400">カテゴリー</span>
              <div className="flex-1 text-blue-400 space-y-0.5">
                {item.category.map((cat, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span>{cat}</span>
                    {i < item.category.length - 1 && <ChevronRight className="w-3 h-3 text-gray-600" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex border-b border-[#2c2c2e] p-3">
              <span className="w-28 text-gray-400">商品の状態</span>
              <span className="flex-1 text-gray-200">{item.condition}</span>
            </div>

            <div className="flex border-b border-[#2c2c2e] p-3">
              <span className="w-28 text-gray-400">配送料の負担</span>
              <span className="flex-1 text-gray-200">{item.shippingFee}</span>
            </div>

            <div className="flex border-b border-[#2c2c2e] p-3">
              <span className="w-28 text-gray-400">配送の方法</span>
              <span className="flex-1 text-gray-200 flex items-center gap-1.5">
                {item.shippingMethod}
                <span className="bg-[#2c2c2e] text-[10px] text-gray-300 px-1.5 py-0.5 rounded">
                  匿名配送
                </span>
              </span>
            </div>

            <div className="flex border-b border-[#2c2c2e] p-3">
              <span className="w-28 text-gray-400">発送元の地域</span>
              <span className="flex-1 text-gray-200">{item.origin}</span>
            </div>

            <div className="flex p-3">
              <span className="w-28 text-gray-400">発送までの日数</span>
              <span className="flex-1 text-gray-200">{item.shippingDays}</span>
            </div>
          </div>
        </div>

        {/* Safety Notice Cards (1-to-1 matching) */}
        <div className="px-4 space-y-2">
          <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl flex items-center justify-between text-xs text-blue-300">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>商品の状態を確認してください</span>
            </div>
            <ChevronRight className="w-4 h-4 text-blue-400" />
          </div>

          <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl flex items-center justify-between text-xs text-blue-300">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>メルカリ安心への取り組み</span>
            </div>
            <ChevronRight className="w-4 h-4 text-blue-400" />
          </div>
        </div>

        {/* Seller Profile */}
        <div className="px-4 pt-4 border-t border-[#2c2c2e] space-y-3">
          <h2 className="font-bold text-sm text-gray-200">出品者</h2>
          <div className="bg-[#1e1e1e] p-3.5 rounded-xl border border-[#2c2c2e] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src={item.seller.avatar}
                alt={item.seller.name}
                className="w-12 h-12 rounded-full object-cover border border-[#2c2c2e]"
              />
              <div>
                <div className="font-bold text-sm text-white">{item.seller.name}</div>
                <div className="flex items-center gap-1.5 text-xs text-yellow-400 mt-0.5">
                  <div className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <span className="text-white font-bold">{item.seller.ratingsCount}</span>
                </div>
                {item.seller.isVerified && (
                  <div className="flex items-center gap-1 text-[11px] text-emerald-400 mt-0.5">
                    <CheckCircle2 className="w-3 h-3" /> 本人確認済
                  </div>
                )}
                {item.seller.level && (
                  <div className="text-[10px] text-blue-400 mt-0.5 font-bold">
                    出品者レベル {item.seller.level}
                  </div>
                )}
              </div>
            </div>

            <ChevronRight className="w-5 h-5 text-gray-500" />
          </div>
        </div>

        {/* Comments */}
        <div className="px-4 pt-4 border-t border-[#2c2c2e] space-y-3">
          <h2 className="font-bold text-sm text-gray-200">
            コメント ({item.comments.length})
          </h2>

          <div className="space-y-3">
            {item.comments.map((c) => (
              <div key={c.id} className="bg-[#1e1e1e] p-3 rounded-xl border border-[#2c2c2e] space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <img
                      src={c.userAvatar}
                      alt=""
                      className="w-6 h-6 rounded-full object-cover"
                    />
                    <span className="font-bold text-gray-200">{c.userName}</span>
                  </div>
                  <span className="text-gray-500 text-[10px]">{c.date}</span>
                </div>
                <p className="text-xs text-gray-300 pl-8 leading-relaxed">{c.text}</p>
              </div>
            ))}
          </div>

          <div className="text-xs text-gray-500 italic text-center py-1">
            ※売り切れのためコメントできません
          </div>

          {/* Comment Form */}
          {!item.isSold && (
            <form onSubmit={handleCommentSubmit} className="flex gap-2 pt-2">
              <input
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="質問やコメントを入力..."
                className="flex-1 bg-[#2a2a2d] border border-[#3a3a3c] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                data-testid="comment-input"
              />
              <button
                type="submit"
                className="bg-[#ff0211] hover:bg-[#e5020f] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1"
                data-testid="comment-submit-btn"
              >
                <Send className="w-3.5 h-3.5" /> 送信
              </button>
            </form>
          )}
        </div>

        {/* Similar / Recommended Items Grid */}
        <div className="px-4 pt-4 border-t border-[#2c2c2e] space-y-3">
          <h2 className="font-bold text-sm text-gray-200">この商品に近い商品</h2>
          <div className="grid grid-cols-3 gap-2">
            {items
              .filter((i) => i.id !== item.id)
              .slice(0, 6)
              .map((rec) => (
                <div
                  key={rec.id}
                  onClick={() => setSelectedItem(rec)}
                  className="bg-[#1e1e1e] rounded-lg overflow-hidden border border-[#2c2c2e] cursor-pointer"
                >
                  <img
                    src={rec.images[0]}
                    alt=""
                    className="aspect-square w-full object-cover"
                  />
                  <div className="p-1.5">
                    <div className="text-xs font-bold text-white">
                      ¥{rec.price.toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <Footer />
      </div>

      {/* Bottom Sticky Action Bar (Matching images.png) */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-[#1e1e1e]/95 backdrop-blur-md border-t border-[#2c2c2e] p-3 flex items-center gap-3">
        <button
          onClick={() => setBuyingItem(item)}
          className="flex-1 bg-white hover:bg-gray-100 text-slate-900 font-bold py-3 rounded-xl text-xs text-center transition-colors"
        >
          あと払いする
        </button>

        <button
          onClick={() => setBuyingItem(item)}
          className="flex-1 bg-[#ff0211] hover:bg-[#e5020f] active:scale-[0.99] text-white font-black py-3 rounded-xl text-xs text-center shadow-md transition-all"
          data-testid="bottom-buy-btn"
        >
          購入手続きへ
        </button>
      </div>
    </div>
  );
};
