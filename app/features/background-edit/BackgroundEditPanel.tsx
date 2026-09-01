'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Check, Download, ImagePlus, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { composeBackgroundPreview } from './canvasComposite';
import { downloadApprovedImage } from './approvedImage';
import { backgroundEditReducer, createInitialBackgroundEditState } from './backgroundEditReducer';
import { createConfiguredBackgroundEditProvider, FixtureBackgroundEditProvider, type BackgroundEditProvider, type BackgroundStyleId } from './provider';

export interface BackgroundEditPanelProps {
  original: Blob | null;
  originalPreviewUrl: string | null;
  onApproved?: (blob: Blob) => void | Promise<void>;
  onApprovalRevoked?: () => void | Promise<void>;
}

const STYLE_OPTIONS: ReadonlyArray<{
  id: BackgroundStyleId;
  label: string;
  description: string;
  swatch: string;
}> = [
  { id: 'studio_white', label: 'ソフトホワイト', description: '明るく、商品を主役に', swatch: '#f8f8f8' },
  { id: 'warm_neutral', label: 'ウォームニュートラル', description: 'やわらかなベージュ', swatch: '#f1e8dc' },
  { id: 'light_wood', label: 'ライトウッド', description: '自然な木目の空気感', swatch: '#e0c69e' },
];

const STYLE_LABELS: Record<BackgroundStyleId, string> = {
  studio_white: 'ソフトホワイト',
  warm_neutral: 'ウォームニュートラル',
  light_wood: 'ライトウッド',
};

const selectionLabel = (selection: 'original' | 'composite' | null): string => {
  if (selection === 'original') return '元画像';
  if (selection === 'composite') return '合成プレビュー';
  return '未選択';
};

