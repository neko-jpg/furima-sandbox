/* Review previews are session-scoped Blob/object URLs; next/image cannot
 * optimize these dynamic URLs, so native <img> is intentional. */
/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, ChevronDown, CircleHelp, ImagePlus, LoaderCircle, RefreshCw, Ruler, ShieldCheck, Sparkles, Wifi, WifiOff, X } from 'lucide-react';
import { BackgroundEditPanel } from '../../background-edit/BackgroundEditPanel';
import type { ConnectionState, GuidedCapturePhase, MeasurementEndpoints, MeasurementProjectionCorners, SessionSlot, SlotProgress } from './contracts';
import type { GuidedCaptureController } from './useGuidedCaptureController';

export interface GuidedCapturePanelProps {
  controller: GuidedCaptureController;
  category: string;
  subcategory: string;
  canAddMedia: boolean;
  isBusy?: boolean;
  onManualCamera: () => void;
  onManualAlbum: () => void;
  frontOriginal: Blob | null;
  frontPreviewUrl: string | null;
  onBackgroundApproved?: (blob: Blob) => void | Promise<void>;
}

const SLOT_LABELS: Record<SessionSlot, string> = {
  front: '表面',
  back: '裏面',
  tag: 'タグ',
  measurement: '採寸',
};

const SLOT_DETAILS: Record<SessionSlot, string> = {
  front: '全体を正面から',
  back: '裏面をまっすぐ',
  tag: 'ブランド・洗濯表示',
  measurement: '承認済みの採寸値',
};

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: '接続中',
  connected: '接続済み',
  reconnecting: '再接続中',
  disconnected: 'オフライン（手動撮影可）',
};

const IMAGE_SLOTS = ['front', 'back', 'tag'] as const;

const MEASUREMENT_ENDPOINTS = [
  { key: 'lengthStart', label: '着丈 始点' },
  { key: 'lengthEnd', label: '着丈 終点' },
  { key: 'widthStart', label: '身幅 始点' },
  { key: 'widthEnd', label: '身幅 終点' },
] as const satisfies ReadonlyArray<{ key: keyof MeasurementEndpoints; label: string }>;

const PROJECTION_CORNER_LABELS = ['左上', '右上', '右下', '左下'] as const;
const DEFAULT_PROJECTION_CORNERS: MeasurementProjectionCorners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const PHASE_LABELS: Record<GuidedCapturePhase, string> = {
  idle: '未開始',
  connecting: '準備中',
  capturing: '撮影中',
  measurement: '採寸確認',
  review: '撮影内容を確認',
  ready: '出品引き渡し準備完了',
  fallback: '固定ガイドで継続',
};

const isSupportedClothing = (category: string, subcategory: string): boolean => {
  if (!category) return true;
  if (category !== 'レディース' && category !== 'メンズ') return false;
  return !subcategory || subcategory === 'トップス';
};

const statusLabel = (progress: SlotProgress): string => {
  switch (progress.status) {
    case 'captured': return '撮影済み';
    case 'approved': return '承認済み';
    case 'active': return '撮影待ち';
    default: return '未完了';
  }
};

const statusClass = (progress: SlotProgress): string => {
  switch (progress.status) {
    case 'captured':
    case 'approved': return 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100';
    case 'active': return 'border-[var(--shop-blue)] bg-[var(--shop-blue)]/10 text-white';
    default: return 'border-[var(--shop-border)] bg-[var(--shop-bg)] text-[var(--shop-muted)]';
  }
};

const statusIcon = (progress: SlotProgress) => {
  if (progress.status === 'captured' || progress.status === 'approved') return <Check className="h-4 w-4" aria-hidden="true" />;
  if (progress.status === 'active') return <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />;
  return <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />;
};

const connectionIcon = (connectionState: ConnectionState) => {
  if (connectionState === 'disconnected') return <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />;
  if (connectionState === 'connecting' || connectionState === 'reconnecting') return <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />;
  return <Wifi className="h-3.5 w-3.5" aria-hidden="true" />;
};

