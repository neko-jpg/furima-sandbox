'use client';

/* Review previews are session-scoped Blob/object URLs; next/image cannot
 * optimize these dynamic URLs, so native <img> is intentional. */
/* eslint-disable @next/next/no-img-element */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Info,
  LoaderCircle,
  RefreshCw,
  Ruler,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { BackgroundEditPanel } from '../../background-edit/BackgroundEditPanel';
import { GuidedCaptureCamera } from './GuidedCaptureCamera';
import { dispatchFileToListingInput } from './captureFileBridge';
import {
  CAPTURE_CONNECTION_LABELS,
  CAPTURE_PHASE_LABELS,
  CAPTURE_SLOT_DETAILS,
  CAPTURE_SLOT_LABELS,
  CAPTURE_SLOT_ORDER,
  IMAGE_CAPTURE_SLOT_ORDER,
  getSlotStatusLabel,
} from './captureUiConstants';
import type {
  ConnectionState,
  MeasurementDraft,
  MeasurementEndpoints,
  MeasurementProjectionCorners,
  SessionSlot,
  SlotProgress,
} from './contracts';
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
  onStreamReady?: (stream: MediaStream) => void | Promise<void>;
  onStreamStopped?: () => void | Promise<void>;
}

const DEFAULT_PROJECTION_CORNERS: MeasurementProjectionCorners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const MEASUREMENT_ENDPOINTS = [
  { key: 'lengthStart', label: '着丈 始点', tone: 'length' },
  { key: 'lengthEnd', label: '着丈 終点', tone: 'length' },
  { key: 'widthStart', label: '身幅 始点', tone: 'width' },
  { key: 'widthEnd', label: '身幅 終点', tone: 'width' },
] as const satisfies ReadonlyArray<{ key: keyof MeasurementEndpoints; label: string; tone: 'length' | 'width' }>;

const PROJECTION_CORNER_LABELS = ['左上', '右上', '右下', '左下'] as const;

const isSupportedClothing = (category: string, subcategory: string): boolean => {
  if (!category) return true;
  if (category !== 'レディース' && category !== 'メンズ') return false;
  return !subcategory || subcategory === 'トップス';
};

const isValidMeasurementValue = (value: number | null | undefined, min: number, max: number): value is number => (
  value !== null && value !== undefined && Number.isFinite(value) && value >= min && value <= max
);

const countCompletedSlots = (slots: Record<SessionSlot, SlotProgress>): number => (
  CAPTURE_SLOT_ORDER.filter((slot) => slots[slot].status === 'captured' || slots[slot].status === 'approved').length
);

const hasAllImageSlotsCaptured = (slots: Record<SessionSlot, SlotProgress>): boolean => (
  IMAGE_CAPTURE_SLOT_ORDER.every((slot) => slots[slot].status === 'captured' || slots[slot].status === 'approved')
);

const getCaptureSlot = (slots: Record<SessionSlot, SlotProgress>, activeSlot: SessionSlot): SessionSlot => {
  const activeProgress = slots[activeSlot];
  if (activeSlot === 'measurement') return 'measurement';
  if (activeProgress.status === 'pending' || activeProgress.status === 'active') return activeSlot;
  return IMAGE_CAPTURE_SLOT_ORDER.find((slot) => slots[slot].status === 'pending' || slots[slot].status === 'active') ?? 'measurement';
};

const slotStatusClass = (progress: SlotProgress, isActive: boolean): string => {
  if (isActive) return 'is-active';
  if (progress.status === 'captured' || progress.status === 'approved') return 'is-complete';
  if (progress.status === 'active') return 'is-pending-active';
  return 'is-pending';
};

const connectionIcon = (connectionState: ConnectionState, browserOffline: boolean): React.ReactNode => {
  if (browserOffline || connectionState === 'disconnected') return <WifiOff aria-hidden="true" />;
  if (connectionState === 'connecting' || connectionState === 'reconnecting') return <RefreshCw className="guided-capture-spin" aria-hidden="true" />;
  return <Wifi aria-hidden="true" />;
};

const normalizedValue = (value: number): string => value.toFixed(3);

interface CoordinateInputProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  ariaLabel: string;
  tone?: 'length' | 'width';
}

const CoordinateInput: React.FC<CoordinateInputProps> = ({ label, value, onCommit, ariaLabel, tone = 'length' }) => {
  const [draft, setDraft] = useState(() => normalizedValue(value));
  const [isFocused, setIsFocused] = useState(false);

  const parsed = draft.trim() === '' ? null : Number(draft);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 1);

  return (
    <label className={`guided-capture-coordinate ${tone}`}>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        max="1"
        step="0.001"
        inputMode="decimal"
        value={isFocused ? draft : normalizedValue(value)}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onFocus={() => { setDraft(normalizedValue(value)); setIsFocused(true); }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const nextValue = Number(next);
          if (next.trim() !== '' && Number.isFinite(nextValue) && nextValue >= 0 && nextValue <= 1) onCommit(nextValue);
        }}
        onBlur={() => {
          setIsFocused(false);
          if (invalid || draft.trim() === '') setDraft(normalizedValue(value));
        }}
      />
    </label>
  );
};

