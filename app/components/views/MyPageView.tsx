'use client';

import React from 'react';
import { useMercari } from '../../context/MercariContext';
import {
  ChevronRight,
  ShieldCheck,
  Heart,
  History,
  Users,
  PackageCheck,
  ShoppingBag,
  FileText,
  CreditCard,
  Settings,
  HelpCircle,
} from 'lucide-react';
import { Footer } from '../Footer';

export const MyPageView: React.FC = () => {
  const { user, items, setMainTab, setHomeTab } = useMercari();

  const likedCount = items.filter((i) => i.isLiked).length;

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar bg-[#121212] flex flex-col justify-between" data-testid="mypage-view">
      <div>
        {/* Title Bar */}
        <div className="bg-[#1e1e1e] border-b border-[#2c2c2e] px-4 py-3 text-center">
          <h1 className="font-extrabold text-base text-white">マイページ</h1>
        </div>

        {/* User Header Profile */}
        <div className="p-4 space-y-4 pb-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={user.avatar}
                alt={user.name}
                className="w-14 h-14 rounded-full object-cover border-2 border-[#2c2c2e]"
              />
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-1 font-bold text-base text-white">
                <span>{user.name}</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>

              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="text-yellow-400 font-bold flex items-center gap-0.5">
                  ★ {user.rating} ({user.ratingsCount})
                </span>

                <button className="flex items-center gap-1 text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded-full text-[11px] font-bold">
                  <ShieldCheck className="w-3 h-3" />
                  本人確認する
                </button>
              </div>
            </div>
          </div>

          {/* Balance Card */}
          <div className="bg-[#1e1e1e] p-4 rounded-xl border border-[#2c2c2e] space-y-3">
            <div className="flex items-center justify-between border-b border-[#2c2c2e] pb-3">
              <div>
                <span className="text-xs text-gray-400 font-medium">売上金</span>
                <div className="text-lg font-black text-white">
                  ¥{user.salesBalance.toLocaleString()}
                </div>
              </div>
              <button className="text-xs text-blue-400 font-bold hover:underline">振込申請</button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-400 font-medium">ポイント</span>
                <div className="text-sm font-bold text-white flex items-center gap-1">
                  <span className="w-4 h-4 bg-[#ff0211] text-white rounded-full flex items-center justify-center text-[9px] font-black">
                    P
                  </span>
                  <span>P {user.points}</span>
                </div>
              </div>

              <button className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                dポイント連携
              </button>
            </div>
          </div>

          {/* Product Management Section */}
          <div className="space-y-2 pt-2">
            <h2 className="font-bold text-sm text-gray-300">商品管理</h2>

            <div className="bg-[#1e1e1e] rounded-xl border border-[#2c2c2e] divide-y divide-[#2c2c2e] text-xs font-medium">
              <div
                onClick={() => {
                  setMainTab('home');
                  setHomeTab('mylist');
                }}
                className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Heart className="w-4 h-4 text-[#ff0211]" />
                  <span className="text-gray-200">いいね！一覧</span>
                </div>
                <div className="flex items-center gap-1 text-gray-400">
                  <span>{likedCount}</span>
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </div>
              </div>

              <div
                onClick={() => {
                  setMainTab('home');
                  setHomeTab('mylist');
                }}
                className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <History className="w-4 h-4 text-blue-400" />
                  <span className="text-gray-200">閲覧履歴</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <span className="text-gray-200">フォローリスト</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <PackageCheck className="w-4 h-4 text-amber-400" />
                  <span className="text-gray-200">出品した商品</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <ShoppingBag className="w-4 h-4 text-purple-400" />
                  <span className="text-gray-200">購入した商品</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-200">下書き一覧</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>
            </div>
          </div>

          {/* Settings & Help */}
          <div className="space-y-2 pt-2">
            <h2 className="font-bold text-sm text-gray-300">設定・ヘルプ</h2>

            <div className="bg-[#1e1e1e] rounded-xl border border-[#2c2c2e] divide-y divide-[#2c2c2e] text-xs font-medium">
              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-200">支払い方法</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <Settings className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-200">個人情報設定</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>

              <div className="p-3.5 flex items-center justify-between hover:bg-[#252528] cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-200">ヘルプ・ガイド</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};
