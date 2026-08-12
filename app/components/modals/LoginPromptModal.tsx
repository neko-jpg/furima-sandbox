'use client';

import React from 'react';
import { LogIn, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';

export const LoginPromptModal: React.FC = () => {
  const { isLoginPromptOpen, loginPromptReason, closeLoginPrompt } = useMercari();
  if (!isLoginPromptOpen) return null;

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="login-prompt-title">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-6 shadow-2xl animate-fade-in">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--shop-accent)]/15 text-[var(--shop-accent)]"><LogIn className="h-5 w-5" /></span>
          <button type="button" onClick={closeLoginPrompt} className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)] hover:text-white" aria-label="閉じる"><X className="h-5 w-5" /></button>
        </div>
        <h2 id="login-prompt-title" className="mt-5 text-lg font-black text-white">ログイン不要のモックモードです</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--shop-muted)]">{loginPromptReason}</p>
        <p className="mt-3 rounded-lg bg-[var(--shop-surface-raised)] px-3 py-2 text-xs leading-5 text-[var(--shop-subtle)]">実際のアカウント登録や決済は行わず、いいね・購入・出品などをモックとして体験できます。</p>
        <button type="button" onClick={closeLoginPrompt} className="mt-5 w-full rounded-xl bg-[var(--shop-accent)] py-3 text-sm font-black text-white hover:bg-[var(--shop-accent-strong)]">そのまま使う</button>
      </div>
    </div>
  );
};