interface CaptureProgressProps {
  slots: Record<SessionSlot, SlotProgress>;
  activeSlot: SessionSlot;
  isActive: boolean;
  onSelectSlot: (slot: SessionSlot) => void;
}

const CaptureProgress: React.FC<CaptureProgressProps> = ({ slots, activeSlot, isActive, onSelectSlot }) => {
  const completed = countCompletedSlots(slots);
  const progressPercent = Math.round((completed / CAPTURE_SLOT_ORDER.length) * 100);
  return (
    <div className="guided-capture-progress-wrap">
      <div className="guided-capture-progress-heading">
        <div><p className="guided-capture-eyebrow">CAPTURE PLAN</p><p className="guided-capture-progress-title">撮影の進み具合</p></div>
        <span className="guided-capture-progress-count" data-testid="guided-capture-progress-count">{completed}/{CAPTURE_SLOT_ORDER.length}</span>
      </div>
      <div className="guided-capture-progress-track" aria-hidden="true"><span style={{ width: `${progressPercent}%` }} /></div>
      <ol className="guided-capture-progress" aria-label="撮影アシスタントの4スロット進捗" data-testid="guided-capture-progress">
        {CAPTURE_SLOT_ORDER.map((slot, index) => {
          const progress = slots[slot];
          const isCurrent = activeSlot === slot;
          const isSelectable = isActive && progress.status !== 'approved';
          return (
            <li key={slot} className={`guided-capture-progress__item ${isCurrent ? 'is-current' : ''}`}>
              <button type="button" className={`guided-capture-progress__button ${slotStatusClass(progress, isCurrent)}`} aria-current={isCurrent ? 'step' : undefined} aria-label={`${index + 1} ${CAPTURE_SLOT_LABELS[slot]}、${getSlotStatusLabel(progress)}`} data-testid={`guided-capture-slot-${slot}`} disabled={!isSelectable} onClick={() => onSelectSlot(slot)}>
                <span className="guided-capture-progress__number">{progress.status === 'captured' || progress.status === 'approved' ? <Check aria-hidden="true" /> : index + 1}</span>
                <span className="guided-capture-progress__copy"><strong>{CAPTURE_SLOT_LABELS[slot]}</strong><small>{getSlotStatusLabel(progress)}</small></span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const GUIDED_CAPTURE_TARGET_CONDITIONS = ['半袖', 'クルーネック', 'トップス', '平置き', '5cmマーカー'] as const;
const GUIDED_CAPTURE_OUT_OF_SCOPE_EXAMPLES = ['長袖', 'パーカー', '襟付き', 'ボトムス', '素材の判定が必要な商品'] as const;

interface GuidedCapturePreparationProps {
  category: string;
  subcategory: string;
  isSupported: boolean;
  isPendingCategory: boolean;
}

const GuidedCapturePreparation: React.FC<GuidedCapturePreparationProps> = ({ category, subcategory, isSupported, isPendingCategory }) => {
  const selectedCategory = [category, subcategory].filter(Boolean).join(' / ');
  return (
    <section className={`guided-capture-preparation ${isSupported ? '' : 'is-outside'}`} data-testid="guided-capture-preparation" aria-labelledby="guided-capture-preparation-title">
      <div className="guided-capture-preparation__heading">
        <div className="guided-capture-section-icon"><Camera aria-hidden="true" /></div>
        <div><p className="guided-capture-eyebrow">BEFORE YOU SHOOT</p><h3 id="guided-capture-preparation-title">このガイドの対象条件を確認</h3><p>素材・袖・襟の細分類は現在のカテゴリ入力に含まれないため、撮影前に対象を確認してください。</p></div>
      </div>
      <div className="guided-capture-preparation__conditions">
        <div className="guided-capture-preparation__condition is-target">
          <p className="guided-capture-preparation__label"><Check aria-hidden="true" />対象条件</p>
          <ul>{GUIDED_CAPTURE_TARGET_CONDITIONS.map((condition) => <li key={condition}>{condition}</li>)}</ul>
        </div>
        <div className="guided-capture-preparation__condition is-outside">
          <p className="guided-capture-preparation__label"><AlertTriangle aria-hidden="true" />対象外の例</p>
          <ul>{GUIDED_CAPTURE_OUT_OF_SCOPE_EXAMPLES.map((condition) => <li key={condition}>{condition}</li>)}</ul>
        </div>
      </div>
      <div className={`guided-capture-preparation__category-note ${isPendingCategory ? 'is-pending' : isSupported ? '' : 'is-outside'}`} role="status">
        <Info aria-hidden="true" />
        {isPendingCategory
          ? <span><strong>カテゴリ未選択でも固定ガイドで進められます。</strong> 表面・裏面・タグ・採寸の順に撮影し、数値を確認してから商品カテゴリを選択してください。カテゴリを選ぶと、AI接続時の案内精度が上がります。</span>
          : <span><strong>現在の選択: {selectedCategory || '未選択'}</strong> {isSupported ? '対象条件に近いトップスは、平置きと5cmマーカーを準備して始めてください。' : 'このカテゴリは対象外です。通常のカメラ／アルバム入力で出品写真を追加してください。'}</span>}
      </div>
    </section>
  );
};

interface MeasurementEditorProps {
  draft: MeasurementDraft | null;
  previewUrl: string | null;
  isBusy: boolean;
  measurementReady: boolean;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  albumInputRef: React.RefObject<HTMLInputElement | null>;
  onCamera: () => void;
  onAlbum: () => void;
  onFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onEndpointCommit: (key: keyof MeasurementEndpoints, axis: 'x' | 'y', value: number) => void;
  onProjectionCommit: (index: number, axis: 'x' | 'y', value: number) => void;
  onClearProjection: () => void;
  onMeasurementChange: (patch: { lengthCm?: number | null; widthCm?: number | null; markerSidePx?: number | null }) => void;
  onApprove: () => void;
}

const MeasurementEditor: React.FC<MeasurementEditorProps> = ({ draft, previewUrl, isBusy, measurementReady, cameraInputRef, albumInputRef, onCamera, onAlbum, onFile, onEndpointCommit, onProjectionCommit, onClearProjection, onMeasurementChange, onApprove }) => {
  const endpoints = draft?.endpoints;
  const projectionCorners = draft?.projectionCorners ?? DEFAULT_PROJECTION_CORNERS;
  return (
    <section className="guided-capture-measurement" data-testid="guided-capture-measurement-editor" aria-labelledby="guided-capture-measurement-title">
      <div className="guided-capture-section-heading"><div className="guided-capture-section-icon is-measurement"><Ruler aria-hidden="true" /></div><div><p className="guided-capture-eyebrow">STEP 4 / REVIEW</p><h3 id="guided-capture-measurement-title">採寸を確認して承認</h3><p>AIの4端点を確認し、必要なら画像上の位置を調整します。ここで承認した数値だけが出品情報に渡ります。</p></div></div>
      <div className="guided-capture-measurement__privacy"><ShieldCheck aria-hidden="true" /><span>採寸画像・端点・補正値はこのセッション内だけで扱います。出品画像には追加されません。</span></div>
      <div className="guided-capture-measurement__inputs"><button type="button" className="guided-capture-button is-secondary" onClick={onCamera} disabled={isBusy} data-testid="guided-capture-measurement-camera"><Camera aria-hidden="true" />採寸画像を撮影</button><button type="button" className="guided-capture-button is-secondary" onClick={onAlbum} disabled={isBusy} data-testid="guided-capture-measurement-album"><ImagePlus aria-hidden="true" />画像を選択</button></div>

      {previewUrl && endpoints ? <figure className="guided-capture-measurement__preview" data-testid="guided-capture-measurement-preview"><div className="guided-capture-measurement__stage"><img src={previewUrl} alt="採寸画像" /><svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><line x1={endpoints.lengthStart.x} y1={endpoints.lengthStart.y} x2={endpoints.lengthEnd.x} y2={endpoints.lengthEnd.y} className="length-line" /><line x1={endpoints.widthStart.x} y1={endpoints.widthStart.y} x2={endpoints.widthEnd.x} y2={endpoints.widthEnd.y} className="width-line" />{[['lengthStart', endpoints.lengthStart], ['lengthEnd', endpoints.lengthEnd], ['widthStart', endpoints.widthStart], ['widthEnd', endpoints.widthEnd]].map(([key, point]) => { const pointValue = point as { x: number; y: number }; return <g key={key as string}><circle cx={pointValue.x} cy={pointValue.y} r="0.022" className={(key as string).startsWith('length') ? 'length-point' : 'width-point'} /><text x={pointValue.x} y={pointValue.y - 0.035} className="point-label">{key === 'lengthStart' ? '着丈始' : key === 'lengthEnd' ? '着丈終' : key === 'widthStart' ? '身幅始' : '身幅終'}</text></g>; })}</svg></div><figcaption><span className="guided-capture-legend length" />着丈 <span className="guided-capture-legend width" />身幅 ・ 点を座標で微調整できます</figcaption></figure> : <div className="guided-capture-measurement__empty" role="status"><Ruler aria-hidden="true" /><span>採寸画像を撮影すると、AIの4端点と換算値がここに表示されます。</span></div>}

      {endpoints && <><div className="guided-capture-inline-status" role="status" aria-live="polite"><Sparkles aria-hidden="true" />AIが4端点を提案しました。数値や位置を確認してから承認してください。</div><fieldset className="guided-capture-coordinate-editor" data-testid="guided-capture-measurement-endpoints"><legend>4端点を編集 <span>正規化座標 0〜1</span></legend><div className="guided-capture-coordinate-grid">{MEASUREMENT_ENDPOINTS.map(({ key, label, tone }) => <div key={key} className={`guided-capture-coordinate-card ${tone}`}><div className="guided-capture-coordinate-title"><span className="guided-capture-coordinate-dot" />{label}</div><div className="guided-capture-coordinate-fields"><CoordinateInput label="X" value={endpoints[key].x} tone={tone} ariaLabel={`${label} X`} onCommit={(value) => onEndpointCommit(key, 'x', value)} /><CoordinateInput label="Y" value={endpoints[key].y} tone={tone} ariaLabel={`${label} Y`} onCommit={(value) => onEndpointCommit(key, 'y', value)} /></div></div>)}</div></fieldset><details className="guided-capture-projection" data-testid="guided-capture-projection-editor"><summary><span><Info aria-hidden="true" />射影補正を調整</span><ChevronRight aria-hidden="true" /></summary><div className="guided-capture-projection__body"><p>採寸平面の四隅を、左上→右上→右下→左下の順で入力します。斜めから撮った画像の補正に使います。</p><div className="guided-capture-projection__grid">{PROJECTION_CORNER_LABELS.map((label, index) => { const point = projectionCorners[index] ?? DEFAULT_PROJECTION_CORNERS[index]; return <div key={label} className="guided-capture-projection__card"><strong>{label}</strong><div><CoordinateInput label="X" value={point.x} ariaLabel={`射影補正 ${label} X`} onCommit={(value) => onProjectionCommit(index, 'x', value)} /><CoordinateInput label="Y" value={point.y} ariaLabel={`射影補正 ${label} Y`} onCommit={(value) => onProjectionCommit(index, 'y', value)} /></div></div>; })}</div><button type="button" className="guided-capture-link-button is-muted" onClick={onClearProjection}>補正を初期化</button></div></details></>}

      <div className="guided-capture-measurement__values"><label><span>着丈</span><div><input type="number" min="20" max="100" step="0.1" inputMode="decimal" value={draft?.lengthCm ?? ''} onChange={(event) => onMeasurementChange({ lengthCm: event.target.value === '' ? null : Number(event.target.value) })} aria-label="着丈（cm）" /><small>cm</small></div></label><label><span>身幅</span><div><input type="number" min="20" max="80" step="0.1" inputMode="decimal" value={draft?.widthCm ?? ''} onChange={(event) => onMeasurementChange({ widthCm: event.target.value === '' ? null : Number(event.target.value) })} aria-label="身幅（cm）" /><small>cm</small></div></label></div>
      <label className="guided-capture-marker-input"><span>5cmマーカーの1辺 <small>任意</small></span><div><input type="number" min="1" max="100000" step="0.1" inputMode="decimal" value={draft?.markerSidePx ?? ''} onChange={(event) => onMeasurementChange({ markerSidePx: event.target.value === '' ? null : Number(event.target.value) })} aria-describedby="guided-capture-marker-help" aria-label="5cmマーカーの1辺（px）" /><small>px</small></div></label><p id="guided-capture-marker-help" className="guided-capture-form-help">既知マーカーの一辺を入力すると、端点間の距離を端末内でcm換算します。換算値がない場合は着丈・身幅を手入力できます。</p>
      <div className={`guided-capture-approval-hint ${measurementReady ? 'is-ready' : ''}`} role="status" aria-live="polite">{measurementReady ? <><Check aria-hidden="true" />承認できる数値です。内容を確認して次へ進めます。</> : <><Info aria-hidden="true" />着丈20〜100cm、身幅20〜80cmの数値を入力してください。</>}</div>
      <button type="button" className="guided-capture-button is-primary is-wide" onClick={onApprove} disabled={!measurementReady || isBusy} data-testid="guided-capture-approve-measurement"><ShieldCheck aria-hidden="true" />採寸値を明示承認</button>
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="sr-only" data-testid="guided-capture-measurement-camera-input" onChange={onFile} /><input ref={albumInputRef} type="file" accept="image/*" className="sr-only" data-testid="guided-capture-measurement-album-input" onChange={onFile} />
    </section>
  );
};

interface GuidedReviewProps {
  slots: Record<SessionSlot, SlotProgress>;
  measurement: { lengthCm: number; widthCm: number };
  onRetakeMeasurement: () => void;
  onApprove: () => void;
}

const GuidedReview: React.FC<GuidedReviewProps> = ({ slots, measurement, onRetakeMeasurement, onApprove }) => (
  <section className="guided-capture-review" data-testid="guided-capture-review" aria-labelledby="guided-capture-review-title">
    <div className="guided-capture-section-heading"><div className="guided-capture-section-icon is-review"><ShieldCheck aria-hidden="true" /></div><div><p className="guided-capture-eyebrow">FINAL CHECK</p><h3 id="guided-capture-review-title">写真と採寸を最終確認</h3><p>この承認を完了するまで、背景編集画像や途中結果は出品データへ渡りません。</p></div></div>
    <div className="guided-capture-review__gallery" aria-label="承認前の撮影写真">{IMAGE_CAPTURE_SLOT_ORDER.map((slot) => { const progress = slots[slot]; return <figure key={slot}>{progress.previewUrl ? <img src={progress.previewUrl} alt={`${CAPTURE_SLOT_LABELS[slot]}の確認画像`} /> : <div className="guided-capture-review__missing">画像なし</div>}<figcaption><span>{CAPTURE_SLOT_LABELS[slot]}</span><small>{getSlotStatusLabel(progress)}</small></figcaption></figure>; })}</div>
    <div className="guided-capture-review__measurements"><div><span>着丈</span><strong>{measurement.lengthCm.toFixed(1)}<small>cm</small></strong></div><div><span>身幅</span><strong>{measurement.widthCm.toFixed(1)}<small>cm</small></strong></div></div>
    <div className="guided-capture-review__actions"><button type="button" className="guided-capture-button is-secondary" onClick={onRetakeMeasurement} data-testid="guided-capture-retake-measurement"><Ruler aria-hidden="true" />採寸をやり直す</button><button type="button" className="guided-capture-button is-primary" onClick={onApprove} data-testid="guided-capture-approve-review"><Check aria-hidden="true" />写真・採寸を承認</button></div>
  </section>
);

const GuidedCapturePanel: React.FC<GuidedCapturePanelProps> = ({ controller, category, subcategory, canAddMedia, isBusy = false, onManualCamera, onManualAlbum, frontOriginal, frontPreviewUrl, onBackgroundApproved, onStreamReady, onStreamStopped }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [browserOffline, setBrowserOffline] = useState(false);
  const [measurementPreviewUrl, setMeasurementPreviewUrl] = useState<string | null>(null);
  const measurementPreviewUrlRef = useRef<string | null>(null);
  const measurementCameraInputRef = useRef<HTMLInputElement>(null);
  const measurementAlbumInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const { state } = controller;

  const isActive = state.phase !== 'idle';
  const isReady = state.phase === 'ready';
  const isSupported = isSupportedClothing(category, subcategory);
  const hasSelectedCategory = Boolean(category || subcategory);
  const isPendingCategory = !hasSelectedCategory || (Boolean(category) && !subcategory);
  const captureSlot = getCaptureSlot(state.slots, state.activeSlot);
  const completedSlots = countCompletedSlots(state.slots);
  const measurementReady = isValidMeasurementValue(state.measurementDraft?.lengthCm, 20, 100) && isValidMeasurementValue(state.measurementDraft?.widthCm, 20, 80);
  const effectiveConnectionState: ConnectionState = browserOffline ? 'disconnected' : state.connectionState;

  useEffect(() => { sessionIdRef.current = state.sessionId; }, [state.sessionId]);

  useEffect(() => {
    if (typeof navigator === 'undefined') return undefined;
    const updateOffline = () => setBrowserOffline(!navigator.onLine);
    const handleOffline = () => { setBrowserOffline(true); if (sessionIdRef.current) controller.reportConnectionState('disconnected', '端末がオフラインです。固定ガイドと手動撮影を利用できます。'); };
    const handleOnline = () => { setBrowserOffline(false); if (sessionIdRef.current) controller.reportConnectionState('reconnecting', '接続が戻りました。再接続を確認してください。'); };
    updateOffline();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => { window.removeEventListener('offline', handleOffline); window.removeEventListener('online', handleOnline); };
  }, [controller]);

  useEffect(() => () => { if (measurementPreviewUrlRef.current) URL.revokeObjectURL(measurementPreviewUrlRef.current); }, []);

  useEffect(() => {
    if (state.phase === 'idle') {
      if (measurementPreviewUrlRef.current) URL.revokeObjectURL(measurementPreviewUrlRef.current);
      measurementPreviewUrlRef.current = null;
    }
  }, [state.phase]);

  const clearMeasurementPreview = useCallback(() => {
    if (measurementPreviewUrlRef.current) URL.revokeObjectURL(measurementPreviewUrlRef.current);
    measurementPreviewUrlRef.current = null;
    setMeasurementPreviewUrl(null);
  }, []);

  const setMeasurementPreview = useCallback((file: Blob) => {
    clearMeasurementPreview();
    const previewUrl = URL.createObjectURL(file);
    measurementPreviewUrlRef.current = previewUrl;
    setMeasurementPreviewUrl(previewUrl);
  }, [clearMeasurementPreview]);

  const onMeasurementFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMeasurementPreview(file);
    void controller.recordMeasurement(file);
  };

  const onMeasurementCamera = () => measurementCameraInputRef.current?.click();
  const onMeasurementAlbum = () => measurementAlbumInputRef.current?.click();

  const guidanceMessage = state.latestGuidance?.message ?? (browserOffline || state.connectionState === 'disconnected' || state.phase === 'fallback'
    ? 'オフラインでも撮影を続けられます。固定ガイドに沿って撮影し、接続後にAI検証を再試行できます。'
    : state.phase === 'ready'
      ? '必要な写真と採寸の承認が揃いました。背景編集も確認してから出品へ進めます。'
      : state.phase === 'measurement'
        ? '採寸画像を平らに置き、衣類とマーカーが同じ平面に入るようにしてください。'
        : `次は「${CAPTURE_SLOT_LABELS[state.activeSlot]}」を撮影します。${CAPTURE_SLOT_DETAILS[state.activeSlot]}`);

  const verifyingSlot = IMAGE_CAPTURE_SLOT_ORDER.find((slot) => state.slots[slot].status === 'active' && Boolean(state.slots[slot].mediaId));
  const statusMessage = state.error && verifyingSlot
    ? `「${CAPTURE_SLOT_LABELS[verifyingSlot]}」の検証結果を確認してください。撮り直すか、手動で続行できます。`
    : state.phase === 'connecting'
      ? '撮影アシスタントを準備しています…'
      : verifyingSlot
        ? `「${CAPTURE_SLOT_LABELS[verifyingSlot]}」をAIが検証中…`
        : state.phase === 'measurement' && !state.measurementDraft
          ? '採寸画像を検証中…'
          : state.phase === 'measurement'
            ? '採寸結果を確認して、承認へ進んでください。'
            : state.phase === 'review'
              ? '承認前の最終確認です。写真と採寸を見直してください。'
              : state.phase === 'ready'
                ? '承認済みです。背景編集を確認して出品へ進めます。'
                : state.phase === 'fallback'
                  ? '固定ガイドで撮影できます。AI案内は接続後に再開できます。'
                  : `「${CAPTURE_SLOT_LABELS[captureSlot]}」の撮影を待っています。`;

  const handleStart = () => { clearMeasurementPreview(); setIsOpen(true); controller.start(); };
  const handleCloseCamera = useCallback(() => setIsCameraOpen(false), []);
  const handleStop = () => { clearMeasurementPreview(); setIsCameraOpen(false); controller.stop(); };

  const handleCameraCapture = useCallback(async (file: File): Promise<boolean> => {
    if (captureSlot === 'measurement') {
      setMeasurementPreview(file);
      await controller.recordMeasurement(file);
      return true;
    }
    return dispatchFileToListingInput(file, 'listing-camera');
  }, [captureSlot, controller, setMeasurementPreview]);

  const handleCameraAlbum = useCallback(() => { setIsCameraOpen(false); if (captureSlot === 'measurement') onMeasurementAlbum(); else onManualAlbum(); }, [captureSlot, onManualAlbum]);

  const handleRetakeSlot = useCallback((slot: SessionSlot) => {
    if (slot !== 'measurement') {
      const mediaId = state.slots[slot].mediaId;
      if (mediaId) controller.removeMedia(mediaId);
    } else controller.retakeMeasurement();
    controller.selectSlot(slot);
    setIsCameraOpen(true);
  }, [controller, state.slots]);

  const handleManualCamera = () => {
    if (isActive && !isReady && captureSlot !== 'measurement') {
      const mediaId = state.slots[captureSlot].mediaId;
      if (mediaId && state.slots[captureSlot].status !== 'approved') controller.removeMedia(mediaId);
      controller.selectSlot(captureSlot);
    }
    onManualCamera();
  };

  const handleManualAlbum = () => {
    if (isActive && !isReady && captureSlot !== 'measurement') {
      const mediaId = state.slots[captureSlot].mediaId;
      if (mediaId && state.slots[captureSlot].status !== 'approved') controller.removeMedia(mediaId);
      controller.selectSlot(captureSlot);
    }
    onManualAlbum();
  };

  const updateEndpoint = (key: keyof MeasurementEndpoints, axis: 'x' | 'y', value: number) => {
    const endpoints = state.measurementDraft?.endpoints;
    if (!endpoints) return;
    controller.updateMeasurement({ endpoints: { ...endpoints, [key]: { ...endpoints[key], [axis]: value } } });
  };

  const updateProjectionCorner = (index: number, axis: 'x' | 'y', value: number) => {
    const corners = [...(state.measurementDraft?.projectionCorners ?? DEFAULT_PROJECTION_CORNERS)] as Array<{ x: number; y: number }>;
    corners[index] = { ...corners[index], [axis]: value };
    controller.updateMeasurement({ projectionCorners: [corners[0], corners[1], corners[2], corners[3]] });
  };

  const handleRetakeMeasurement = () => { clearMeasurementPreview(); controller.retakeMeasurement(); };
  const openCamera = () => { if (!isActive || isReady || isBusy) return; setIsCameraOpen(true); };
  const primaryActionLabel = state.phase === 'measurement' ? '採寸画像を撮る' : state.phase === 'review' ? '撮影を見直す' : 'カメラを開いて撮る';
  const manualActionsEnabled = canAddMedia && !isBusy && !isReady;

  return (
    <section className="guided-capture-panel" data-testid="guided-capture-panel">
      <button type="button" className="guided-capture-panel__toggle" aria-expanded={isOpen} aria-controls="guided-capture-content" data-testid="guided-capture-toggle" onClick={() => setIsOpen((current) => !current)}><span className="guided-capture-panel__mark"><Sparkles aria-hidden="true" /></span><span className="guided-capture-panel__title-wrap"><span className="guided-capture-panel__title">AI撮影アシスタント <span className="guided-capture-panel__optional">任意</span></span><span className="guided-capture-panel__subtitle">衣類の撮影を4ステップでガイド。AIが使えない時も固定ガイドで続けられます。</span></span>{isActive && <span className="guided-capture-panel__phase">{CAPTURE_PHASE_LABELS[state.phase]}</span>}<ChevronDown className={`guided-capture-panel__chevron ${isOpen ? 'is-open' : ''}`} aria-hidden="true" /></button>

      {isOpen && <div id="guided-capture-content" className="guided-capture-panel__content" data-testid="guided-capture-content">
        <div className="guided-capture-hero"><div className="guided-capture-hero__copy"><span className="guided-capture-hero__spark"><Sparkles aria-hidden="true" /></span><div><p className="guided-capture-eyebrow">LISTING PHOTO GUIDE</p><h2>迷わず、きれいに出品写真を揃える</h2><p>表面・裏面・タグ・採寸を順番に確認します。手動撮影とアルバム追加は、READYになる前ならいつでも使えます。</p></div></div><div className="guided-capture-hero__meta"><span className={`guided-capture-connection ${effectiveConnectionState === 'connected' && !browserOffline ? 'is-success' : effectiveConnectionState === 'disconnected' ? 'is-warning' : 'is-neutral'}`} data-testid="guided-capture-connection">{connectionIcon(effectiveConnectionState, browserOffline)}<span>{browserOffline ? '端末がオフライン' : CAPTURE_CONNECTION_LABELS[effectiveConnectionState]}</span></span><span className="guided-capture-transport" data-testid="guided-capture-transport">{state.transport === 'live' ? 'LIVE' : state.transport === 'fixture' ? 'FIXTURE' : '待機中'}</span></div></div>

        <GuidedCapturePreparation category={category} subcategory={subcategory} isSupported={isSupported} isPendingCategory={isPendingCategory} />
        {!isSupported && <div className="guided-capture-notice is-warning" role="status"><AlertTriangle aria-hidden="true" /><span>現在のカテゴリーはAI撮影アシスタントの対象外です。通常のカメラ／アルバム入力はそのまま使えます。</span></div>}
        {isPendingCategory && isSupported && <div className="guided-capture-notice" role="status"><Info aria-hidden="true" /><span>カテゴリー未確定でも撮影を始められます。レディース／メンズ・トップスを選ぶと案内がより正確になります。</span></div>}
        <CaptureProgress slots={state.slots} activeSlot={state.activeSlot} isActive={isActive} onSelectSlot={controller.selectSlot} />
        <div className="guided-capture-live-status" role="status" aria-live="polite" aria-atomic="true" data-testid="guided-capture-status"><span className={`guided-capture-live-status__dot ${state.phase === 'ready' ? 'is-ready' : state.phase === 'connecting' || verifyingSlot ? 'is-working' : ''}`} /><span>{statusMessage}</span><span className="guided-capture-live-status__count">{completedSlots}/4</span></div>
        <div className="guided-capture-guidance" role="status" aria-live="polite" aria-atomic="true" data-testid="guided-capture-guidance"><div className="guided-capture-guidance__icon"><Sparkles aria-hidden="true" /></div><div><p className="guided-capture-eyebrow">{state.latestGuidance ? 'AI ADVICE' : 'NEXT ACTION'}</p><p className="guided-capture-guidance__message">{guidanceMessage}</p><p className="guided-capture-guidance__detail">対象: {CAPTURE_SLOT_LABELS[captureSlot]} ・ {CAPTURE_SLOT_DETAILS[captureSlot]}</p></div></div>
        {state.error && <div className="guided-capture-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{state.error}</span></div>}

        {state.phase === 'idle' ? <button type="button" onClick={handleStart} disabled={!isSupported} className="guided-capture-button is-primary is-wide is-start" data-testid="guided-capture-start"><Sparkles aria-hidden="true" />AI撮影アシスタントを開始<ChevronRight aria-hidden="true" /></button> : <div className="guided-capture-primary-actions"><button type="button" onClick={openCamera} disabled={isReady || isBusy} className="guided-capture-button is-primary" data-testid="guided-capture-open-camera"><Camera aria-hidden="true" />{primaryActionLabel}<span className="guided-capture-button__sub">全画面カメラ</span></button>{(effectiveConnectionState === 'disconnected' || state.phase === 'fallback') && <button type="button" onClick={controller.retryConnection} className="guided-capture-button is-secondary" data-testid="guided-capture-reconnect"><RefreshCw aria-hidden="true" />再接続</button>}<button type="button" onClick={handleStop} className="guided-capture-button is-quiet" data-testid="guided-capture-stop">終了</button></div>}

        <div className="guided-capture-manual"><div className="guided-capture-subheading"><div><p className="guided-capture-eyebrow">MANUAL FALLBACK</p><h3>自分で撮影・追加する</h3></div>{isReady ? <span className="guided-capture-lock"><ShieldCheck aria-hidden="true" />承認済み</span> : <span className="guided-capture-availability"><span />READY前は利用できます</span>}</div><div className="guided-capture-manual__actions"><button type="button" onClick={handleManualCamera} disabled={!manualActionsEnabled} className="guided-capture-button is-secondary" data-testid="guided-capture-manual-camera"><Camera aria-hidden="true" />手動で撮影</button><button type="button" onClick={handleManualAlbum} disabled={!manualActionsEnabled} className="guided-capture-button is-secondary" data-testid="guided-capture-manual-album"><ImagePlus aria-hidden="true" />アルバムから追加</button></div>{isReady && <p className="guided-capture-form-help">撮影・採寸の承認後は内容を変更できません。見直す場合は「採寸を見直す」から戻れます。</p>}{canAddMedia && !isReady && isBusy && <p className="guided-capture-form-help" role="status"><LoaderCircle className="guided-capture-spin" aria-hidden="true" />画像を処理中のため、少しお待ちください。</p>}</div>

        {hasAllImageSlotsCaptured(state.slots) && state.slots.measurement.status !== 'approved' && <MeasurementEditor draft={state.measurementDraft} previewUrl={measurementPreviewUrl} isBusy={isBusy} measurementReady={measurementReady} cameraInputRef={measurementCameraInputRef} albumInputRef={measurementAlbumInputRef} onCamera={onMeasurementCamera} onAlbum={onMeasurementAlbum} onFile={onMeasurementFile} onEndpointCommit={updateEndpoint} onProjectionCommit={updateProjectionCorner} onClearProjection={() => controller.updateMeasurement({ projectionCorners: null })} onMeasurementChange={(patch) => controller.updateMeasurement(patch)} onApprove={() => controller.approveMeasurement()} />}
        {state.phase === 'review' && state.measurement && <GuidedReview slots={state.slots} measurement={state.measurement} onRetakeMeasurement={handleRetakeMeasurement} onApprove={controller.approveCapture} />}
        {state.phase === 'ready' && <section className="guided-capture-ready" role="status" data-testid="guided-capture-ready"><div className="guided-capture-ready__title"><span><ShieldCheck aria-hidden="true" />写真・採寸の承認が完了しました</span><span>4/4</span></div><p>承認済みの写真と採寸だけが出品へ引き渡されます。背景編集画像は下で確認・採用できます。</p><button type="button" onClick={handleRetakeMeasurement} className="guided-capture-link-button" data-testid="guided-capture-edit-measurement"><Ruler aria-hidden="true" />採寸を見直す</button></section>}
        {state.phase === 'ready' && <BackgroundEditPanel original={frontOriginal} originalPreviewUrl={frontPreviewUrl} onApproved={onBackgroundApproved} />}
        <p className="guided-capture-footnote"><ShieldCheck aria-hidden="true" />撮影途中のsessionデータはこの画面内だけで扱います。measurement画像・AI途中結果・未承認背景は出品画像に含めません。</p>
      </div>}

      {isCameraOpen && <GuidedCaptureCamera slot={captureSlot} phaseLabel={CAPTURE_PHASE_LABELS[state.phase]} progress={state.slots} connectionState={effectiveConnectionState} transport={state.transport} guidanceMessage={guidanceMessage} browserOffline={browserOffline} onCapture={handleCameraCapture} onStreamReady={onStreamReady ?? controller.publishCameraStream} onStreamStopped={onStreamStopped} onChooseAlbum={handleCameraAlbum} onClose={handleCloseCamera} onSelectSlot={controller.selectSlot} onRetakeSlot={handleRetakeSlot} onRetryConnection={controller.retryConnection} />}
    </section>
  );
};

export { GuidedCapturePanel };
