'use client';

import React, { useState } from 'react';
import { useMercari } from '../../context/MercariContext';
import { NotificationItem } from '../../types/mercari';
import { ChevronRight, X } from 'lucide-react';

export const NotificationView: React.FC = () => {
  const { notifications, activeNotification, setActiveNotification } = useMercari();
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'you' | 'campaign'>('you');

  const filteredNotifications = notifications.filter((n) => {
    if (activeSubTab === 'all') return true;
    return n.type === activeSubTab;
  });

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar bg-[#121212] pb-6" data-testid="notification-view">
      {/* Title Bar */}
      <div className="bg-[#1e1e1e] border-b border-[#2c2c2e] px-4 py-3 flex items-center justify-between">
        <h1 className="font-extrabold text-lg text-white">お知らせ</h1>
        <button className="text-xs text-blue-400 font-bold hover:underline">ニュース</button>
      </div>

      {/* Sub Tabs */}
      <div className="bg-[#1e1e1e] border-b border-[#2c2c2e] flex text-xs font-medium px-2">
        <button
          onClick={() => setActiveSubTab('all')}
          className={`py-2.5 px-3 flex-1 text-center border-b-2 transition-colors ${
            activeSubTab === 'all'
              ? 'border-white text-white font-bold'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          すべて
        </button>
        <button
          onClick={() => setActiveSubTab('you')}
          className={`py-2.5 px-3 flex-1 text-center border-b-2 transition-colors ${
            activeSubTab === 'you'
              ? 'border-[#ff0211] text-[#ff0211] font-bold'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          あなた宛
        </button>
        <button
          onClick={() => setActiveSubTab('campaign')}
          className={`py-2.5 px-3 flex-1 text-center border-b-2 transition-colors ${
            activeSubTab === 'campaign'
              ? 'border-white text-white font-bold'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          キャンペーン
        </button>
      </div>

      {/* List */}
      <div className="divide-y divide-[#2c2c2e]">
        {filteredNotifications.map((item) => (
          <div
            key={item.id}
            onClick={() => setActiveNotification(item)}
            className="p-4 flex items-start gap-3 hover:bg-[#1e1e1e] cursor-pointer transition-colors"
            data-testid={`notification-item-${item.id}`}
          >
            {/* Mercari Icon Avatar */}
            <div className="w-10 h-10 rounded-full bg-[#ff0211] flex items-center justify-center font-bold text-white text-lg flex-shrink-0 shadow-sm">
              m
            </div>

            <div className="flex-1 space-y-1">
              <p className="text-xs text-gray-200 leading-snug font-medium line-clamp-2">
                {item.title}
              </p>
              <span className="text-[10px] text-gray-500 block">{item.date}</span>
            </div>

            <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0 mt-3" />
          </div>
        ))}
      </div>

      {/* Campaign Banner Button */}
      <div className="p-4">
        <button className="w-full bg-[#1e1e1e] border border-blue-600/50 hover:bg-blue-950/20 text-blue-400 font-bold text-xs py-3 rounded-xl flex items-center justify-between px-4 transition-colors">
          <span>1件のおすすめキャンペーンを見る</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Detail Dialog */}
      {activeNotification && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#1e1e1e] border border-[#2c2c2e] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-5 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-[#2c2c2e] pb-3">
              <h3 className="font-bold text-sm text-white">メッセージ詳細</h3>
              <button onClick={() => setActiveNotification(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-200 font-bold leading-relaxed">{activeNotification.title}</p>
            <p className="text-xs text-gray-400 leading-relaxed">{activeNotification.content}</p>
            <div className="text-[10px] text-gray-500 text-right">{activeNotification.date}</div>
            <button
              onClick={() => setActiveNotification(null)}
              className="w-full bg-[#ff0211] text-white text-xs font-bold py-2.5 rounded-xl"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
