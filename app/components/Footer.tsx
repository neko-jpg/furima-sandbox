'use client';

import React, { useState } from 'react';
import { ChevronDown, Globe } from 'lucide-react';
import { useMercari } from '../context/MercariContext';

const sections = [
  { key: 'about', label: 'Furima Sandboxについて', links: ['会社概要', '採用情報', 'プレスリリース', '公式ブログ'] },
  { key: 'help', label: 'ヘルプ', links: ['Furima Sandboxガイド', '配送について', '安心・安全の取り組み', 'お問い合わせ'] },
  { key: 'terms', label: 'プライバシーと利用規約', links: ['プライバシーポリシー', '利用規約', '特商法に基づく表記', '個人情報の取り扱い'] },
];

export const Footer: React.FC = () => {
  const { isDeviceFrame } = useMercari();
  const [openSection, setOpenSection] = useState<string | null>(null);
  return (
    <footer className="mt-8 border-t border-[var(--shop-border)] bg-[#2a2a2c] px-4 py-7 text-[var(--shop-muted)] md:px-8" data-testid="shop-footer">
      <div className={`mx-auto grid max-w-[1280px] gap-2 ${isDeviceFrame ? '' : 'md:grid-cols-3 md:gap-8'}`}>
        {sections.map((section) => (
          <div key={section.key} className={`border-b border-[var(--shop-border)] ${isDeviceFrame ? '' : 'md:border-b-0'}`}>
            <button type="button" onClick={() => setOpenSection(openSection === section.key ? null : section.key)} className={`flex w-full items-center justify-between py-3 text-left text-sm font-bold text-white ${isDeviceFrame ? '' : 'md:cursor-default'}`} aria-expanded={openSection === section.key || undefined}>
              {section.label}<ChevronDown className={`h-4 w-4 transition-transform ${isDeviceFrame ? '' : 'md:hidden'} ${openSection === section.key ? 'rotate-180' : ''}`} />
            </button>
            <div className={`pb-3 text-xs leading-7 ${isDeviceFrame ? '' : 'md:block'} ${openSection === section.key ? 'block' : 'hidden'}`}>
              {section.links.map((link) => <button type="button" key={link} className="block text-left text-[var(--shop-muted)] hover:text-white">{link}</button>)}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-5 flex max-w-[1280px] items-center justify-between border-t border-[var(--shop-border)] pt-5">
        <div className="flex items-center gap-3"><span className="text-lg font-black text-white">𝕏</span><span className="text-xl font-bold text-white">f</span><span className="text-[11px] text-[var(--shop-subtle)]">© Furima Sandbox</span></div>
        <button type="button" className="flex items-center gap-1.5 rounded-md border border-[var(--shop-border)] px-2.5 py-1.5 text-[11px] text-white"><Globe className="h-3.5 w-3.5" />日本語</button>
      </div>
    </footer>
  );
};
