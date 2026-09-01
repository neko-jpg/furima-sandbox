'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CircleHelp,
  ImagePlus,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  SwitchCamera,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useDialogFocusTrap } from '../../../components/ui/useDialogFocusTrap';
import type { ConnectionState, SessionSlot, SlotProgress, TransportKind } from './contracts';
import {
  assessGrayscaleImageQuality,
  createFrameDifferenceTracker,
  createFrameScheduler,
  rgbaToGrayscale,
  toPixelRoi,
  type GrayFrame,
  type LocalGuidanceCode,
  type NormalizedRect,
  type VideoFrameSource,
} from '../core';
import {
  CAPTURE_CONNECTION_LABELS,
  CAPTURE_SLOT_DETAILS,
  CAPTURE_SLOT_LABELS,
  CAPTURE_SLOT_ORDER,
  getSlotStatusLabel,
  isCaptureSlotSelectable,
} from './captureUiConstants';

export interface GuidedCaptureCameraProps {
  slot: SessionSlot;
  phaseLabel: string;
  progress: Record<SessionSlot, SlotProgress>;
  connectionState: ConnectionState;
  transport: TransportKind | null;
  guidanceMessage: string;
  browserOffline: boolean;
  onLocalGuidance?: (candidate: { shot: SessionSlot; code: LocalGuidanceCode; expiresAt: number } | null) => void;
  onCapture: (file: File) => Promise<boolean> | boolean;
  onStreamReady?: (stream: MediaStream) => void | Promise<void>;
  onStreamStopped?: () => void | Promise<void>;
  onChooseAlbum: () => void;
  onClose: () => void;
  onSelectSlot: (slot: SessionSlot) => void;
  onRetakeSlot: (slot: SessionSlot) => void;
  onRetryConnection: () => void;
}

type CameraState = 'requesting' | 'ready' | 'permission' | 'missing' | 'busy' | 'unsupported' | 'error';
type TorchTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
  applyConstraints: (constraints?: MediaTrackConstraints) => Promise<void>;
};

const cameraErrorCopy: Record<Exclude<CameraState, 'requesting' | 'ready'>, string> = {
  permission: 'カメラの使用が許可されていません。ブラウザのサイト設定でカメラを許可してから再試行してください。',
  missing: '利用できるカメラが見つかりません。アルバムから写真を追加できます。',
  busy: 'カメラを他のアプリが使用中です。他のカメラ画面を閉じて再試行してください。',
  unsupported: 'このブラウザではカメラを利用できません。アルバムから写真を追加できます。',
  error: 'カメラを起動できませんでした。権限を確認するか、アルバムから写真を追加してください。',
};

const cameraStateFromError = (error: unknown): Exclude<CameraState, 'requesting' | 'ready'> => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return 'permission';
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return 'missing';
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return 'busy';
    if (error.name === 'SecurityError') return 'permission';
  }
  return 'error';
};

const connectionTone = (connectionState: ConnectionState, browserOffline: boolean): string => {
  if (browserOffline || connectionState === 'disconnected') return 'is-warning';
  if (connectionState === 'connected') return 'is-success';
  return 'is-neutral';
};

const slotTone = (progress: SlotProgress, active: boolean): string => {
  if (active) return 'is-active';
  if (progress.status === 'captured' || progress.status === 'approved') return 'is-complete';
  if (progress.status === 'active') return 'is-pending-active';
  return 'is-pending';
};

const captureVideoFrame = async (video: HTMLVideoElement, slot: SessionSlot): Promise<File> => {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('camera-frame-not-ready');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('camera-canvas-unavailable');
  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('camera-frame-empty');
  return new File([blob], `guided-${slot}-${Date.now()}.jpg`, { type: 'image/jpeg' });
};

const LOCAL_GUIDES: Readonly<Record<SessionSlot, NormalizedRect>> = {
  front: { x: 0.1, y: 0.08, width: 0.8, height: 0.84 },
  back: { x: 0.1, y: 0.08, width: 0.8, height: 0.84 },
  tag: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  measurement: { x: 0.06, y: 0.06, width: 0.88, height: 0.88 },
};

const LOCAL_ANALYSIS_MAX_EDGE = 320;

