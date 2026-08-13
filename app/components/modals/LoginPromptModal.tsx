'use client';

import React, { useEffect, useRef } from 'react';
import { LogIn, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';

export const LoginPromptModal: React.FC = () => {
  const { isLoginPromptOpen, loginPromptReason, closeLoginPrompt } = useMercari();
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isLoginPromptOpen) return undefined;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const focusableSelector = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => modalRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeLoginPrompt(); return; }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.setTimeout(focusFirst, 0);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElement?.isConnected) previousActiveElement.focus();
    };
  }, [closeLoginPrompt, isLoginPromptOpen]);
  if (!isLoginPromptOpen) return null;

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="login-prompt-title">
      <div ref={modalRef} className="w-full max-w-sm rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-6 shadow-2xl animate-fade-in">
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
