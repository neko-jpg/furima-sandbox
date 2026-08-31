/*
 * These previews are session-scoped Blob/object URLs. next/image cannot
 * optimize them or resolve their dimensions reliably, so the native image
 * boundary is intentional here.
 */
/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Check, ImagePlus, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { composeBackgroundPreview } from './canvasComposite';
import { backgroundEditReducer, createInitialBackgroundEditState } from './backgroundEditReducer';
import { createConfiguredBackgroundEditProvider, type BackgroundStyleId } from './provider';

export interface BackgroundEditPanelProps {
  original: Blob | null;
  originalPreviewUrl: string | null;
  onApproved?: (blob: Blob) => void | Promise<void>;
}

const STYLE_LABELS: Record<BackgroundStyleId, string> = {
  studio_white: 'ソフトホワイト',
  warm_neutral: 'ウォームニュートラル',
  light_wood: 'ライトウッド',
};

export const BackgroundEditPanel: React.FC<BackgroundEditPanelProps> = ({ original, originalPreviewUrl, onApproved }) => {
  const [state, dispatch] = useReducer(backgroundEditReducer, undefined, createInitialBackgroundEditState);
  const [styleId, setStyleId] = useState<BackgroundStyleId>('studio_white');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [provider] = useState(createConfiguredBackgroundEditProvider);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const replacePreviewUrl = (blob: Blob | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = blob ? URL.createObjectURL(blob) : null;
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  };

  const generatePreview = async () => {
    if (!original) {
      dispatch({ type: 'PROCESSING_FAILED', message: '正面原本を取得できないため背景編集を開始できません。' });
      return;
    }
    dispatch({ type: 'START_PROCESSING' });
    try {
      const [mask, background] = await Promise.all([
        provider.removeBackground(original),
        provider.generateBackground(styleId),
      ]);
      const preview = await composeBackgroundPreview({ original, mask, background, outputType: 'image/jpeg', quality: 0.92 });
      replacePreviewUrl(preview);
      dispatch({ type: 'PREVIEW_READY', blob: preview });
    } catch (error) {
      replacePreviewUrl(null);
      dispatch({ type: 'PROCESSING_FAILED', message: error instanceof Error ? error.message : '背景プレビューを作成できませんでした。' });
    }
  };

  const approve = async () => {
    if (state.phase !== 'preview' || !state.previewBlob) return;
    setIsSubmitting(true);
    try {
      await onApproved?.(state.previewBlob);
      replacePreviewUrl(null);
      dispatch({ type: 'APPROVE' });
    } catch (error) {
      dispatch({ type: 'PROCESSING_FAILED', message: error instanceof Error ? error.message : '承認済み画像を保存できませんでした。' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3" data-testid="background-edit-panel">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--shop-blue)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black text-white">背景を試す（任意）</p>
          <p className="mt-1 text-[10px] leading-5 text-[var(--shop-muted)]">商品RGBは正面原本からのみ合成します。生成画像は比較・承認するまで出品へ渡しません。</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] font-bold text-[var(--shop-muted)]">背景スタイル<select value={styleId} onChange={(event) => setStyleId(event.target.value as BackgroundStyleId)} disabled={state.phase === 'processing'} className="ml-2 min-h-11 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-2 text-xs font-bold text-white outline-none focus:border-[var(--shop-blue)]">{(Object.keys(STYLE_LABELS) as BackgroundStyleId[]).map((id) => <option key={id} value={id}>{STYLE_LABELS[id]}</option>)}</select></label>
        <button type="button" onClick={() => void generatePreview()} disabled={!original || state.phase === 'processing'} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--shop-blue)] px-3 py-2.5 text-xs font-black text-[#06202e] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><ImagePlus className="h-4 w-4" aria-hidden="true" />{state.phase === 'preview' ? '再生成' : 'プレビュー生成'}</button>
      </div>
      {state.phase === 'processing' && <p className="flex items-center gap-2 text-[10px] text-[var(--shop-muted)]" role="status"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />背景とmaskを処理しています…</p>}
      {state.error && <p className="flex items-start gap-2 text-[10px] leading-5 text-yellow-100" role="alert"><RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{state.error}</p>}
      {state.phase === 'preview' && previewUrl && (
        <div className="grid gap-2 sm:grid-cols-2" aria-label="元画像と背景編集プレビューの比較">
          <figure className="overflow-hidden rounded-lg border border-[var(--shop-border)]"><img src={originalPreviewUrl ?? previewUrl} alt="背景編集前の正面画像" className="aspect-square w-full object-contain" /><figcaption className="px-2 py-1.5 text-[10px] text-[var(--shop-muted)]">元画像</figcaption></figure>
          <figure className="overflow-hidden rounded-lg border border-[var(--shop-blue)]/50"><img src={previewUrl} alt="背景編集後のプレビュー" className="aspect-square w-full object-contain" /><figcaption className="px-2 py-1.5 text-[10px] text-[var(--shop-muted)]">生成背景プレビュー</figcaption></figure>
        </div>
      )}
      {state.phase === 'preview' && <button type="button" onClick={() => void approve()} disabled={isSubmitting} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 py-2.5 text-xs font-black text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-4 w-4" aria-hidden="true" />この画像を明示承認して採用</button>}
      {state.phase === 'approved' && <p className="flex items-center gap-2 text-[10px] font-bold text-emerald-100" role="status"><ShieldCheck className="h-4 w-4" aria-hidden="true" />背景編集画像を明示承認しました。</p>}
    </section>
  );
};