export const BackgroundEditPanel: React.FC<BackgroundEditPanelProps> = ({
  original,
  originalPreviewUrl,
  onApproved,
  onApprovalRevoked,
}) => {
  const [state, dispatch] = useReducer(backgroundEditReducer, undefined, createInitialBackgroundEditState);
  const [styleId, setStyleId] = useState<BackgroundStyleId>('studio_white');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [generatedOriginalUrl, setGeneratedOriginalUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fallbackAvailable, setFallbackAvailable] = useState(false);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const approvalTransitionRef = useRef<'apply' | 'revoke' | null>(null);
  const [sourceOriginal, setSourceOriginal] = useState<Blob | null>(() => original);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(() => originalPreviewUrl);
  const [provider] = useState<BackgroundEditProvider>(() => createConfiguredBackgroundEditProvider());
  const [fixtureProvider] = useState(() => new FixtureBackgroundEditProvider());

  const replacePreviewUrl = useCallback((blob: Blob | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = blob ? URL.createObjectURL(blob) : null;
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  }, []);

  useEffect(() => {
    if (sourceOriginal === original) return undefined;
    if (approvalTransitionRef.current || state.phase === 'approved') return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !isMountedRef.current) return;
      setSourceOriginal(original);
      setSourcePreviewUrl(originalPreviewUrl);
      requestIdRef.current += 1;
      replacePreviewUrl(null);
      setFallbackAvailable(false);
      dispatch({ type: 'RESET' });
    });
    return () => { cancelled = true; };
  }, [original, originalPreviewUrl, replacePreviewUrl, sourceOriginal, state.phase]);

  useEffect(() => {
    if (sourcePreviewUrl || !sourceOriginal) {
      queueMicrotask(() => setGeneratedOriginalUrl(null));
      return undefined;
    }
    const url = URL.createObjectURL(sourceOriginal);
    queueMicrotask(() => setGeneratedOriginalUrl(url));
    return () => {
      URL.revokeObjectURL(url);
      setGeneratedOriginalUrl((current) => (current === url ? null : current));
    };
  }, [sourceOriginal, sourcePreviewUrl]);

  useEffect(() => () => {
    isMountedRef.current = false;
    requestIdRef.current += 1;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const originalUrl = sourcePreviewUrl ?? generatedOriginalUrl;

  const revokeApprovedFront = useCallback(async () => {
    if (onApprovalRevoked) {
      await onApprovalRevoked();
    } else if (state.approvedOutput === 'composite' && sourceOriginal) {
      // The existing integration exposes only onApproved. Passing the
      // untouched snapshot here restores the front slot without touching
      // back, tag, or measurement state.
      await onApproved?.(sourceOriginal);
    }
  }, [onApprovalRevoked, onApproved, sourceOriginal, state.approvedOutput]);

  const generatePreview = useCallback(async (useLocalBackground = false) => {
    if (!sourceOriginal) {
      dispatch({ type: 'PROCESSING_FAILED', message: '正面原本を取得できないため背景編集を開始できません。' });
      return;
    }
    if (isSubmitting) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isCurrent = () => isMountedRef.current && requestIdRef.current === requestId;
    let stage: 'mask' | 'background' | 'compose' = 'mask';
    let transitionInProgress = false;
    setIsSubmitting(true);
    try {
      if (state.phase === 'approved') {
        approvalTransitionRef.current = 'revoke';
        transitionInProgress = true;
        try {
          await revokeApprovedFront();
        } catch (error) {
          if (isCurrent()) dispatch({ type: 'APPROVAL_FAILED', message: error instanceof Error ? error.message : '承認を解除できませんでした。' });
          return;
        }
        if (!isCurrent()) return;
        dispatch({ type: 'REVOKE_APPROVAL' });
        approvalTransitionRef.current = null;
        transitionInProgress = false;
      }
      setFallbackAvailable(false);
      replacePreviewUrl(null);
      dispatch({ type: 'START_PROCESSING' });
      const mask = await provider.removeBackground(sourceOriginal);
      if (!isCurrent()) return;
      stage = 'background';
      const background = useLocalBackground
        ? await fixtureProvider.generateBackground(styleId)
        : await provider.generateBackground(styleId);
      if (!isCurrent()) return;
      stage = 'compose';
      const preview = await composeBackgroundPreview({ original: sourceOriginal, mask, background, outputType: 'image/png' });
      if (!isCurrent()) return;
      replacePreviewUrl(preview);
      dispatch({ type: 'PREVIEW_READY', blob: preview });
    } catch (error) {
      if (!isCurrent()) return;
      replacePreviewUrl(null);
      setFallbackAvailable(!useLocalBackground && stage === 'background');
      dispatch({ type: 'PROCESSING_FAILED', message: error instanceof Error && error.message.trim() ? error.message : '背景プレビューを作成できませんでした。' });
    } finally {
      if (transitionInProgress && approvalTransitionRef.current === 'revoke') approvalTransitionRef.current = null;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }, [fixtureProvider, isSubmitting, provider, replacePreviewUrl, revokeApprovedFront, sourceOriginal, state.phase, styleId]);

  const changeStyle = (nextStyleId: BackgroundStyleId) => {
    if (nextStyleId === styleId) return;
    if (state.phase === 'preview' || state.phase === 'error') {
      requestIdRef.current += 1;
      replacePreviewUrl(null);
      dispatch({ type: 'RESET' });
    }
    setStyleId(nextStyleId);
  };

  const selectOriginal = () => {
    if (!sourceOriginal || state.phase === 'processing' || state.phase === 'approved' || isSubmitting) return;
    dispatch({ type: 'SELECT_OUTPUT', selection: 'original', blob: sourceOriginal });
  };

  const selectComposite = () => {
    if (!state.previewBlob || state.phase === 'approved' || isSubmitting) return;
    dispatch({ type: 'SELECT_OUTPUT', selection: 'composite', blob: state.previewBlob });
  };

  const approve = async () => {
    if (state.phase !== 'preview' || !state.selectedBlob || !state.selectedOutput || isSubmitting) return;
    const selectedBlob = state.selectedBlob;
    approvalTransitionRef.current = 'apply';
    setIsSubmitting(true);
    try {
      await onApproved?.(selectedBlob);
      if (isMountedRef.current) dispatch({ type: 'APPROVE' });
    } catch (error) {
      if (isMountedRef.current) dispatch({ type: 'APPROVAL_FAILED', message: error instanceof Error ? error.message : '承認済み画像を保存できませんでした。' });
    } finally {
      if (approvalTransitionRef.current === 'apply') approvalTransitionRef.current = null;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  const revokeApproval = async () => {
    if (state.phase !== 'approved' || !state.approvedBlob || isSubmitting) return;
    approvalTransitionRef.current = 'revoke';
    setIsSubmitting(true);
    try {
      await revokeApprovedFront();
      if (isMountedRef.current) dispatch({ type: 'REVOKE_APPROVAL' });
    } catch (error) {
      if (isMountedRef.current) dispatch({ type: 'APPROVAL_FAILED', message: error instanceof Error ? error.message : '承認を解除できませんでした。' });
    } finally {
      if (approvalTransitionRef.current === 'revoke') approvalTransitionRef.current = null;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  const saveApproved = async () => {
    if (state.phase !== 'approved' || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const saved = await downloadApprovedImage(state);
      if (!saved && isMountedRef.current) dispatch({ type: 'APPROVAL_FAILED', message: '承認済み画像を保存できる環境ではありません。' });
    } catch (error) {
      if (isMountedRef.current) dispatch({ type: 'APPROVAL_FAILED', message: error instanceof Error ? error.message : '承認済み画像を保存できませんでした。' });
    } finally {
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  const canSelect = state.phase === 'preview';
  const isCandidateVisible = state.phase === 'preview' || state.phase === 'approved';
  const hasOriginal = Boolean(sourceOriginal && originalUrl);
  const chosenLabel = state.approvedOutput ? selectionLabel(state.approvedOutput) : selectionLabel(state.selectedOutput);

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-bg)] p-4 shadow-[0_12px_36px_rgba(0,0,0,0.16)]" data-testid="background-edit-panel">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--shop-blue)]/15 text-[var(--shop-blue)]"><Sparkles className="h-5 w-5" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-white">AI背景アシスト</p>
            <span className="rounded-full border border-[var(--shop-blue)]/30 px-2 py-0.5 text-[9px] font-black text-[var(--shop-blue)]">任意</span>
          </div>
          <p className="mt-1 text-[10px] leading-5 text-[var(--shop-muted)]">商品は元写真のまま。背景だけを整えて、比較してから採用できます。</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[9px] font-bold text-[var(--shop-muted)]" aria-label="背景編集の安全機能">
        <span className="rounded-full bg-[var(--shop-surface)] px-2.5 py-1.5">色・柄・傷を保持</span>
        <span className="rounded-full bg-[var(--shop-surface)] px-2.5 py-1.5">元画像をいつでも採用</span>
        <span className="rounded-full bg-[var(--shop-surface)] px-2.5 py-1.5">承認前は出品に反映しない</span>
      </div>

      <fieldset className="space-y-2" disabled={state.phase === 'processing' || state.phase === 'approved' || isSubmitting}>
        <legend className="text-[10px] font-black text-white">1. 背景の雰囲気を選ぶ</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="背景スタイル">
          {STYLE_OPTIONS.map((option) => {
            const selected = styleId === option.id;
            return <button key={option.id} type="button" role="radio" aria-checked={selected} onClick={() => changeStyle(option.id)} className={`min-h-14 rounded-xl border px-3 py-2 text-left transition ${selected ? 'border-[var(--shop-blue)] bg-[var(--shop-blue)]/10' : 'border-[var(--shop-border)] bg-[var(--shop-surface)] hover:border-[var(--shop-blue)]/60'}`}>
              <span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border border-white/30" style={{ backgroundColor: option.swatch }} aria-hidden="true" /><span className="text-[10px] font-black text-white">{option.label}</span>{selected && <Check className="ml-auto h-3.5 w-3.5 text-[var(--shop-blue)]" aria-hidden="true" />}</span>
              <span className="mt-1 block text-[9px] text-[var(--shop-muted)]">{option.description}</span>
            </button>;
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button type="button" onClick={() => void generatePreview()} disabled={!sourceOriginal || state.phase === 'processing' || isSubmitting} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--shop-blue)] px-4 py-2.5 text-xs font-black text-[#06202e] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" data-testid="background-edit-generate"><ImagePlus className="h-4 w-4" aria-hidden="true" />{state.phase === 'preview' || state.phase === 'approved' ? '別の背景で再生成' : '背景をプレビュー'}</button>
        {state.phase === 'processing' && <span className="flex items-center gap-2 text-[10px] text-[var(--shop-muted)]" role="status"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />背景とmaskを準備中…</span>}
      </div>

      {fallbackAvailable && <div className="space-y-2 rounded-xl border border-yellow-300/30 bg-yellow-300/10 p-3" role="alert" data-testid="background-edit-fallback"><p className="flex items-start gap-2 text-[10px] leading-5 text-yellow-100"><RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />背景生成サービスを利用できません。撮影済みの写真と採寸値は保持されています。</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void generatePreview(true)} disabled={state.phase === 'processing' || isSubmitting} className="min-h-10 rounded-lg bg-yellow-100 px-3 py-2 text-[10px] font-black text-[#312000] hover:bg-white disabled:opacity-40" data-testid="background-edit-use-fixture">固定背景で続ける</button><button type="button" onClick={() => void generatePreview()} disabled={state.phase === 'processing' || isSubmitting} className="min-h-10 rounded-lg border border-yellow-100/30 px-3 py-2 text-[10px] font-bold text-yellow-100 hover:bg-yellow-100/10 disabled:opacity-40" data-testid="background-edit-retry">もう一度試す</button></div></div>}
      {state.error && <p className="flex items-start gap-2 rounded-lg border border-yellow-300/20 bg-yellow-300/5 p-3 text-[10px] leading-5 text-yellow-100" role="alert"><RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{state.error}</p>}

      {state.phase === 'error' && sourceOriginal && <div className="space-y-2 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3" data-testid="background-edit-original-fallback"><p className="text-[10px] font-black text-white">元画像をそのまま使う</p><p className="text-[9px] leading-5 text-[var(--shop-muted)]">背景編集に失敗しても原本は失われません。比較を省略して元画像を選び、承認できます。</p><button type="button" onClick={selectOriginal} disabled={isSubmitting} className="min-h-11 w-full rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-[10px] font-black text-white hover:border-[var(--shop-blue)] disabled:opacity-40" data-testid="background-edit-select-original-fallback">元画像を選択</button></div>}

      {isCandidateVisible && <div className="space-y-3" data-testid="background-edit-comparison">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black text-white">2. 比較して採用する画像を選ぶ</p><p className="mt-1 text-[9px] text-[var(--shop-muted)]">同じ枠で見比べ、選択したあとに承認してください。</p></div><span className="rounded-full bg-[var(--shop-surface)] px-2 py-1 text-[9px] font-bold text-[var(--shop-muted)]">{STYLE_LABELS[styleId]}</span></div>
        <div className="grid gap-3 sm:grid-cols-2" aria-label="元画像と背景編集プレビューの比較">
          <figure className={`overflow-hidden rounded-xl border bg-[var(--shop-surface)] ${state.selectedOutput === 'original' || state.approvedOutput === 'original' ? 'border-[var(--shop-blue)]' : 'border-[var(--shop-border)]'}`}>
            <div className="relative aspect-[3/4] w-full bg-[#f2eee8]">{hasOriginal ? <img src={originalUrl ?? undefined} alt="背景編集前の正面画像" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-[10px] text-[var(--shop-muted)]">元画像を読み込み中…</div>}<span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[9px] font-black text-white">元画像</span></div>
            <figcaption className="space-y-2 p-2"><p className="text-[9px] text-[var(--shop-muted)]">商品そのものを保持</p><button type="button" onClick={selectOriginal} disabled={!canSelect || !sourceOriginal || isSubmitting} aria-pressed={state.selectedOutput === 'original'} className="min-h-10 w-full rounded-lg border border-[var(--shop-border)] px-2 py-2 text-[10px] font-black text-white hover:border-[var(--shop-blue)] disabled:cursor-not-allowed disabled:opacity-40" data-testid="background-edit-select-original">{state.selectedOutput === 'original' ? '元画像を選択中' : '元画像を採用候補にする'}</button></figcaption>
          </figure>
          <figure className={`overflow-hidden rounded-xl border bg-[var(--shop-surface)] ${state.selectedOutput === 'composite' || state.approvedOutput === 'composite' ? 'border-[var(--shop-blue)]' : 'border-[var(--shop-border)]'}`}>
            <div className="relative aspect-[3/4] w-full bg-[#f2eee8]">{previewUrl ? <img src={previewUrl} alt="背景編集後のプレビュー" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center px-4 text-center text-[10px] leading-5 text-[var(--shop-muted)]">背景候補はありません。<br />元画像を選択できます。</div>}<span className="absolute left-2 top-2 rounded-full bg-[var(--shop-blue)]/90 px-2 py-1 text-[9px] font-black text-[#06202e]">背景編集</span></div>
            <figcaption className="space-y-2 p-2"><p className="text-[9px] text-[var(--shop-muted)]">商品RGBは元画像から合成</p><button type="button" onClick={selectComposite} disabled={!canSelect || !state.previewBlob || isSubmitting} aria-pressed={state.selectedOutput === 'composite'} className="min-h-10 w-full rounded-lg border border-[var(--shop-blue)]/40 px-2 py-2 text-[10px] font-black text-white hover:bg-[var(--shop-blue)]/10 disabled:cursor-not-allowed disabled:opacity-40" data-testid="background-edit-select-composite">{state.selectedOutput === 'composite' ? '合成画像を選択中' : '合成画像を採用候補にする'}</button></figcaption>
          </figure>
        </div>
        {state.phase === 'preview' && <div className="space-y-2"><p className="text-center text-[10px] font-bold text-[var(--shop-muted)]" role="status">選択中: <span className="text-white">{chosenLabel}</span>{state.selectedOutput ? ' — 内容を確認して承認へ' : ' — どちらかを選択してください'}</p><button type="button" onClick={() => void approve()} disabled={!state.selectedBlob || !state.selectedOutput || isSubmitting} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2.5 text-xs font-black text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40" data-testid="background-edit-approve"><Check className="h-4 w-4" aria-hidden="true" />{state.selectedOutput ? `${selectionLabel(state.selectedOutput)}を明示承認して採用` : '採用する画像を選択してください'}</button></div>}
        {state.phase === 'approved' && <div className="space-y-3 rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-3"><p className="flex items-center gap-2 text-[10px] font-black text-emerald-100" role="status"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{selectionLabel(state.approvedOutput)}を明示承認しました。</p><div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => void revokeApproval()} disabled={isSubmitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-100/30 px-3 py-2.5 text-[10px] font-bold text-emerald-100 hover:bg-emerald-100/10 disabled:opacity-40" data-testid="background-edit-revoke"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />承認を解除して比較に戻る</button><button type="button" onClick={() => void saveApproved()} disabled={isSubmitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-100 px-3 py-2.5 text-[10px] font-black text-[#12351e] hover:bg-white disabled:opacity-40" data-testid="background-edit-save"><Download className="h-3.5 w-3.5" aria-hidden="true" />承認済み画像を保存</button></div></div>}
      </div>}

      <p className="flex items-start gap-2 border-t border-[var(--shop-border)] pt-3 text-[9px] leading-5 text-[var(--shop-muted)]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--shop-blue)]" aria-hidden="true" />生成画像は比較と明示承認が完了するまで出品画像になりません。背面・タグ・採寸データはこの編集操作から変更しません。</p>
    </section>
  );
};
