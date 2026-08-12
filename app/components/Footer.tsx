'use client';

import React, { useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';

export const Footer: React.FC = () => {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setOpenSection(openSection === section ? null : section);
  };

  return (
    <footer className="bg-[#1e1e1e] border-t border-[#2c2c2e] px-4 py-6 text-gray-300 select-none text-xs space-y-4">
      {/* Accordion Menu 1: Mercari About */}
      <div className="border-b border-[#2c2c2e] pb-3">
        <button
          onClick={() => toggleSection('about')}
          className="w-full flex items-center justify-between font-bold text-sm text-gray-200 py-1"
        >
          <span>メルカリについて</span>
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              openSection === 'about' ? 'rotate-180' : ''
            }`}
          />
        </button>
        {openSection === 'about' && (
          <div className="pt-2 pl-2 space-y-2 text-gray-400">
            <div>会社概要（運営会社）</div>
            <div>採用情報</div>
            <div>プレスリリース</div>
            <div>公式ブログ</div>
          </div>
        )}
      </div>

      {/* Accordion Menu 2: Help */}
      <div className="border-b border-[#2c2c2e] pb-3">
        <button
          onClick={() => toggleSection('help')}
          className="w-full flex items-center justify-between font-bold text-sm text-gray-200 py-1"
        >
          <span>ヘルプ</span>
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              openSection === 'help' ? 'rotate-180' : ''
            }`}
          />
        </button>
        {openSection === 'help' && (
          <div className="pt-2 pl-2 space-y-2 text-gray-400">
            <div>メルカリガイド</div>
            <div>らくらくメルカリ便</div>
            <div>ゆうゆうメルカリ便</div>
            <div>あんしん・安全への取り組み</div>
          </div>
        )}
      </div>

      {/* Accordion Menu 3: Privacy & Terms */}
      <div className="border-b border-[#2c2c2e] pb-3">
        <button
          onClick={() => toggleSection('privacy')}
          className="w-full flex items-center justify-between font-bold text-sm text-gray-200 py-1"
        >
          <span>プライバシーと利用規約</span>
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              openSection === 'privacy' ? 'rotate-180' : ''
            }`}
          />
        </button>
        {openSection === 'privacy' && (
          <div className="pt-2 pl-2 space-y-2 text-gray-400">
            <div>プライバシーポリシー</div>
            <div>メルカリ利用規約</div>
            <div>コンプライアンスポリシー</div>
            <div>個人データの安全管理</div>
          </div>
        )}
      </div>

      {/* Social Icons & Bottom Controls */}
      <div className="pt-2 flex items-center justify-between">
        {/* Social Icons */}
        <div className="flex items-center gap-3">
          {/* X (Twitter) Icon */}
          <button className="p-2 bg-[#2a2a2d] hover:bg-[#323235] rounded-full text-white transition-colors">
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </button>
          {/* Facebook Icon */}
          <button className="p-2 bg-[#2a2a2d] hover:bg-[#323235] rounded-full text-white transition-colors">
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </button>
        </div>

        {/* Language Selector Button */}
        <button className="flex items-center gap-1.5 bg-[#2a2a2d] border border-[#3a3a3c] px-3 py-1.5 rounded-lg text-xs text-gray-200 font-medium">
          <Globe className="w-3.5 h-3.5" />
          <span>日本語</span>
        </button>
      </div>

      {/* Copyright */}
      <div className="pt-2 text-[#8e8e93] text-[11px]">
        © Mercari, Inc.
      </div>
    </footer>
  );
};
