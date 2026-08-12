'use client';

import React, { useState } from 'react';
import { useMercari } from '../../context/MercariContext';
import { Camera, FileText, Lightbulb, Truck, Package, ChevronRight, X, Image as ImageIcon, Sparkles, PlusCircle } from 'lucide-react';
import { Footer } from '../Footer';

export const ListingView: React.FC = () => {
  const { isListingModalOpen, setIsListingModalOpen, addNewItem } = useMercari();

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [isAutoInputOn, setIsAutoInputOn] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !price) return;

    addNewItem({
      title: title.trim(),
      price: parseInt(price, 10) || 1000,
      description: description || '新しく出品された商品です。',
      category: category ? [category] : ['本・雑誌・漫画'],
      condition: condition || '目立った傷や汚れなし',
      images: ['/images/01J7N72MFF8A03BNXT7TBDFNWT.png'],
    });

    // Reset
    setTitle('');
    setPrice('');
    setDescription('');
  };

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar bg-[#121212] flex flex-col justify-between" data-testid="listing-view">
      <div>
        {/* Title */}
        <div className="bg-[#1e1e1e] border-b border-[#2c2c2e] px-4 py-3 text-center">
          <h1 className="font-extrabold text-base text-white">出品</h1>
        </div>

        <div className="p-4 space-y-4">
          {/* Yellow Banner */}
          <div className="bg-gradient-to-r from-amber-300 to-yellow-400 text-slate-900 p-4 rounded-xl shadow-md font-extrabold flex items-center justify-between">
            <div>
              <div className="text-xs bg-white/70 px-2 py-0.5 rounded-full inline-block mb-1">
                \ あなたの不要品が誰かの宝物に /
              </div>
              <div className="text-lg font-black tracking-tight">かんたん出品 はじめかたガイド</div>
            </div>
            <div className="text-2xl">📦</div>
          </div>

          {/* Primary Buttons */}
          <div className="space-y-3 pt-2">
            <button
              onClick={() => setIsListingModalOpen(true)}
              className="w-full bg-[#ff0211] hover:bg-[#e5020f] active:scale-[0.99] text-white font-bold py-3.5 rounded-xl shadow-md flex items-center justify-center gap-2 transition-all"
              data-testid="start-listing-btn"
            >
              <Camera className="w-5 h-5" />
              <span>出品する</span>
            </button>

            <button className="w-full bg-[#1e1e1e] hover:bg-[#252528] border border-[#ff0211] text-[#ff0211] font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors">
              <FileText className="w-5 h-5" />
              <span>下書き一覧</span>
            </button>
          </div>

          {/* Listing Hints Section */}
          <div className="pt-4 space-y-2 pb-6">
            <h2 className="font-bold text-sm text-gray-300">出品に関するヒント</h2>

            <div className="bg-[#1e1e1e] rounded-xl border border-[#2c2c2e] divide-y divide-[#2c2c2e]">
              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-yellow-500/20 text-yellow-400 rounded-lg flex items-center justify-center">
                    <Lightbulb className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-200">売れるためのコツを見る</div>
                    <div className="text-[11px] text-gray-400">売れるための出品のコツを確認できます</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-emerald-500/20 text-emerald-400 rounded-lg flex items-center justify-center">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-200">配送方法早わかり表を見る</div>
                    <div className="text-[11px] text-gray-400">メルカリで利用できる主な配送方法を確認できます</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-amber-600/20 text-amber-500 rounded-lg flex items-center justify-center">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-200">梱包の方法を見る</div>
                    <div className="text-[11px] text-gray-400">本や衣類など、梱包方法を確認できます</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>
            </div>
          </div>
        </div>

        <Footer />
      </div>

      {/* Full-height Seamless Listing Form Modal (1-to-1 matching iPhone 12 Pro (4).png) */}
      {isListingModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#121212] flex flex-col animate-slide-up overflow-hidden">
          {/* Header */}
          <div className="bg-[#1e1e1e] border-b border-[#2c2c2e] p-3 flex items-center justify-between sticky top-0 z-30">
            <button
              onClick={() => setIsListingModalOpen(false)}
              className="text-gray-300 hover:text-white p-1"
              data-testid="close-listing-modal-btn"
            >
              <X className="w-6 h-6" />
            </button>
            <h2 className="font-extrabold text-base text-white">商品の出品</h2>
            <div className="w-6"></div>
          </div>

          {/* Form Scroll Container */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-6 pb-20">
            {/* Image Upload Section */}
            <div>
              <label className="block text-sm font-bold text-gray-200 mb-1">
                出品画像 <span className="text-xs font-normal text-gray-400">(最大20枚)</span>
              </label>
              <div className="flex items-center gap-3 pt-2">
                <div className="w-24 h-24 bg-[#2a2a2d] border border-dashed border-gray-600 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:border-[#ff0211] transition-colors">
                  <ImageIcon className="w-7 h-7 mb-1 text-gray-400" />
                  <span className="text-xs font-bold">画像追加</span>
                </div>
              </div>
            </div>

            {/* Auto Input Toggle */}
            <div className="flex items-center justify-between py-2 border-y border-[#2c2c2e]">
              <div>
                <div className="text-sm font-bold text-gray-200">商品名と説明文を自動入力</div>
                <div className="text-xs text-gray-400">出品画面で編集もできます</div>
              </div>
              <button
                type="button"
                onClick={() => setIsAutoInputOn(!isAutoInputOn)}
                className={`w-12 h-7 flex items-center rounded-full p-1 transition-colors ${
                  isAutoInputOn ? 'bg-sky-500 justify-end' : 'bg-gray-700 justify-start'
                }`}
              >
                <div className="w-5 h-5 bg-white rounded-full shadow-md"></div>
              </button>
            </div>

            {/* AI Assistant Banner */}
            {isAutoInputOn && (
              <div className="bg-sky-900/40 border border-sky-600/50 p-3.5 rounded-xl flex items-start justify-between text-sky-200 text-xs">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-sm text-sky-300 mb-0.5">AI出品サポートがONです</div>
                    <p className="text-sky-200/90 leading-snug">
                      写真を追加すると、商品名やカテゴリー等の情報を自動的に提案・補完します。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAutoInputOn(false)}
                  className="text-sky-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Title Input */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm font-bold text-gray-200">
                <span>商品名</span>
                <span className="text-xs text-gray-500 font-normal">{title.length} / 40</span>
              </div>
              <input
                type="text"
                maxLength={40}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="商品名を入力してください"
                className="w-full bg-[#2a2a2d] border border-[#3a3a3c] rounded-xl p-3.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                required
                data-testid="listing-title-input"
              />
            </div>

            {/* Category Select */}
            <div className="space-y-1">
              <label className="block text-sm font-bold text-gray-200">カテゴリー</label>
              <div className="relative">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-[#2a2a2d] border border-[#3a3a3c] rounded-xl p-3.5 text-sm text-white focus:outline-none focus:border-red-500 appearance-none"
                >
                  <option value="">+ カテゴリーを選択する</option>
                  <option value="本・雑誌・漫画">本・雑誌・漫画</option>
                  <option value="レディース">レディース</option>
                  <option value="メンズ">メンズ</option>
                  <option value="家電・スマホ・カメラ">家電・スマホ・カメラ</option>
                  <option value="ゲーム・おもちゃ・グッズ">ゲーム・おもちゃ・グッズ</option>
                </select>
                <PlusCircle className="w-4 h-4 text-blue-400 absolute right-3.5 top-4 pointer-events-none" />
              </div>
            </div>

            {/* Condition Select */}
            <div className="space-y-1">
              <label className="block text-sm font-bold text-gray-200">商品の状態</label>
              <div className="relative">
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full bg-[#2a2a2d] border border-[#3a3a3c] rounded-xl p-3.5 text-sm text-white focus:outline-none focus:border-red-500 appearance-none"
                >
                  <option value="">+ 商品の状態を選択する</option>
                  <option value="新品、未使用">新品、未使用</option>
                  <option value="未使用に近い">未使用に近い</option>
                  <option value="目立った傷や汚れなし">目立った傷や汚れなし</option>
                  <option value="やや傷や汚れあり">やや傷や汚れあり</option>
                  <option value="傷や汚れあり">傷や汚れあり</option>
                </select>
                <PlusCircle className="w-4 h-4 text-blue-400 absolute right-3.5 top-4 pointer-events-none" />
              </div>
            </div>

            {/* Description Textarea */}
            <div className="space-y-1">
              <div className="flex justify-between text-sm font-bold text-gray-200">
                <span>商品の説明</span>
                <span className="text-xs text-gray-500 font-normal">任意</span>
              </div>
              <textarea
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="色、素材、重さ、定価、注意点など&#10;&#10;例) 2010年頃に1万円で購入したジャケット"
                className="w-full bg-[#2a2a2d] border border-[#3a3a3c] rounded-xl p-3.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500 leading-relaxed"
                data-testid="listing-description-input"
              />
            </div>

            {/* Price Input */}
            <div className="space-y-1">
              <label className="block text-sm font-bold text-gray-200">販売価格 (¥300〜)</label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-gray-400 font-bold text-base">¥</span>
                <input
                  type="number"
                  min={300}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="300"
                  className="w-full bg-[#2a2a2d] border border-[#3a3a3c] rounded-xl pl-9 pr-3.5 py-3.5 text-base text-white placeholder-gray-500 focus:outline-none focus:border-red-500 font-bold"
                  required
                  data-testid="listing-price-input"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                className="w-full bg-[#ff0211] hover:bg-[#e5020f] active:scale-[0.99] text-white font-black text-base py-4 rounded-xl shadow-lg transition-all text-center"
                data-testid="submit-listing-btn"
              >
                出品する
              </button>
            </div>

            <Footer />
          </form>
        </div>
      )}
    </div>
  );
};