const allImageSlotsCaptured = (slots: Record<SessionSlot, SlotProgress>): boolean => IMAGE_SLOTS.every((slot) => slots[slot].status === 'captured' || slots[slot].status === 'approved');

const isValidMeasurementValue = (value: number | null | undefined, min: number, max: number): value is number => value !== null && value !== undefined && Number.isFinite(value) && value >= min && value <= max;

export const GuidedCapturePanel: React.FC<GuidedCapturePanelProps> = ({ controller, category, subcategory, canAddMedia, isBusy = false, onManualCamera, onManualAlbum, frontOriginal, frontPreviewUrl, onBackgroundApproved }) => {
  const [isOpen, setIsOpen] = useState(false);
  const measurementCameraInputRef = useRef<HTMLInputElement>(null);
  const measurementAlbumInputRef = useRef<HTMLInputElement>(null);
  const measurementPreviewUrlRef = useRef<string | null>(null);
  const [measurementPreviewUrl, setMeasurementPreviewUrl] = useState<string | null>(null);
  const { state } = controller;
  const isActive = state.phase !== 'idle';
  const isSupported = isSupportedClothing(category, subcategory);
  const hasSelectedCategory = Boolean(category || subcategory);
  const isPendingCategory = !hasSelectedCategory || (Boolean(category) && !subcategory);
  const approvedMeasurement = state.measurement;
  const guidanceMessage = state.latestGuidance?.message ?? (state.connectionState === 'disconnected' || state.phase === 'fallback'
    ? 'AI判定を待たずに、固定ガイドを見ながら手動で撮影できます。'
    : state.phase === 'ready'
      ? '必要な写真と採寸の承認が揃いました。背景画像は承認前には出品へ渡されません。'
      : `次は「${SLOT_LABELS[state.activeSlot]}」を確認してください。`);
  const measurementReady = isValidMeasurementValue(state.measurementDraft?.lengthCm, 20, 100) && isValidMeasurementValue(state.measurementDraft?.widthCm, 20, 80);

  useEffect(() => () => {
    if (measurementPreviewUrlRef.current) URL.revokeObjectURL(measurementPreviewUrlRef.current);
  }, []);

  useEffect(() => {
    if (state.phase === 'idle' && measurementPreviewUrlRef.current) {
      URL.revokeObjectURL(measurementPreviewUrlRef.current);
      measurementPreviewUrlRef.current = null;
      setMeasurementPreviewUrl(null);
    }
  }, [state.phase]);

  const clearMeasurementPreview = () => {
    if (measurementPreviewUrlRef.current) URL.revokeObjectURL(measurementPreviewUrlRef.current);
    measurementPreviewUrlRef.current = null;
    setMeasurementPreviewUrl(null);
  };

  const onMeasurementFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearMeasurementPreview();
    const previewUrl = URL.createObjectURL(file);
    measurementPreviewUrlRef.current = previewUrl;
    setMeasurementPreviewUrl(previewUrl);
    void controller.recordMeasurement(file);
  };

  const updateEndpoint = (key: keyof MeasurementEndpoints, axis: 'x' | 'y', rawValue: string) => {
    const endpoints = state.measurementDraft?.endpoints;
    if (!endpoints || rawValue.trim() === '') return;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    controller.updateMeasurement({ endpoints: { ...endpoints, [key]: { ...endpoints[key], [axis]: value } } });
  };

  const updateProjectionCorner = (index: number, axis: 'x' | 'y', rawValue: string) => {
    if (rawValue.trim() === '') return;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > 1) return;
    const corners = [...(state.measurementDraft?.projectionCorners ?? DEFAULT_PROJECTION_CORNERS)] as Array<{ x: number; y: number }>;
    corners[index] = { ...corners[index], [axis]: value };
    const nextCorners: MeasurementProjectionCorners = [corners[0], corners[1], corners[2], corners[3]];
    controller.updateMeasurement({ projectionCorners: nextCorners });
  };

  const handleRetakeMeasurement = () => {
    clearMeasurementPreview();
    controller.retakeMeasurement();
  };

  return (
    <section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)]" data-testid="guided-capture-panel">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-[var(--shop-surface-raised)] focus:outline-none focus:ring-2 focus:ring-[var(--shop-blue)] focus:ring-inset"
        aria-expanded={isOpen}
        aria-controls="guided-capture-content"
        data-testid="guided-capture-toggle"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--shop-blue)]/15 text-[var(--shop-blue)]"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-black text-white">
            AI撮影アシスタント
            <span className="rounded-full border border-[var(--shop-blue)]/30 px-2 py-0.5 text-[10px] font-bold text-[var(--shop-blue)]">任意</span>
          </span>
          <span className="mt-0.5 block text-xs text-[var(--shop-muted)]">半袖クルーネックTシャツ向け。対象外カテゴリは通常の撮影を利用できます。</span>
        </span>
        {isActive && <span className="hidden text-[10px] font-bold text-[var(--shop-blue)] sm:block">{PHASE_LABELS[state.phase]}</span>}
        <ChevronDown className={`h-5 w-5 shrink-0 text-[var(--shop-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div id="guided-capture-content" className="space-y-4 border-t border-[var(--shop-border)] px-4 pb-4 pt-4" data-testid="guided-capture-content">
          <div className="flex flex-wrap items-start gap-3 rounded-lg bg-[var(--shop-bg)] p-3">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-[var(--shop-blue)]" aria-hidden="true" />
              <p className="text-xs leading-5 text-[var(--shop-muted)]">AI撮影は衣類の写真を順番に確認します。AIがREADYでなくても、手動撮影・アルバム追加はいつでも利用できます。</p>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--shop-border)] px-2 py-1 text-[10px] font-bold text-[var(--shop-muted)]" data-testid="guided-capture-transport">{state.transport === 'live' ? 'live接続' : state.transport === 'fixture' ? 'fixture接続' : '接続待ち'}</span>
          </div>

          {!isSupported && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-300/30 bg-yellow-300/10 p-3 text-xs leading-5 text-yellow-100" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>現在のカテゴリーはAI撮影アシスタントの対象外です。通常のカメラ／アルバム入力はそのまま使えます。</span>
            </div>
          )}
          {isPendingCategory && isSupported && (
            <p className="rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3 text-xs leading-5 text-[var(--shop-muted)]" role="status">カテゴリー未確定でも撮影を始められます。後で「レディース／メンズ・トップス」に設定した場合にこのガイドを利用できます。</p>
          )}

          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${state.connectionState === 'connected' ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100' : state.connectionState === 'disconnected' ? 'border-yellow-300/30 bg-yellow-300/10 text-yellow-100' : 'border-[var(--shop-border)] text-[var(--shop-muted)]'}`} data-testid="guided-capture-connection">
              {connectionIcon(state.connectionState)}{CONNECTION_LABELS[state.connectionState]}
            </span>
            <span className="text-[10px] text-[var(--shop-muted)]">{PHASE_LABELS[state.phase]}</span>
            {state.error && <span className="text-[10px] text-yellow-100" role="alert">{state.error}</span>}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="list" aria-label="撮影アシスタントの進捗">
            {(Object.keys(SLOT_LABELS) as SessionSlot[]).map((slot) => {
              const progress = state.slots[slot];
              return (
                <div key={slot} role="listitem">
                  <button
                    type="button"
                    className={`min-h-11 w-full rounded-lg border p-2 text-left transition-colors hover:border-[var(--shop-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--shop-blue)] ${statusClass(progress)}`}
                    data-testid={`guided-capture-slot-${slot}`}
                    aria-current={state.activeSlot === slot ? 'step' : undefined}
                    onClick={() => isActive && controller.selectSlot(slot)}
                    disabled={!isActive}
                  >
                    <span className="flex items-center justify-between gap-1 text-[11px] font-black"><span className="flex items-center gap-1.5">{statusIcon(progress)}{SLOT_LABELS[slot]}</span><span>{statusLabel(progress)}</span></span>
                    <span className="mt-1 block truncate text-[10px] opacity-75">{SLOT_DETAILS[slot]}</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3" role="status" data-testid="guided-capture-guidance">
            <p className="flex items-start gap-2 text-xs leading-5 text-white"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--shop-blue)]" aria-hidden="true" /><span>{guidanceMessage}</span></p>
            {state.activeSlot !== 'measurement' && isActive && <p className="mt-1 pl-6 text-[10px] text-[var(--shop-muted)]">対象: {SLOT_LABELS[state.activeSlot]} ・ {SLOT_DETAILS[state.activeSlot]}</p>}
          </div>

          {!isActive ? (
            <button type="button" onClick={controller.start} disabled={!isSupported} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--shop-blue)] px-4 py-3 text-sm font-black text-[#06202e] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" data-testid="guided-capture-start">
              <Sparkles className="h-4 w-4" aria-hidden="true" />AI撮影アシスタントを開始
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(state.connectionState === 'disconnected' || state.phase === 'fallback') && <button type="button" onClick={controller.retryConnection} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--shop-blue)] px-3 py-2.5 text-xs font-black text-white hover:bg-[var(--shop-blue)]/10" data-testid="guided-capture-reconnect"><RefreshCw className="h-4 w-4" aria-hidden="true" />再接続</button>}
              <button type="button" onClick={controller.stop} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-[var(--shop-muted)] hover:text-white" data-testid="guided-capture-stop"><X className="h-4 w-4" aria-hidden="true" />アシスタントを終了</button>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={onManualCamera} disabled={!canAddMedia || isBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white hover:border-[var(--shop-blue)] disabled:cursor-not-allowed disabled:opacity-40" data-testid="guided-capture-manual-camera"><Camera className="h-4 w-4 text-[var(--shop-blue)]" aria-hidden="true" />手動で撮影</button>
            <button type="button" onClick={onManualAlbum} disabled={!canAddMedia || isBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white hover:border-[var(--shop-blue)] disabled:cursor-not-allowed disabled:opacity-40" data-testid="guided-capture-manual-album"><ImagePlus className="h-4 w-4 text-[var(--shop-blue)]" aria-hidden="true" />アルバムから追加</button>
          </div>

          {allImageSlotsCaptured(state.slots) && state.slots.measurement.status !== 'approved' && (
            <div className="space-y-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3" data-testid="guided-capture-measurement-editor">
              <div>
                <p className="flex items-center gap-2 text-xs font-black text-white"><Ruler className="h-4 w-4 text-[var(--shop-blue)]" aria-hidden="true" />採寸を確認</p>
                <p className="mt-1 text-[10px] leading-5 text-[var(--shop-muted)]">専用マーカーを衣類と同じ平面に置いた4枚目を使います。この画像は出品画像へ保存しません。</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => measurementCameraInputRef.current?.click()} disabled={isBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white hover:border-[var(--shop-blue)] disabled:cursor-not-allowed disabled:opacity-40"><Camera className="h-4 w-4 text-[var(--shop-blue)]" aria-hidden="true" />採寸画像を撮影</button>
                <button type="button" onClick={() => measurementAlbumInputRef.current?.click()} disabled={isBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white hover:border-[var(--shop-blue)] disabled:cursor-not-allowed disabled:opacity-40"><ImagePlus className="h-4 w-4" aria-hidden="true" />採寸画像を選択</button>
              </div>
              {measurementPreviewUrl && state.measurementDraft?.endpoints && (
                <figure className="overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)]" data-testid="guided-capture-measurement-preview">
                  <div className="relative">
                    <img src={measurementPreviewUrl} alt="採寸画像" className="block h-auto w-full" />
                    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                      <line x1={state.measurementDraft.endpoints.lengthStart.x} y1={state.measurementDraft.endpoints.lengthStart.y} x2={state.measurementDraft.endpoints.lengthEnd.x} y2={state.measurementDraft.endpoints.lengthEnd.y} stroke="#55d6ff" strokeWidth="0.008" />
                      <line x1={state.measurementDraft.endpoints.widthStart.x} y1={state.measurementDraft.endpoints.widthStart.y} x2={state.measurementDraft.endpoints.widthEnd.x} y2={state.measurementDraft.endpoints.widthEnd.y} stroke="#a7f3d0" strokeWidth="0.008" />
                      {[state.measurementDraft.endpoints.lengthStart, state.measurementDraft.endpoints.lengthEnd].map((point, index) => <circle key={`length-point-${index}`} cx={point.x} cy={point.y} r="0.018" fill="#06202e" stroke="#55d6ff" strokeWidth="0.006" />)}
                      {[state.measurementDraft.endpoints.widthStart, state.measurementDraft.endpoints.widthEnd].map((point, index) => <circle key={`width-point-${index}`} cx={point.x} cy={point.y} r="0.018" fill="#06202e" stroke="#a7f3d0" strokeWidth="0.006" />)}
                    </svg>
                  </div>
                  <figcaption className="px-3 py-2 text-[10px] text-[var(--shop-muted)]">水色が着丈、緑色が身幅の端点です。画像はこのセッション内だけで扱います。</figcaption>
                </figure>
              )}
              {state.measurementDraft?.endpoints && <p className="text-[10px] text-[var(--shop-muted)]" role="status">AIが4端点を提案しました。端末内で射影補正・cm換算を行い、必要なら端点を修正してから承認してください。</p>}
              {state.measurementDraft?.endpoints && (
                <fieldset className="space-y-2 rounded-lg border border-[var(--shop-border)] p-3" data-testid="guided-capture-measurement-endpoints">
                  <legend className="px-1 text-[10px] font-black text-white">端点を編集（正規化座標 0〜1）</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {MEASUREMENT_ENDPOINTS.map(({ key, label }) => {
                      const point = state.measurementDraft?.endpoints?.[key];
                      if (!point) return null;
                      return <div key={key} className="rounded-md bg-[var(--shop-surface)] p-2"><p className="text-[10px] font-bold text-[var(--shop-muted)]">{label}</p><div className="mt-1 grid grid-cols-2 gap-2"><label className="text-[10px] text-[var(--shop-muted)]">X<input type="number" min="0" max="1" step="0.001" inputMode="decimal" value={point.x} onChange={(event) => updateEndpoint(key, 'x', event.target.value)} aria-label={`${label} X`} className="mt-1 min-h-10 w-full rounded-md border border-[var(--shop-border)] bg-[var(--shop-bg)] px-2 text-xs font-bold text-white outline-none focus:border-[var(--shop-blue)]" /></label><label className="text-[10px] text-[var(--shop-muted)]">Y<input type="number" min="0" max="1" step="0.001" inputMode="decimal" value={point.y} onChange={(event) => updateEndpoint(key, 'y', event.target.value)} aria-label={`${label} Y`} className="mt-1 min-h-10 w-full rounded-md border border-[var(--shop-border)] bg-[var(--shop-bg)] px-2 text-xs font-bold text-white outline-none focus:border-[var(--shop-blue)]" /></label></div></div>;
                    })}
                  </div>
                </fieldset>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-[10px] font-bold text-[var(--shop-muted)]">5cmマーカーの1辺 (px)<input type="number" min="1" max="100000" step="0.1" inputMode="decimal" value={state.measurementDraft?.markerSidePx ?? ''} onChange={(event) => controller.updateMeasurement({ markerSidePx: event.target.value === '' ? null : Number(event.target.value) })} aria-describedby="guided-capture-marker-help" className="mt-1 min-h-11 w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 text-sm font-bold text-white outline-none focus:border-[var(--shop-blue)]" /></label>
                <div id="guided-capture-marker-help" className="sm:col-span-2 rounded-lg bg-[var(--shop-surface)] p-2 text-[10px] leading-5 text-[var(--shop-muted)]">画像内の既知マーカーの一辺をpxで入力すると、4端点との距離をブラウザでcm換算します。検出値がない場合は、下の着丈・身幅を手入力できます。</div>
              </div>
              {state.measurementDraft?.endpoints && (
                <details className="rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3" data-testid="guided-capture-projection-editor">
                  <summary className="cursor-pointer text-[10px] font-bold text-white">射影補正（四隅を指定・任意）</summary>
                  <p className="mt-2 text-[10px] leading-5 text-[var(--shop-muted)]">採寸平面の四隅を、左上→右上→右下→左下の順で0〜1入力します。補正値は端末内だけで使い、APIや下書きには送信しません。</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {PROJECTION_CORNER_LABELS.map((label, index) => {
                      const point = state.measurementDraft?.projectionCorners?.[index] ?? DEFAULT_PROJECTION_CORNERS[index];
                      return <div key={label} className="rounded-md bg-[var(--shop-bg)] p-2"><p className="text-[10px] font-bold text-[var(--shop-muted)]">{label}</p><div className="mt-1 grid grid-cols-2 gap-2"><label className="text-[10px] text-[var(--shop-muted)]">X<input type="number" min="0" max="1" step="0.001" inputMode="decimal" value={point.x} onChange={(event) => updateProjectionCorner(index, 'x', event.target.value)} aria-label={`射影補正 ${label} X`} className="mt-1 min-h-10 w-full rounded-md border border-[var(--shop-border)] bg-[var(--shop-surface)] px-2 text-xs font-bold text-white outline-none focus:border-[var(--shop-blue)]" /></label><label className="text-[10px] text-[var(--shop-muted)]">Y<input type="number" min="0" max="1" step="0.001" inputMode="decimal" value={point.y} onChange={(event) => updateProjectionCorner(index, 'y', event.target.value)} aria-label={`射影補正 ${label} Y`} className="mt-1 min-h-10 w-full rounded-md border border-[var(--shop-border)] bg-[var(--shop-surface)] px-2 text-xs font-bold text-white outline-none focus:border-[var(--shop-blue)]" /></label></div></div>;
                    })}
                  </div>
                  <button type="button" onClick={() => controller.updateMeasurement({ projectionCorners: null })} className="mt-2 min-h-10 rounded-lg border border-[var(--shop-border)] px-3 py-2 text-[10px] font-bold text-[var(--shop-muted)] hover:border-[var(--shop-blue)] hover:text-white">射影補正をクリア</button>
                </details>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-bold text-[var(--shop-muted)]">着丈 (cm)<input type="number" min="20" max="100" step="0.1" inputMode="decimal" value={state.measurementDraft?.lengthCm ?? ''} onChange={(event) => controller.updateMeasurement({ lengthCm: event.target.value === '' ? null : Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 text-sm font-bold text-white outline-none focus:border-[var(--shop-blue)]" /></label>
                <label className="text-[10px] font-bold text-[var(--shop-muted)]">身幅 (cm)<input type="number" min="20" max="80" step="0.1" inputMode="decimal" value={state.measurementDraft?.widthCm ?? ''} onChange={(event) => controller.updateMeasurement({ widthCm: event.target.value === '' ? null : Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 text-sm font-bold text-white outline-none focus:border-[var(--shop-blue)]" /></label>
              </div>
              <button type="button" onClick={() => controller.approveMeasurement()} disabled={!measurementReady} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--shop-blue)] bg-[var(--shop-blue)]/10 px-3 py-2.5 text-xs font-black text-white hover:bg-[var(--shop-blue)]/20 disabled:cursor-not-allowed disabled:opacity-40" data-testid="guided-capture-approve-measurement"><Ruler className="h-4 w-4 text-[var(--shop-blue)]" aria-hidden="true" />採寸値を明示承認</button>
              <input ref={measurementCameraInputRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onMeasurementFile} />
              <input ref={measurementAlbumInputRef} type="file" accept="image/*" className="sr-only" onChange={onMeasurementFile} />
            </div>
          )}

          {state.phase === 'review' && approvedMeasurement && (
            <div className="space-y-3 rounded-lg border border-[var(--shop-blue)]/40 bg-[var(--shop-blue)]/10 p-3" data-testid="guided-capture-review">
              <div>
                <p className="flex items-center gap-2 text-xs font-black text-white"><ShieldCheck className="h-4 w-4 text-[var(--shop-blue)]" aria-hidden="true" />撮影内容を最終確認</p>
                <p className="mt-1 text-[10px] leading-5 text-[var(--shop-muted)]">3枚の写真と採寸値を確認し、明示承認してから背景編集・出品へ進みます。</p>
              </div>
              <div className="grid grid-cols-3 gap-2" aria-label="承認前の撮影写真">
                {IMAGE_SLOTS.map((slot) => {
                  const progress = state.slots[slot];
                  return <figure key={slot} className="overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)]">
                    {progress.previewUrl ? <img src={progress.previewUrl} alt={`${SLOT_LABELS[slot]}の確認画像`} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center text-[10px] text-[var(--shop-muted)]">画像なし</div>}
                    <figcaption className="truncate px-2 py-1.5 text-[10px] font-bold text-white">{SLOT_LABELS[slot]}</figcaption>
                  </figure>;
                })}
              </div>
              <div className="rounded-lg bg-[var(--shop-bg)] p-3 text-xs text-[var(--shop-muted)]">
                <div className="flex justify-between gap-3"><span>着丈</span><strong className="text-white">{approvedMeasurement.lengthCm.toFixed(1)} cm</strong></div>
                <div className="mt-1 flex justify-between gap-3"><span>身幅</span><strong className="text-white">{approvedMeasurement.widthCm.toFixed(1)} cm</strong></div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={handleRetakeMeasurement} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white hover:border-[var(--shop-blue)]" data-testid="guided-capture-retake-measurement"><Ruler className="h-4 w-4 text-[var(--shop-blue)]" aria-hidden="true" />採寸をやり直す</button>
                <button type="button" onClick={controller.approveCapture} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--shop-blue)] px-3 py-2.5 text-xs font-black text-[#06202e] hover:brightness-110" data-testid="guided-capture-approve-review"><Check className="h-4 w-4" aria-hidden="true" />写真・採寸を承認</button>
              </div>
            </div>
          )}

          {state.phase === 'ready' && (
            <div className="space-y-2 rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-3" role="status" data-testid="guided-capture-ready">
              <p className="flex items-center gap-2 text-xs font-black text-emerald-100"><ShieldCheck className="h-4 w-4" aria-hidden="true" />写真・採寸の承認が完了しました</p>
              <p className="text-[10px] leading-5 text-emerald-100/80">背景生成画像は承認されるまで出品データへ渡しません。現在の通常の出品画像フローも変更されません。</p>
              <button type="button" onClick={handleRetakeMeasurement} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-300/30 px-3 py-2 text-[10px] font-bold text-emerald-100 hover:bg-emerald-400/10" data-testid="guided-capture-edit-measurement"><Ruler className="h-3.5 w-3.5" aria-hidden="true" />採寸を見直す</button>
            </div>
          )}
          {state.phase === 'ready' && <BackgroundEditPanel original={frontOriginal} originalPreviewUrl={frontPreviewUrl} onApproved={onBackgroundApproved} />}
          <p className="flex items-start gap-2 text-[10px] leading-5 text-[var(--shop-muted)]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--shop-blue)]" aria-hidden="true" />撮影途中のsessionデータはこの画面内だけで扱います。measurement画像・AI途中結果・未承認背景は出品画像に含めません。</p>
        </div>
      )}
    </section>
  );
};