const readLocalQualityFrame = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  slot: SessionSlot,
): GrayFrame | undefined => {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) return undefined;
  const displayWidth = video.clientWidth || video.offsetWidth || videoWidth;
  const displayHeight = video.clientHeight || video.offsetHeight || videoHeight;
  const roi = toPixelRoi({
    guide: LOCAL_GUIDES[slot],
    display: { width: displayWidth, height: displayHeight },
    video: { width: videoWidth, height: videoHeight },
    objectFit: 'cover',
  });
  if (!roi) return undefined;
  const scale = Math.min(1, LOCAL_ANALYSIS_MAX_EDGE / Math.max(roi.width, roi.height));
  const width = Math.max(2, Math.round(roi.width * scale));
  const height = Math.max(2, Math.round(roi.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  return { width, height, pixels: rgbaToGrayscale(rgba, width, height) };
};

const ConnectionBadge: React.FC<{ connectionState: ConnectionState; transport: TransportKind | null; browserOffline: boolean }> = ({ connectionState, transport, browserOffline }) => {
  const disconnected = browserOffline || connectionState === 'disconnected';
  const connecting = connectionState === 'connecting' || connectionState === 'reconnecting';
  const Icon = disconnected ? WifiOff : connecting ? RefreshCw : Wifi;
  const label = browserOffline ? '端末がオフライン' : CAPTURE_CONNECTION_LABELS[connectionState];
  return (
    <span className={`guided-capture-camera__connection ${connectionTone(connectionState, browserOffline)}`} data-testid="guided-capture-camera-connection">
      <Icon className={connecting && !disconnected ? 'guided-capture-spin' : undefined} aria-hidden="true" />
      <span>{label}</span>
      {transport && !browserOffline && <span className="guided-capture-camera__transport">{transport === 'live' ? 'LIVE' : 'FIXTURE'}</span>}
    </span>
  );
};

const CameraProgress: React.FC<Pick<GuidedCaptureCameraProps, 'slot' | 'progress' | 'onSelectSlot'>> = ({ slot, progress, onSelectSlot }) => (
  <ol className="guided-capture-camera__progress" aria-label="撮影アシスタントの進捗" data-testid="guided-capture-camera-progress">
    {CAPTURE_SLOT_ORDER.map((candidate, index) => {
      const candidateProgress = progress[candidate];
      const isActive = slot === candidate;
      const isSelectable = isCaptureSlotSelectable(progress, candidate, true);
      return (
        <li key={candidate} className={`guided-capture-camera__progress-item ${isActive ? 'is-current' : ''}`}>
          <button
            type="button"
            className={`guided-capture-camera__progress-button ${slotTone(candidateProgress, isActive)}`}
            onClick={() => onSelectSlot(candidate)}
            disabled={!isSelectable}
            aria-current={isActive ? 'step' : undefined}
            aria-label={`${index + 1} ${CAPTURE_SLOT_LABELS[candidate]}、${getSlotStatusLabel(candidateProgress)}`}
          >
            <span className="guided-capture-camera__progress-number">
              {candidateProgress.status === 'captured' || candidateProgress.status === 'approved' ? <Check aria-hidden="true" /> : index + 1}
            </span>
            <span className="guided-capture-camera__progress-label">{CAPTURE_SLOT_LABELS[candidate]}</span>
          </button>
        </li>
      );
    })}
  </ol>
);

const CameraHelp: React.FC<{ open: boolean }> = ({ open }) => {
  if (!open) return null;
  return (
    <div className="guided-capture-camera__help" id="guided-capture-camera-help" data-testid="guided-capture-camera-help">
      <p className="guided-capture-camera__help-title"><CircleHelp aria-hidden="true" />きれいに撮るコツ</p>
      <ul>
        <li>衣類全体が枠に入り、床と平行になるようにします。</li>
        <li>明るい場所で、影や反射が少ない状態にします。</li>
        <li>案内が「撮影できます」になったら、端末を止めてシャッターを押します。</li>
      </ul>
    </div>
  );
};

export const GuidedCaptureCamera: React.FC<GuidedCaptureCameraProps> = ({
  slot,
  phaseLabel,
  progress,
  connectionState,
  transport,
  guidanceMessage,
  browserOffline,
  onLocalGuidance,
  onCapture,
  onStreamReady,
  onStreamStopped,
  onChooseAlbum,
  onClose,
  onSelectSlot,
  onRetakeSlot,
  onRetryConnection,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const localSchedulerRef = useRef<ReturnType<typeof createFrameScheduler<GrayFrame>> | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const [cameraState, setCameraState] = useState<CameraState>('requesting');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);

  const stopLocalAnalysis = useCallback(() => {
    localSchedulerRef.current?.stop();
    localSchedulerRef.current = null;
    onLocalGuidance?.(null);
  }, [onLocalGuidance]);

  const stopStream = useCallback(() => {
    stopLocalAnalysis();
    const stream = streamRef.current;
    stream?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchSupported(false);
    setTorchOn(false);
    if (stream && onStreamStopped) void Promise.resolve(onStreamStopped()).catch(() => undefined);
  }, [onStreamStopped, stopLocalAnalysis]);

  const requestCamera = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    stopStream();
    setCameraState('requesting');
    setCameraMessage(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] as TorchTrack | undefined;
      const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchSupported(capabilities?.torch === true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          if (mountedRef.current && requestId === requestIdRef.current) {
            setCameraState('error');
            setCameraMessage('カメラ映像を再生できませんでした。もう一度試すか、アルバムから写真を追加してください。');
          }
          return;
        }
      }
      setCameraState('ready');
      if (onStreamReady) {
        void Promise.resolve(onStreamReady(stream)).catch(() => {
          if (mountedRef.current) setCameraMessage('AIへの映像共有は利用できませんが、端末内で撮影を続けられます。');
        });
      }
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setCameraState(cameraStateFromError(error));
    }
  }, [facingMode, onStreamReady, stopStream]);

  useDialogFocusTrap(dialogRef, true, onClose);

  useEffect(() => {
    mountedRef.current = true;
    const requestTimer = window.setTimeout(() => { void requestCamera(); }, 0);
    return () => {
      window.clearTimeout(requestTimer);
      mountedRef.current = false;
      requestIdRef.current += 1;
      stopStream();
    };
  }, [requestCamera, stopStream]);

  useEffect(() => {
    if (cameraState !== 'ready' || !onLocalGuidance) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const notifyUnavailable = () => {
      queueMicrotask(() => {
        if (mountedRef.current) setCameraMessage('端末内の品質チェックを利用できません。固定ガイドと手動撮影を続けられます。');
      });
    };
    if (!context) {
      notifyUnavailable();
      return undefined;
    }
    const tracker = createFrameDifferenceTracker();
    let scheduler: ReturnType<typeof createFrameScheduler<GrayFrame>> | null = null;
    let reportedError = false;
    try {
      scheduler = createFrameScheduler<GrayFrame>({
        video: video as unknown as VideoFrameSource,
        readFrame: () => readLocalQualityFrame(video, canvas, context, slot),
        onFrame: (frame) => {
          const quality = assessGrayscaleImageQuality(frame.pixels as Uint8ClampedArray, frame.width, frame.height);
          const movement = tracker.update(frame);
          const code: LocalGuidanceCode | null = quality.issue ?? (movement.changed ? 'HOLD_STEADY' : null);
          const now = Date.now();
          onLocalGuidance(code ? { shot: slot, code, expiresAt: now + 750 } : null);
        },
        onError: () => {
          if (reportedError) return;
          reportedError = true;
          setCameraMessage('端末内の品質チェックを利用できません。固定ガイドと手動撮影を続けられます。');
          scheduler?.stop();
          scheduler = null;
          localSchedulerRef.current = null;
          onLocalGuidance(null);
        },
      });
      localSchedulerRef.current = scheduler;
      scheduler.start();
    } catch {
      notifyUnavailable();
      onLocalGuidance(null);
      scheduler?.stop();
      localSchedulerRef.current = null;
      return undefined;
    }
    return () => {
      scheduler?.stop();
      if (localSchedulerRef.current === scheduler) localSchedulerRef.current = null;
      onLocalGuidance(null);
    };
  }, [cameraState, onLocalGuidance, slot]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0] as TorchTrack | undefined;
    if (!track || !torchSupported) {
      setCameraMessage('この端末ではライト切替に対応していません。撮影はそのまま続けられます。');
      return;
    }
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
      setCameraMessage(next ? 'ライトをオンにしました。' : 'ライトをオフにしました。');
    } catch {
      setCameraMessage('ライトを切り替えられませんでした。撮影はそのまま続けられます。');
    }
  };

  const handleCapture = async () => {
    if (cameraState !== 'ready' || isCapturing || progress[slot].status === 'approved') return;
    setIsCapturing(true);
    setCameraMessage(null);
    try {
      const video = videoRef.current;
      if (!video) throw new Error('camera-video-unavailable');
      const file = await captureVideoFrame(video, slot);
      const accepted = await onCapture(file);
      if (!accepted) {
        setCameraMessage('写真を出品フローへ渡せませんでした。アルバムから追加することもできます。');
        return;
      }
      setCameraMessage('写真を保存しました。AIが画像を検証しています。');
      window.setTimeout(() => {
        if (mountedRef.current) onClose();
      }, 240);
    } catch (error) {
      if (error instanceof Error && error.message === 'camera-frame-not-ready') {
        setCameraMessage('カメラの準備中です。少し待ってからもう一度押してください。');
      } else {
        setCameraMessage('撮影画像を作成できませんでした。もう一度お試しください。');
      }
    } finally {
      if (mountedRef.current) setIsCapturing(false);
    }
  };

  const handleAlbum = () => {
    onClose();
    onChooseAlbum();
  };

  const handleRetry = () => {
    setCameraMessage(null);
    void requestCamera();
  };

  const selectedProgress = progress[slot];
  const isCompleted = selectedProgress.status === 'captured' || selectedProgress.status === 'approved';
  const isRetryableSlot = slot !== 'measurement' && selectedProgress.status !== 'approved' && (isCompleted || Boolean(selectedProgress.mediaId));
  const cameraError = cameraState !== 'requesting' && cameraState !== 'ready' ? cameraErrorCopy[cameraState] : null;

  return (
    <div className="guided-capture-camera" role="dialog" aria-modal="true" aria-labelledby="guided-capture-camera-title" data-testid="guided-capture-camera">
      <div ref={dialogRef} className="guided-capture-camera__surface">
        <header className="guided-capture-camera__header">
          <div className="guided-capture-camera__header-row">
            <button type="button" className="guided-capture-icon-button" onClick={onClose} aria-label="カメラを閉じる" data-testid="guided-capture-camera-back">
              <ArrowLeft aria-hidden="true" />
            </button>
            <div className="guided-capture-camera__heading">
              <p className="guided-capture-eyebrow">AI撮影アシスタント</p>
              <h2 id="guided-capture-camera-title">{CAPTURE_SLOT_LABELS[slot]}を撮影</h2>
            </div>
            <button
              type="button"
              className={`guided-capture-icon-button ${isHelpOpen ? 'is-selected' : ''}`}
              onClick={() => setIsHelpOpen((current) => !current)}
              aria-expanded={isHelpOpen}
              aria-controls="guided-capture-camera-help"
              aria-label="撮影のコツを表示"
              data-testid="guided-capture-camera-help-toggle"
            >
              <CircleHelp aria-hidden="true" />
            </button>
          </div>
          <CameraProgress slot={slot} progress={progress} onSelectSlot={onSelectSlot} />
        </header>

        <main className="guided-capture-camera__main">
          <div className="guided-capture-camera__preview" data-testid="guided-capture-camera-preview">
            <video ref={videoRef} className="guided-capture-camera__video" playsInline muted aria-label={`${CAPTURE_SLOT_LABELS[slot]}のカメラプレビュー`} />
            <div className="guided-capture-camera__scrim" aria-hidden="true" />
            <div className="guided-capture-camera__frame" aria-hidden="true">
              <span className="guided-capture-camera__corner top-left" />
              <span className="guided-capture-camera__corner top-right" />
              <span className="guided-capture-camera__corner bottom-right" />
              <span className="guided-capture-camera__corner bottom-left" />
              <span className="guided-capture-camera__crosshair" />
            </div>
            {cameraError && (
              <div className="guided-capture-camera__error-card" role="alert" data-testid="guided-capture-camera-permission">
                <span className="guided-capture-camera__error-icon">{cameraState === 'permission' ? <ShieldAlert aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}</span>
                <h3>{cameraState === 'permission' ? 'カメラの許可が必要です' : 'カメラを利用できません'}</h3>
                <p>{cameraError}</p>
                <div className="guided-capture-camera__error-actions">
                  <button type="button" className="guided-capture-button is-primary" onClick={handleRetry} data-testid="guided-capture-camera-retry"><RefreshCw aria-hidden="true" />カメラを再試行</button>
                  <button type="button" className="guided-capture-button is-secondary" onClick={handleAlbum}><ImagePlus aria-hidden="true" />アルバムから追加</button>
                </div>
              </div>
            )}
            {cameraState === 'requesting' && (
              <div className="guided-capture-camera__loading" role="status" aria-live="polite">
                <LoaderCircle className="guided-capture-spin" aria-hidden="true" />カメラを準備しています…
              </div>
            )}
            <div className="guided-capture-camera__preview-meta">
              <ConnectionBadge connectionState={connectionState} transport={transport} browserOffline={browserOffline} />
              <span className="guided-capture-camera__phase"><Sparkles aria-hidden="true" />{phaseLabel}</span>
              <button type="button" className="guided-capture-camera__switch" onClick={() => setFacingMode((current) => current === 'environment' ? 'user' : 'environment')} aria-label="前後カメラを切り替える" data-testid="guided-capture-camera-switch">
                <SwitchCamera aria-hidden="true" />
              </button>
            </div>
            <div className="guided-capture-camera__guidance" role="status" aria-live="polite" aria-atomic="true" data-testid="guided-capture-camera-guidance">
              <Sparkles aria-hidden="true" />
              <span>{guidanceMessage}</span>
            </div>
            <CameraHelp open={isHelpOpen} />
          </div>
        </main>

        <footer className="guided-capture-camera__footer">
          <div className="guided-capture-camera__footer-message" role="status" aria-live="polite" aria-atomic="true">
            {isCapturing ? <><LoaderCircle className="guided-capture-spin" aria-hidden="true" />写真を保存して検証中…</> : cameraMessage ? <><Sparkles aria-hidden="true" />{cameraMessage}</> : browserOffline || connectionState === 'disconnected' ? <><WifiOff aria-hidden="true" />オフラインでも撮影できます。AI検証は接続後に再試行できます。</> : <><Camera aria-hidden="true" />枠内に収めて、端末を止めて撮影してください。</>}
          </div>
          <div className="guided-capture-camera__actions">
            <button type="button" className="guided-capture-camera__tool" onClick={handleToggleTorch} aria-pressed={torchOn} aria-label={torchOn ? 'ライトをオフにする' : 'ライトをオンにする'} data-testid="guided-capture-camera-light">
              <Lightbulb aria-hidden="true" />
              <span>ライト</span>
            </button>
            <button type="button" className="guided-capture-camera__shutter" onClick={handleCapture} disabled={cameraState !== 'ready' || isCapturing || selectedProgress.status === 'approved'} aria-label={`${CAPTURE_SLOT_LABELS[slot]}を撮影`} data-testid="guided-capture-camera-shutter">
              {isCapturing ? <LoaderCircle className="guided-capture-spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}
            </button>
            <button type="button" className="guided-capture-camera__tool" onClick={handleAlbum} aria-label="アルバムから追加" data-testid="guided-capture-camera-album">
              <ImagePlus aria-hidden="true" />
              <span>アルバム</span>
            </button>
          </div>
          <div className="guided-capture-camera__secondary-actions">
            {isRetryableSlot && <button type="button" className="guided-capture-link-button" onClick={() => onRetakeSlot(slot)} data-testid="guided-capture-camera-retake"><RotateCcw aria-hidden="true" />この向きを撮り直す</button>}
            {connectionState === 'disconnected' && <button type="button" className="guided-capture-link-button" onClick={onRetryConnection} data-testid="guided-capture-camera-reconnect"><RefreshCw aria-hidden="true" />AI案内を再接続</button>}
            <span className="guided-capture-camera__slot-hint">{CAPTURE_SLOT_DETAILS[slot]}</span>
            <button type="button" className="guided-capture-link-button is-muted" onClick={onClose} data-testid="guided-capture-camera-cancel"><X aria-hidden="true" />あとで撮る</button>
          </div>
        </footer>
      </div>
    </div>
  );
};
