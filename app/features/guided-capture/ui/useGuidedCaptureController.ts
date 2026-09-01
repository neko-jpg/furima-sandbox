import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createConfiguredGuidedCaptureAdapter } from './httpAdapter';
import { createFixtureGuidedCaptureAdapter } from './fixtureAdapter';
import { MeasurementEndpointsSchema } from '../../../types/measurement';
import { calculateMeasurement, detectMeasurementMarker, homographyFromCorners, projectRgbaImage, rasterToBlob, readImageDimensions, readImageRaster, type ProjectedRgbaImage } from '../measurement';
import { MarkerWorkerError, MeasurementMarkerWorkerClient } from '../measurement/markerWorker';
import {
  GuidanceHysteresis,
  candidateFromGuidanceEvent,
  createLocalGuidanceCandidate,
  type GuidanceCandidate,
  type LocalGuidanceCode,
} from '../core/guidanceSelector';
import { createCaptureRequestId } from '../core/captureReducer';
import { isCaptureSlotSelectable } from './captureUiConstants';
import { createListingHandoff, type AcceptedGuidedMedia, type ApprovedMeasurement, type CaptureImageSlot, type ConnectionState, type GuidedCaptureAdapter, type GuidedCaptureHandoff, type GuidedCaptureState, type GuidanceEvent, type GuidanceStateEvent, type MeasurementDraft, type MeasurementEndpoints, type MeasurementPatch, type MeasurementRequest, type SessionSlot, type SlotProgress, type CaptureRequest, type GuidedCaptureStep, type ShotAssessment } from './contracts';

export interface GuidedCaptureController {
  state: GuidedCaptureState;
  start: () => void;
  retryConnection: () => void;
  stop: () => void;
  selectSlot: (slot: SessionSlot) => void;
  recordMedia: (media: AcceptedGuidedMedia) => Promise<void>;
  recordMeasurement: (blob: Blob) => Promise<Blob | null>;
  replaceMedia: (slot: CaptureImageSlot, media: AcceptedGuidedMedia) => void;
  removeMedia: (mediaId: string) => void;
  retakeMeasurement: () => void;
  updateMeasurement: (patch: MeasurementPatch) => void;
  approveMeasurement: (measurement?: ApprovedMeasurement, confirmRange?: boolean) => void;
  approveCapture: () => void;
  approveBackground: (previewUrl?: string) => void;
  reportConnectionState: (connectionState: ConnectionState, error?: string) => void;
  reportGuidance: (event: GuidanceEvent) => void;
  reportLocalGuidance: (candidate: { shot: SessionSlot; code: LocalGuidanceCode; message?: string; expiresAt: number } | null) => void;
  reportState: (event: GuidanceStateEvent) => void;
  publishCameraStream: (stream: MediaStream) => Promise<void>;
  getListingHandoff: () => GuidedCaptureHandoff | null;
}

const createSessionId = (): string => {
  const randomUuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `guided-${randomUuid}`;
};

const createInitialSlots = (): Record<SessionSlot, SlotProgress> => ({
  front: { slot: 'front', status: 'pending' },
  back: { slot: 'back', status: 'pending' },
  tag: { slot: 'tag', status: 'pending' },
  measurement: { slot: 'measurement', status: 'pending' },
});

const createInitialState = (): GuidedCaptureState => ({
  sessionId: null,
  phase: 'idle',
  currentStep: 'front',
  connectionState: 'disconnected',
  transport: null,
  activeSlot: 'front',
  slots: createInitialSlots(),
  latestGuidance: null,
  primaryGuidance: null,
  guidanceAcknowledgement: null,
  lastAssessment: null,
  measurementDraft: null,
  measurement: null,
  backgroundApproval: 'not_started',
  error: null,
});

const CAPTURE_SLOTS: readonly CaptureImageSlot[] = ['front', 'back', 'tag'];

const nextPendingCaptureSlot = (slots: Record<SessionSlot, SlotProgress>): CaptureImageSlot | null => CAPTURE_SLOTS.find((slot) => slots[slot].status === 'pending' || slots[slot].status === 'active') ?? null;
const allImageSlotsCaptured = (slots: Record<SessionSlot, SlotProgress>): boolean => CAPTURE_SLOTS.every((slot) => slots[slot].status === 'captured' || slots[slot].status === 'approved');
const allImageSlotsApproved = (slots: Record<SessionSlot, SlotProgress>): boolean => CAPTURE_SLOTS.every((slot) => slots[slot].status === 'approved');
const demoteImageApprovals = (slots: Record<SessionSlot, SlotProgress>): Record<SessionSlot, SlotProgress> => Object.fromEntries(
  Object.entries(slots).map(([slot, progress]) => [
    slot,
    slot === 'measurement' || progress.status !== 'approved'
      ? progress
      : { ...progress, status: 'captured' as const },
  ]),
) as Record<SessionSlot, SlotProgress>;

const RETAKE_INSTRUCTIONS: Readonly<Record<string, string>> = {
  TOO_DARK: '明るい場所へ移動して、影が少ない状態で撮り直してください。',
  TOO_BRIGHT: '反射が少ない場所へ移動して、明るさを落として撮り直してください。',
  TOO_BLURRY: 'ピントが合うまでカメラをゆっくり止めて撮り直してください。',
  BLURRY: 'ピントが合うまでカメラをゆっくり止めて撮り直してください。',
  GARMENT_CROPPED: '衣類全体が入るように少しカメラを離して撮り直してください。',
  TAG_UNREADABLE: 'タグが画面中央に入り、文字が読める距離で撮り直してください。',
  WRONG_SHOT: '指定された向きに衣類を置き、同じステップの写真を撮り直してください。',
};

const issueMessage = (issues: readonly string[]): string => {
  const issue = issues.find((candidate) => candidate.trim() !== '');
  if (!issue) return '撮影結果を確認できませんでした。同じ向きで撮り直してください。';
  return RETAKE_INSTRUCTIONS[issue] ?? `撮影結果を確認してください（${issue}）。同じ向きで撮り直してください。`;
};

const providerMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

const stepForSlot = (slot: SessionSlot, slots: Record<SessionSlot, SlotProgress>): GuidedCaptureStep => {
  if (slot !== 'measurement') return slot;
  return slots.measurement.status === 'captured' || slots.measurement.status === 'approved'
    ? 'measurement-review'
    : 'measurement-preparation';
};

const activeWorkflowPhase = (slot: SessionSlot): 'capturing' | 'measurement' => slot === 'measurement' ? 'measurement' : 'capturing';

const defaultAcceptedAssessment = (slot: CaptureImageSlot): ShotAssessment => ({
  shotType: slot,
  quality: 'ok',
  issues: [],
  missingShots: CAPTURE_SLOTS.filter((candidate) => candidate !== slot),
  nextAction: 'REQUEST_NEXT',
});

const DEFAULT_MEASUREMENT_ENDPOINTS: MeasurementEndpoints = {
  lengthStart: { x: 0.5, y: 0.12 },
  lengthEnd: { x: 0.5, y: 0.88 },
  widthStart: { x: 0.2, y: 0.5 },
  widthEnd: { x: 0.8, y: 0.5 },
};

interface CaptureRequestFence {
  readonly sessionId: string;
  readonly slot: CaptureImageSlot;
  readonly mediaId: string;
  readonly requestId: string;
  readonly sequence: number;
  readonly generation: number;
}

interface MeasurementRequestFence {
  readonly sessionId: string;
  readonly requestId: string;
  readonly sequence: number;
  readonly generation: number;
}

const isFiniteSequence = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const finiteMeasurement = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value) && value > 0;
const isApprovedMeasurement = (value: ApprovedMeasurement | null): value is ApprovedMeasurement => Boolean(
  value
  && finiteMeasurement(value.lengthCm)
  && finiteMeasurement(value.widthCm)
  && (value.source === 'approved_cv' || value.source === 'approved_manual'),
);
const isRecommendedMeasurement = (value: ApprovedMeasurement): boolean => (
  value.lengthCm >= 20
  && value.lengthCm <= 100
  && value.widthCm >= 20
  && value.widthCm <= 80
);

type StateUpdater = (current: GuidedCaptureState) => GuidedCaptureState;

export const useGuidedCaptureController = (adapter?: GuidedCaptureAdapter): GuidedCaptureController => {
  const adapterRef = useRef<GuidedCaptureAdapter | null>(null);
  if (adapterRef.current === null) {
    adapterRef.current = adapter ?? createConfiguredGuidedCaptureAdapter() ?? createFixtureGuidedCaptureAdapter();
  }
  const sessionIdRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const transportSequenceRef = useRef(0);
  const captureGenerationRef = useRef(0);
  const measurementGenerationRef = useRef(0);
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());
  const captureRequestsRef = useRef(new Map<CaptureImageSlot, CaptureRequestFence>());
  const measurementRequestRef = useRef<MeasurementRequestFence | null>(null);
  const connectGenerationRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guidanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guidanceCandidatesRef = useRef(new Map<string, GuidanceCandidate>());
  const guidanceSelectorRef = useRef<GuidanceHysteresis | null>(null);
  if (guidanceSelectorRef.current === null) guidanceSelectorRef.current = new GuidanceHysteresis();
  const awaitingResyncRef = useRef(false);
  const manuallyStoppedRef = useRef(false);
  const suppressConnectionEventsRef = useRef(false);
  const markerWorkerRef = useRef<MeasurementMarkerWorkerClient | null>(null);
  const markerRequestAbortRef = useRef<AbortController | null>(null);
  const connectSessionRef = useRef<(sessionId: string) => void>(() => undefined);
  const guidanceFlushRef = useRef<(now: number) => void>(() => undefined);
  const mountedRef = useRef(true);
  const stateRef = useRef<GuidedCaptureState>(createInitialState());
  const [state, setState] = useState<GuidedCaptureState>(createInitialState);

  const updateState = useCallback((updater: StateUpdater): void => {
    if (!mountedRef.current) return;
    setState((current) => {
      const next = updater(current);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (adapter !== undefined && adapter !== adapterRef.current) {
      connectGenerationRef.current += 1;
      captureGenerationRef.current += 1;
      measurementGenerationRef.current += 1;
      captureRequestsRef.current.clear();
      measurementRequestRef.current = null;
      void adapterRef.current?.disconnect();
      adapterRef.current = adapter;
    }
  }, [adapter]);

  useEffect(() => {
    sessionIdRef.current = state.sessionId;
    stateRef.current = state;
  }, [state]);

  useEffect(() => () => {
    mountedRef.current = false;
    manuallyStoppedRef.current = true;
    connectGenerationRef.current += 1;
    captureGenerationRef.current += 1;
    measurementGenerationRef.current += 1;
    sessionIdRef.current = null;
    sequenceRef.current = 0;
    transportSequenceRef.current = 0;
    captureRequestsRef.current.clear();
    measurementRequestRef.current = null;
    if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
    if (guidanceTimerRef.current !== null) clearTimeout(guidanceTimerRef.current);
    reconnectTimerRef.current = null;
    guidanceTimerRef.current = null;
    guidanceCandidatesRef.current.clear();
    guidanceSelectorRef.current?.reset();
    markerRequestAbortRef.current?.abort();
    markerRequestAbortRef.current = null;
    markerWorkerRef.current?.terminate();
    markerWorkerRef.current = null;
    void adapterRef.current?.disconnect();
  }, []);

  const clearReconnectTimer = useCallback((): void => {
    if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const clearGuidanceTimer = useCallback((): void => {
    if (guidanceTimerRef.current !== null) clearTimeout(guidanceTimerRef.current);
    guidanceTimerRef.current = null;
  }, []);

  const resetGuidance = useCallback((clearState = true): void => {
    clearGuidanceTimer();
    guidanceCandidatesRef.current.clear();
    guidanceSelectorRef.current?.reset();
    if (clearState) {
      updateState((current) => ({
        ...current,
        latestGuidance: null,
        primaryGuidance: null,
        guidanceAcknowledgement: null,
      }));
    }
  }, [clearGuidanceTimer, updateState]);

  const scheduleGuidanceWake = useCallback((): void => {
    clearGuidanceTimer();
    const nextWakeAt = guidanceSelectorRef.current?.nextWakeAt ?? null;
    if (nextWakeAt === null) return;
    const delay = Math.max(0, nextWakeAt - Date.now());
    guidanceTimerRef.current = setTimeout(() => {
      guidanceTimerRef.current = null;
      guidanceFlushRef.current(Date.now());
    }, delay);
  }, [clearGuidanceTimer]);

  const applyGuidance = useCallback((now: number): void => {
    const current = stateRef.current;
    if (!current.sessionId || !Number.isFinite(now) || now < 0) return;
    const selector = guidanceSelectorRef.current;
    if (!selector) return;
    const result = selector.update([...guidanceCandidatesRef.current.values()], now, current.activeSlot);
    const primary = result.primary;
    updateState((next) => next.sessionId === current.sessionId ? {
      ...next,
      latestGuidance: primary?.source === 'agent' ? primary.event ?? null : null,
      primaryGuidance: primary,
      guidanceAcknowledgement: result.acknowledgement,
      error: primary?.code === 'AGENT_UNAVAILABLE'
        ? 'ライブ案内を利用できません。固定ガイドと手動撮影を利用できます。'
        : next.error?.startsWith('ライブ案内を利用できません。') ? null : next.error,
      phase: primary?.code === 'AGENT_UNAVAILABLE' && !['idle', 'ready', 'review'].includes(next.phase)
        ? 'fallback'
        : next.phase,
    } : next);
    scheduleGuidanceWake();
  }, [scheduleGuidanceWake, updateState]);

  useEffect(() => {
    guidanceFlushRef.current = applyGuidance;
  }, [applyGuidance]);

  const scheduleReconnect = useCallback((sessionId: string, reason?: string): void => {
    if (manuallyStoppedRef.current || sessionIdRef.current !== sessionId) return;
    if (reconnectTimerRef.current !== null) return;
    const attempt = reconnectAttemptRef.current;
    if (attempt >= 3) {
      updateState((current) => current.sessionId === sessionId ? {
        ...current,
        phase: current.phase === 'capturing' || current.phase === 'measurement' || current.phase === 'connecting' ? 'fallback' : current.phase,
        connectionState: 'disconnected',
        error: `${reason ?? 'AI撮影アシスタントとの接続が切断されました。'} 自動再接続を終了しました。再接続ボタンから再試行できます。`,
      } : current);
      return;
    }
    reconnectAttemptRef.current = attempt + 1;
    const delay = [500, 1_000, 2_000][attempt] ?? 2_000;
    updateState((current) => current.sessionId === sessionId ? {
      ...current,
      connectionState: 'reconnecting',
      error: 'AI撮影アシスタントを再接続しています。固定ガイドと手動撮影はそのまま利用できます。',
    } : current);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (sessionIdRef.current === sessionId && !manuallyStoppedRef.current) connectSessionRef.current(sessionId);
    }, delay);
  }, [updateState]);

  const connect = useCallback(async (sessionId: string): Promise<void> => {
    const attemptId = ++connectGenerationRef.current;
    const wasReconnect = awaitingResyncRef.current || reconnectAttemptRef.current > 0 || stateRef.current.connectionState === 'reconnecting';
    updateState((current) => current.sessionId === sessionId ? {
      ...current,
      phase: current.phase === 'fallback' ? 'fallback' : current.phase,
      connectionState: wasReconnect ? 'reconnecting' : 'connecting',
      error: null,
    } : current);
    try {
      const connection = await adapterRef.current?.connect(sessionId);
      if (!connection) throw new Error('撮影アシスタントadapterがありません。');
      if (sessionIdRef.current !== sessionId || attemptId !== connectGenerationRef.current || manuallyStoppedRef.current) return;
      const resumedLive = connection.transport === 'live' && wasReconnect;
      awaitingResyncRef.current = resumedLive;
      reconnectAttemptRef.current = 0;
      clearReconnectTimer();
      updateState((current) => current.sessionId === sessionId ? {
        ...current,
        connectionState: connection.connectionState,
        transport: connection.transport,
        phase: current.phase === 'fallback' || current.phase === 'connecting' ? activeWorkflowPhase(current.activeSlot) : current.phase,
        error: resumedLive ? '接続を復元しました。撮影ステップを同期しています。' : null,
      } : current);
      if (resumedLive) resetGuidance(false);
    } catch (error) {
      if (sessionIdRef.current !== sessionId || attemptId !== connectGenerationRef.current || manuallyStoppedRef.current) return;
      const message = providerMessage(error, '撮影アシスタントAPIに接続できません。');
      updateState((current) => current.sessionId === sessionId ? {
        ...current,
        phase: current.phase === 'capturing' || current.phase === 'measurement' || current.phase === 'connecting' ? 'fallback' : current.phase,
        connectionState: 'disconnected',
        error: `${message} 固定ガイドと手動撮影を利用できます。`,
      } : current);
      scheduleReconnect(sessionId, message);
    }
  }, [clearReconnectTimer, resetGuidance, scheduleReconnect, updateState]);

  useEffect(() => {
    connectSessionRef.current = (sessionId) => { void connect(sessionId); };
  }, [connect]);

  const start = useCallback(() => {
    manuallyStoppedRef.current = false;
    clearReconnectTimer();
    clearGuidanceTimer();
    connectGenerationRef.current += 1;
    captureGenerationRef.current += 1;
    measurementGenerationRef.current += 1;
    captureRequestsRef.current.clear();
    measurementRequestRef.current = null;
    guidanceCandidatesRef.current.clear();
    guidanceSelectorRef.current?.reset();
    suppressConnectionEventsRef.current = true;
    sessionIdRef.current = null;
    const sessionId = createSessionId();
    sessionIdRef.current = sessionId;
    sequenceRef.current = 0;
    transportSequenceRef.current = 0;
    awaitingResyncRef.current = false;
    const slots = { ...createInitialSlots(), front: { slot: 'front' as const, status: 'active' as const } };
    const initial = { ...createInitialState(), sessionId, phase: 'connecting' as const, currentStep: 'front' as const, connectionState: 'connecting' as const, slots };
    stateRef.current = initial;
    setState(initial);
    void Promise.resolve(adapterRef.current?.disconnect()).catch(() => undefined).finally(() => {
      suppressConnectionEventsRef.current = false;
      if (sessionIdRef.current === sessionId && !manuallyStoppedRef.current) void connect(sessionId);
    });
  }, [clearGuidanceTimer, clearReconnectTimer, connect]);

  const retryConnection = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      start();
      return;
    }
    manuallyStoppedRef.current = false;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    awaitingResyncRef.current = stateRef.current.transport === 'live';
    resetGuidance(false);
    void connect(sessionId);
  }, [clearReconnectTimer, connect, resetGuidance, start]);

  const stop = useCallback(() => {
    manuallyStoppedRef.current = true;
    connectGenerationRef.current += 1;
    captureGenerationRef.current += 1;
    measurementGenerationRef.current += 1;
    sessionIdRef.current = null;
    sequenceRef.current = 0;
    transportSequenceRef.current = 0;
    reconnectAttemptRef.current = 0;
    awaitingResyncRef.current = false;
    captureRequestsRef.current.clear();
    measurementRequestRef.current = null;
    markerRequestAbortRef.current?.abort();
    markerRequestAbortRef.current = null;
    clearReconnectTimer();
    resetGuidance(false);
    void adapterRef.current?.disconnect();
    const initial = createInitialState();
    stateRef.current = initial;
    setState(initial);
  }, [clearReconnectTimer, resetGuidance]);

  const selectSlot = useCallback((slot: SessionSlot) => {
    const snapshot = stateRef.current;
    const sessionId = snapshot.sessionId;
    if (!sessionId) return;
    if (!isCaptureSlotSelectable(snapshot.slots, slot, snapshot.phase !== 'idle')) return;
    resetGuidance(false);
    if (snapshot.transport === 'live') awaitingResyncRef.current = true;
    updateState((current) => {
      if (!current.sessionId) return current;
      const currentSlot = current.slots[slot];
      const isApproved = currentSlot.status === 'approved';
      const nextSlots = { ...current.slots, [slot]: { ...currentSlot, status: isApproved ? 'approved' as const : slot === 'measurement' ? currentSlot.status : 'active' as const } };
      return {
        ...current,
        activeSlot: slot,
        currentStep: stepForSlot(slot, nextSlots),
        phase: isApproved ? 'review' : slot === 'measurement' ? 'measurement' : 'capturing',
        slots: nextSlots,
        latestGuidance: null,
        primaryGuidance: null,
        guidanceAcknowledgement: null,
        error: null,
      };
    });
    if (sessionId) {
      const syncShot = adapterRef.current?.setActiveShot?.(slot);
      if (syncShot) {
        void syncShot.catch((error: unknown) => {
          const message = error instanceof Error && error.message ? error.message : '撮影ステップの同期に失敗しました。';
          updateState((current) => current.sessionId === sessionId ? { ...current, error: `${message} 再接続して続行できます。` } : current);
        });
      }
    }
  }, [resetGuidance, updateState]);

  const processMedia = useCallback(async (media: AcceptedGuidedMedia): Promise<void> => {
    const snapshot = stateRef.current;
    if (!snapshot.sessionId) return;
    const target = snapshot.activeSlot !== 'measurement' && (snapshot.slots[snapshot.activeSlot].status === 'pending' || snapshot.slots[snapshot.activeSlot].status === 'active')
      ? snapshot.activeSlot
      : nextPendingCaptureSlot(snapshot.slots);
    if (!target) return;
    const sequence = ++sequenceRef.current;
    const requestId = createCaptureRequestId(`${snapshot.sessionId}:${target}`);
    const request: CaptureRequest = { sessionId: snapshot.sessionId, slot: target, mediaId: media.mediaId, blob: media.blob, requestId, sequence };
    const fence: CaptureRequestFence = {
      sessionId: snapshot.sessionId,
      slot: target,
      mediaId: media.mediaId,
      requestId,
      sequence,
      generation: captureGenerationRef.current,
    };
    captureRequestsRef.current.set(target, fence);
    resetGuidance(false);
    updateState((current) => {
      if (current.sessionId !== snapshot.sessionId) return current;
      return {
        ...current,
        activeSlot: target,
        currentStep: target,
        phase: 'capturing',
        slots: { ...current.slots, [target]: { slot: target, status: 'active', mediaId: media.mediaId, previewUrl: media.previewUrl, source: media.source } },
        latestGuidance: null,
        primaryGuidance: null,
        guidanceAcknowledgement: null,
        lastAssessment: null,
        error: null,
      };
    });
    const requested = request;
    const isCurrentRequest = (): boolean => {
      const current = stateRef.current;
      const currentFence = captureRequestsRef.current.get(target);
      return current.sessionId === fence.sessionId
        && currentFence?.requestId === fence.requestId
        && currentFence.generation === fence.generation
        && captureGenerationRef.current === fence.generation
        // A synchronous fixture/cache response can resolve before React has
        // committed the optimistic slot update. The request map is the
        // authoritative identity fence in that narrow window; removals and
        // retakes still invalidate it before a stale result can be applied.
        && (current.slots[target].mediaId === fence.mediaId || current.slots[target].mediaId === undefined);
    };
    try {
      const assessment = await adapterRef.current?.assessShot?.(requested) ?? defaultAcceptedAssessment(target);
      if (!isCurrentRequest()) {
        return;
      }
      captureRequestsRef.current.delete(target);
      updateState((current) => {
        const slot = requested.slot;
        if (current.sessionId !== requested.sessionId || (current.slots[slot].mediaId !== undefined && current.slots[slot].mediaId !== media.mediaId)) return current;
        if (assessment && (assessment.quality !== 'ok' || assessment.shotType !== slot)) {
          return { ...current, activeSlot: slot, currentStep: slot, phase: 'capturing', slots: { ...current.slots, [slot]: { ...current.slots[slot], mediaId: media.mediaId, previewUrl: media.previewUrl, source: media.source, status: 'active' } }, lastAssessment: assessment, primaryGuidance: null, guidanceAcknowledgement: null, error: issueMessage(assessment.issues) };
        }
        const nextSlots = { ...current.slots, [slot]: { ...current.slots[slot], mediaId: media.mediaId, previewUrl: media.previewUrl, source: media.source, status: 'captured' as const } };
        const nextSlot = nextPendingCaptureSlot(nextSlots);
        return { ...current, slots: nextSlots, activeSlot: nextSlot ?? 'measurement', currentStep: nextSlot ?? 'measurement-preparation', phase: nextSlot ? 'capturing' : 'measurement', lastAssessment: assessment, latestGuidance: null, primaryGuidance: null, guidanceAcknowledgement: null, error: null };
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      captureRequestsRef.current.delete(target);
      const message = providerMessage(error, '撮影後AIを利用できません。');
      updateState((current) => {
        if (current.sessionId !== requested.sessionId || current.slots[requested.slot].mediaId !== media.mediaId) return current;
        return { ...current, activeSlot: requested.slot, currentStep: requested.slot, phase: 'capturing', slots: { ...current.slots, [requested.slot]: { ...current.slots[requested.slot], status: 'active' as const } }, lastAssessment: null, primaryGuidance: null, guidanceAcknowledgement: null, error: `${message} 写真は保持しています。もう一度解析するか、撮り直してください。` };
      });
    }
  }, [resetGuidance, updateState]);

  // File inputs can deliver several images in one change event. Serialize
  // assessment so each image receives the next reducer slot, and invalidate
  // queued work when the session is closed or replaced.
  const recordMedia = useCallback((media: AcceptedGuidedMedia): Promise<void> => {
    const generation = captureGenerationRef.current;
    const task = captureQueueRef.current.then(async () => {
      if (generation !== captureGenerationRef.current) return;
      await processMedia(media);
    });
    captureQueueRef.current = task.catch(() => undefined);
    return task;
  }, [processMedia]);

  const getMarkerWorker = useCallback((): MeasurementMarkerWorkerClient | null => {
    if (markerWorkerRef.current) return markerWorkerRef.current;
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker(new URL('../measurement/markerWorker.ts', import.meta.url), { type: 'module' });
      const client = new MeasurementMarkerWorkerClient(worker);
      markerWorkerRef.current = client;
      return client;
    } catch {
      // Older embedded browsers may not support module Workers. The bounded
      // deterministic detector remains a safe, offline fallback.
      return null;
    }
  }, []);

  const detectMarker = useCallback(async (raster: NonNullable<Awaited<ReturnType<typeof readImageRaster>>>, signal: AbortSignal) => {
    const image = {
      width: raster.width,
      height: raster.height,
      data: raster.data,
    };
    const options = {
      minSidePx: 80 * raster.scale,
      edgeMarginPx: 16 * raster.scale,
      minGarmentGapPx: 24 * raster.scale,
    };
    const fallback = () => detectMeasurementMarker(image, options);
    const worker = getMarkerWorker();
    if (!worker) return fallback();
    try {
      return await worker.detect(image, options, undefined, signal);
    } catch (error) {
      if (error instanceof MarkerWorkerError && error.code === 'CANCELLED') throw error;
      return fallback();
    }
  }, [getMarkerWorker]);

  const projectMeasurementImage = useCallback(async (
    raster: NonNullable<Awaited<ReturnType<typeof readImageRaster>>>,
    homography: ReturnType<typeof homographyFromCorners>,
    markerSidePx: number,
    signal: AbortSignal,
  ): Promise<ProjectedRgbaImage> => {
    const image = { width: raster.width, height: raster.height, data: raster.data };
    const fallback = () => projectRgbaImage(image, homography, markerSidePx);
    const worker = getMarkerWorker();
    if (!worker) return fallback();
    try {
      const projected = await worker.project(image, homography, markerSidePx, signal);
      return {
        width: projected.width,
        height: projected.height,
        data: new Uint8ClampedArray(projected.data),
        markerSidePx: projected.markerSidePx,
        scale: projected.scale,
      };
    } catch (error) {
      if (error instanceof MarkerWorkerError && error.code === 'CANCELLED') throw error;
      return fallback();
    }
  }, [getMarkerWorker]);

  const recordMeasurement = useCallback(async (blob: Blob): Promise<Blob | null> => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return null;
    const snapshot = stateRef.current;
    if (!allImageSlotsCaptured(snapshot.slots)) {
      updateState((current) => current.sessionId === sessionId ? { ...current, error: 'front・back・tagの撮影が揃ってから採寸を開始してください。' } : current);
      return null;
    }
    const generation = ++measurementGenerationRef.current;
    const requestId = createCaptureRequestId(`${sessionId}:measurement`);
    const sequence = ++sequenceRef.current;
    const fence: MeasurementRequestFence = { sessionId, requestId, sequence, generation };
    measurementRequestRef.current = fence;
    markerRequestAbortRef.current?.abort();
    const markerAbortController = new AbortController();
    markerRequestAbortRef.current = markerAbortController;
    resetGuidance(false);
    updateState((current) => current.sessionId === sessionId ? {
      ...current,
      activeSlot: 'measurement',
      currentStep: 'measurement-capture',
      phase: 'measurement',
      slots: { ...demoteImageApprovals(current.slots), measurement: { slot: 'measurement', status: 'active' } },
      measurementDraft: null,
      measurement: null,
      error: null,
    } : current);
    try {
      const [imageDimensions, raster] = await Promise.all([
        readImageDimensions(blob).catch(() => null),
        readImageRaster(blob).catch(() => null),
      ]);
      const isCurrentMeasurement = (): boolean => {
        const currentFence = measurementRequestRef.current;
        return sessionIdRef.current === sessionId
          && currentFence?.requestId === requestId
          && currentFence.generation === generation
          && measurementGenerationRef.current === generation;
      };
      if (!isCurrentMeasurement()) return null;

      const markerDetection = raster
        ? await detectMarker(raster, markerAbortController.signal)
        : { ok: false as const, code: 'SEGMENTATION_FAILED' as const, message: '採寸画像を端末内で読み取れません。' };
      const markerFence = measurementRequestRef.current;
      if (!isCurrentMeasurement() || markerFence?.requestId !== requestId || markerFence.generation !== generation) return null;

      let analysisBlob: Blob | null = null;
      let analysisDimensions = imageDimensions;
      let markerSidePx: number | undefined;
      let marker: MeasurementDraft['marker'] = null;
      let projectionCorrected = false;
      let markerDetectionFailure = markerDetection.ok ? undefined : markerDetection.code;
      let correctionError: string | null = null;

      if (markerDetection.ok && raster) {
        const rawMarkerSidePx = markerDetection.marker.sidePx / Math.max(Number.EPSILON, raster.scale);
        marker = {
          knownSideCm: 5 as const,
          corners: markerDetection.marker.corners,
          pxPerCm: rawMarkerSidePx / 5,
        };
        try {
          const projected = await projectMeasurementImage(raster, markerDetection.projection, markerDetection.marker.sidePx, markerAbortController.signal);
          if (!isCurrentMeasurement()) return null;
          analysisBlob = await rasterToBlob(projected);
          if (!isCurrentMeasurement()) return null;
          analysisDimensions = { width: projected.width, height: projected.height };
          markerSidePx = projected.markerSidePx;
          marker = {
            knownSideCm: 5 as const,
            corners: markerDetection.marker.corners,
            pxPerCm: projected.markerSidePx / 5,
          };
          projectionCorrected = true;
        } catch (error) {
          if (error instanceof MarkerWorkerError && error.code === 'CANCELLED') throw error;
          markerSidePx = rawMarkerSidePx;
          markerDetectionFailure = 'SEGMENTATION_FAILED';
          correctionError = '画像の射影補正を完了できません。';
        }
      }

      let suggestion: MeasurementDraft | undefined;
      let providerError: string | null = null;
      if (analysisBlob && adapterRef.current?.suggestMeasurement) {
        try {
          const request: MeasurementRequest = { sessionId, blob: analysisBlob, requestId, sequence };
          suggestion = await adapterRef.current.suggestMeasurement(request);
        } catch (error) {
          if (error instanceof MarkerWorkerError && error.code === 'CANCELLED') throw error;
          providerError = providerMessage(error, '採寸点の提案を利用できません。');
        }
      }
      if (!isCurrentMeasurement()) return null;
      measurementRequestRef.current = null;

      const endpoints = suggestion?.endpoints ?? { ...DEFAULT_MEASUREMENT_ENDPOINTS };
      const baseSuggestion: MeasurementDraft = suggestion ?? {
        lengthCm: null,
        widthCm: null,
        source: 'approved_manual',
      };
      const calculated = suggestion?.endpoints && analysisDimensions && markerSidePx
        ? calculateMeasurement({
            endpoints: suggestion.endpoints,
            rawEndpoints: suggestion.endpoints,
            imageDimensions: analysisDimensions,
            markerSidePx,
          })
        : null;
      const enrichedSuggestion: MeasurementDraft = {
        ...baseSuggestion,
        endpoints,
        rawEndpoints: endpoints,
        ...(analysisDimensions ? { imageDimensions: analysisDimensions } : {}),
        ...(marker ? { marker } : {}),
        ...(markerSidePx ? { markerSidePx } : {}),
        projectionCorners: null,
        homography: null,
        projectionCorrected,
        endpointSource: suggestion ? 'ai' : 'fallback',
        ...(calculated ? { endpoints: calculated.endpoints, lengthCm: calculated.lengthCm, widthCm: calculated.widthCm } : {}),
        ...(markerDetectionFailure ? { markerDetectionFailure } : {}),
      };
      const reviewError = providerError
        ? `${providerError} 4端点と採寸値は手動で確認できます。`
        : correctionError
          ? `${correctionError} 端点と採寸値を手動で確認できます。`
          : null;
      updateState((current) => current.sessionId === sessionId && generation === measurementGenerationRef.current ? {
        ...current,
        activeSlot: 'measurement',
        currentStep: 'measurement-review',
        phase: 'measurement',
        measurementDraft: enrichedSuggestion,
        slots: { ...current.slots, measurement: { slot: 'measurement', status: 'captured' } },
        error: reviewError,
      } : current);
      return analysisBlob;
    } catch (error) {
      const currentFence = measurementRequestRef.current;
      if (error instanceof MarkerWorkerError && error.code === 'CANCELLED') return null;
      if (sessionIdRef.current !== sessionId || currentFence?.requestId !== requestId || currentFence.generation !== generation || measurementGenerationRef.current !== generation) return null;
      measurementRequestRef.current = null;
      const message = providerMessage(error, '採寸画像を処理できません。');
      updateState((current) => current.sessionId === sessionId && generation === measurementGenerationRef.current ? { ...current, activeSlot: 'measurement', currentStep: 'measurement-capture', phase: 'measurement', slots: { ...current.slots, measurement: { slot: 'measurement', status: 'active' } }, error: `${message} 着丈・身幅を手入力できます。` } : current);
      return null;
    } finally {
      if (markerRequestAbortRef.current === markerAbortController) markerRequestAbortRef.current = null;
    }
  }, [detectMarker, projectMeasurementImage, resetGuidance, updateState]);

  const removeMedia = useCallback((mediaId: string) => {
    const snapshot = stateRef.current;
    const slot = snapshot.sessionId ? CAPTURE_SLOTS.find((candidate) => snapshot.slots[candidate].mediaId === mediaId) : undefined;
    if (!slot) return;
    captureGenerationRef.current += 1;
    measurementGenerationRef.current += 1;
    captureRequestsRef.current.delete(slot);
    measurementRequestRef.current = null;
    resetGuidance(false);
    updateState((current) => {
      if (!current.sessionId) return current;
      return { ...current, slots: { ...current.slots, [slot]: { slot, status: 'active' as const } }, activeSlot: slot, currentStep: slot, phase: 'capturing', lastAssessment: null, latestGuidance: null, primaryGuidance: null, guidanceAcknowledgement: null, backgroundApproval: slot === 'front' ? 'not_started' : current.backgroundApproval, backgroundPreviewUrl: slot === 'front' ? undefined : current.backgroundPreviewUrl, error: null };
    });
  }, [resetGuidance, updateState]);

  const replaceMedia = useCallback((slot: CaptureImageSlot, media: AcceptedGuidedMedia) => {
    captureGenerationRef.current += 1;
    captureRequestsRef.current.delete(slot);
    updateState((current) => {
      if (!current.sessionId) return current;
      const previous = current.slots[slot];
      if (previous.status !== 'captured' && previous.status !== 'approved') return current;
      return { ...current, slots: { ...current.slots, [slot]: { slot, status: previous.status, mediaId: media.mediaId, previewUrl: media.previewUrl, source: media.source } }, error: null };
    });
  }, [updateState]);

  const retakeMeasurement = useCallback(() => {
    measurementGenerationRef.current += 1;
    measurementRequestRef.current = null;
    markerRequestAbortRef.current?.abort();
    markerRequestAbortRef.current = null;
    resetGuidance(false);
    updateState((current) => {
      if (!current.sessionId || !allImageSlotsCaptured(current.slots)) return current;
      return {
        ...current,
        slots: { ...demoteImageApprovals(current.slots), measurement: { slot: 'measurement', status: 'pending' } },
        activeSlot: 'measurement',
        currentStep: 'measurement-preparation',
        phase: 'measurement',
        measurementDraft: null,
        measurement: null,
        error: null,
      };
    });
  }, [resetGuidance, updateState]);

  const approveBackground = useCallback((previewUrl?: string) => {
    updateState((current) => current.sessionId && current.phase === 'ready' && current.slots.front.status === 'approved'
      ? { ...current, backgroundApproval: 'approved', backgroundPreviewUrl: previewUrl }
      : current);
  }, [updateState]);

  const updateMeasurement = useCallback((patch: MeasurementPatch) => {
    updateState((current) => {
      if (!current.sessionId) return current;
      const currentDraft: MeasurementDraft = current.measurementDraft ?? { lengthCm: null, widthCm: null, source: 'approved_manual' };
      if (patch.endpoints && !MeasurementEndpointsSchema.safeParse(patch.endpoints).success) {
        return { ...current, error: '採寸端点は0〜1の範囲で入力してください。' };
      }
      if (patch.markerSidePx !== undefined && patch.markerSidePx !== null && (!Number.isFinite(patch.markerSidePx) || patch.markerSidePx <= 0 || patch.markerSidePx > 100_000)) {
        return { ...current, error: 'マーカーの1辺は正のpx値で入力してください。' };
      }
      if ([['着丈', patch.lengthCm], ['身幅', patch.widthCm]].some(([, value]) => value !== undefined && value !== null && !finiteMeasurement(value as number))) {
        return { ...current, error: '着丈・身幅は正の数値で入力してください。' };
      }

      let endpoints = patch.endpoints ?? currentDraft.endpoints;
      let rawEndpoints = currentDraft.rawEndpoints ?? currentDraft.endpoints;
      let homography = currentDraft.homography ?? null;
      let projectionCorners = currentDraft.projectionCorners ?? null;
      if (patch.endpoints) {
        endpoints = patch.endpoints;
        rawEndpoints = patch.endpoints;
        homography = null;
        projectionCorners = null;
      }
      if (patch.projectionCorners !== undefined) {
        projectionCorners = patch.projectionCorners;
        if (patch.projectionCorners === null) {
          homography = null;
          endpoints = rawEndpoints ?? endpoints;
        } else if (rawEndpoints) {
          try {
            homography = homographyFromCorners(patch.projectionCorners);
          } catch {
            return { ...current, error: '射影補正の四隅が不正です。画像内の順番と位置を確認してください。' };
          }
        }
      }
      if (patch.projectionCorners !== undefined && patch.projectionCorners !== null && !rawEndpoints) {
        return { ...current, error: '先にAIの4端点を取得するか、端点を入力してください。' };
      }

      const markerSidePx = patch.markerSidePx !== undefined ? patch.markerSidePx : currentDraft.markerSidePx;
      const geometryChanged = patch.endpoints !== undefined || patch.markerSidePx !== undefined || patch.projectionCorners !== undefined;
      let lengthCm = patch.lengthCm !== undefined ? patch.lengthCm : currentDraft.lengthCm;
      let widthCm = patch.widthCm !== undefined ? patch.widthCm : currentDraft.widthCm;
      if (geometryChanged && endpoints) {
        const calculated = calculateMeasurement({
          endpoints,
          rawEndpoints,
          imageDimensions: currentDraft.imageDimensions,
          markerSidePx,
          homography,
        });
        endpoints = calculated.endpoints;
        lengthCm = calculated.lengthCm;
        widthCm = calculated.widthCm;
      }
      const nextDraft: MeasurementDraft = {
        ...currentDraft,
        lengthCm,
        widthCm,
        endpoints,
        rawEndpoints,
        markerSidePx,
        projectionCorners,
        homography,
        source: patch.lengthCm !== undefined || patch.widthCm !== undefined || geometryChanged ? 'approved_manual' : currentDraft.source,
      };
      return { ...current, measurementDraft: nextDraft, slots: { ...current.slots, measurement: { slot: 'measurement', status: 'captured' as const } }, currentStep: 'measurement-review', phase: 'measurement', error: null };
    });
  }, [updateState]);

  const approveMeasurement = useCallback((measurement?: ApprovedMeasurement, confirmRange = false) => {
    resetGuidance(false);
    updateState((current) => {
      if (!current.sessionId) return current;
      const hasRequiredImages = CAPTURE_SLOTS.every((slot) => current.slots[slot].status === 'captured' || current.slots[slot].status === 'approved');
      if (!hasRequiredImages) return { ...current, error: 'front・back・tagの撮影が揃ってから採寸を承認してください。' };
      const draftLength = current.measurementDraft?.lengthCm;
      const draftWidth = current.measurementDraft?.widthCm;
      const candidate: ApprovedMeasurement | null = measurement ?? (finiteMeasurement(draftLength) && finiteMeasurement(draftWidth)
        ? { lengthCm: draftLength, widthCm: draftWidth, source: current.measurementDraft?.source === 'ai' ? 'approved_cv' : 'approved_manual' }
        : null);
      if (!isApprovedMeasurement(candidate)) return { ...current, error: '着丈・身幅に正の数値を入力してから承認してください。' };
      if (!isRecommendedMeasurement(candidate) && !confirmRange) {
        return { ...current, error: '推奨範囲外の採寸値です。実測値を再確認してから、もう一度承認してください。' };
      }
      return { ...current, slots: { ...current.slots, measurement: { slot: 'measurement', status: 'approved' } }, measurement: candidate, currentStep: 'measurement-review', phase: 'review', activeSlot: 'measurement', latestGuidance: null, primaryGuidance: null, guidanceAcknowledgement: null, error: null };
    });
  }, [resetGuidance, updateState]);

  const approveCapture = useCallback(() => {
    resetGuidance(false);
    updateState((current) => {
      if (!current.sessionId || !allImageSlotsCaptured(current.slots)) {
        return { ...current, error: 'front・back・tagの撮影を確認してから次へ進んでください。' };
      }
      if (!isApprovedMeasurement(current.measurement)) {
        return { ...current, error: '採寸値を明示承認してから写真確認へ進んでください。' };
      }
      const slots = { ...current.slots };
      for (const slot of CAPTURE_SLOTS) slots[slot] = { ...slots[slot], status: 'approved' as const };
      return { ...current, slots, phase: 'ready', currentStep: 'edit', activeSlot: 'measurement', latestGuidance: null, primaryGuidance: null, guidanceAcknowledgement: null, error: null };
    });
  }, [resetGuidance, updateState]);

  const reportConnectionState = useCallback((connectionState: ConnectionState, error?: string) => {
    if (suppressConnectionEventsRef.current) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const previous = stateRef.current.connectionState;
    if (connectionState === 'connected') {
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      const resumedLive = stateRef.current.transport === 'live' && (previous === 'reconnecting' || previous === 'disconnected');
      awaitingResyncRef.current = resumedLive;
      if (resumedLive) resetGuidance(false);
      updateState((current) => current.sessionId === sessionId ? {
        ...current,
        connectionState,
        latestGuidance: null,
        primaryGuidance: null,
        guidanceAcknowledgement: null,
        phase: current.phase === 'fallback' || current.phase === 'connecting' ? activeWorkflowPhase(current.activeSlot) : current.phase,
        error: error ?? (resumedLive ? '接続を復元しました。撮影ステップを同期しています。' : null),
      } : current);
      return;
    }
    if (connectionState === 'reconnecting') {
      if (stateRef.current.transport === 'live') {
        awaitingResyncRef.current = true;
        resetGuidance(false);
      }
      updateState((current) => current.sessionId === sessionId ? {
        ...current,
        connectionState,
        latestGuidance: null,
        primaryGuidance: null,
        guidanceAcknowledgement: null,
        error: error ?? 'AI撮影アシスタントを再接続しています。固定ガイドと手動撮影はそのまま利用できます。',
      } : current);
      return;
    }
    awaitingResyncRef.current = stateRef.current.transport === 'live';
    resetGuidance(false);
    updateState((current) => current.sessionId === sessionId ? {
      ...current,
      connectionState,
      latestGuidance: null,
      primaryGuidance: null,
      guidanceAcknowledgement: null,
      phase: !['idle', 'review', 'ready'].includes(current.phase) ? 'fallback' : current.phase,
      error: error ?? (!['review', 'ready'].includes(current.phase) ? 'AI撮影アシスタントが切断されました。固定ガイドと手動撮影を利用できます。' : null),
    } : current);
    scheduleReconnect(sessionId, error);
  }, [clearReconnectTimer, resetGuidance, scheduleReconnect, updateState]);

  const reportGuidance = useCallback((event: GuidanceEvent) => {
    const now = Date.now();
    const snapshot = stateRef.current;
    if (
      awaitingResyncRef.current
      || !snapshot.sessionId
      || event.sessionId !== snapshot.sessionId
      || event.shot !== snapshot.activeSlot
      || !isFiniteSequence(event.sequence)
      || event.sequence <= transportSequenceRef.current
      || !Number.isFinite(event.observedAt)
      || !Number.isFinite(event.expiresAt)
      || event.expiresAt <= event.observedAt
      || now >= event.expiresAt
    ) return;
    transportSequenceRef.current = event.sequence;
    guidanceCandidatesRef.current.set(`agent:${event.shot}`, candidateFromGuidanceEvent(event));
    applyGuidance(now);
  }, [applyGuidance]);

  const reportLocalGuidance = useCallback((candidate: { shot: SessionSlot; code: LocalGuidanceCode; message?: string; expiresAt: number } | null) => {
    const snapshot = stateRef.current;
    if (!snapshot.sessionId) return;
    if (candidate === null) {
      guidanceCandidatesRef.current.delete(`device:${snapshot.activeSlot}`);
    } else if (candidate.shot === snapshot.activeSlot && Number.isFinite(candidate.expiresAt)) {
      const now = Date.now();
      if (candidate.expiresAt <= now) return;
      guidanceCandidatesRef.current.set(`device:${candidate.shot}`, createLocalGuidanceCandidate({ ...candidate, observedAt: now }));
    } else {
      return;
    }
    applyGuidance(Date.now());
  }, [applyGuidance]);

  const reportState = useCallback((event: GuidanceStateEvent) => {
    const snapshot = stateRef.current;
    if (
      !snapshot.sessionId
      || event.sessionId !== snapshot.sessionId
      || !isFiniteSequence(event.sequence)
      || event.sequence <= transportSequenceRef.current
      || !Number.isFinite(event.observedAt)
      || (event.shot !== null && !['front', 'back', 'tag', 'measurement'].includes(event.shot))
    ) return;
    transportSequenceRef.current = event.sequence;
    awaitingResyncRef.current = false;
    resetGuidance(false);
    updateState((current) => {
      if (!current.sessionId || event.sessionId !== current.sessionId) return current;
      // Reliable state is authoritative for the active shot. A state packet
      // intentionally has no expiry/confidence, so never synthesize a public
      // GuidanceEvent from it; clear any advice belonging to the old shot.
      if (event.shot === null) return { ...current, latestGuidance: null, primaryGuidance: null, guidanceAcknowledgement: null, error: null };
      const activeProgress = current.slots[event.shot];
      const nextPhase = event.shot === 'measurement'
        ? 'measurement'
        : activeProgress.status === 'approved'
          ? 'review'
          : 'capturing';
      return {
        ...current,
        activeSlot: event.shot,
        currentStep: event.shot === 'measurement' && measurementRequestRef.current?.sessionId === current.sessionId
          ? 'measurement-capture'
          : stepForSlot(event.shot, current.slots),
        phase: nextPhase,
        latestGuidance: null,
        primaryGuidance: null,
        guidanceAcknowledgement: null,
        slots: {
          ...current.slots,
          [event.shot]: activeProgress.status === 'pending'
            ? { ...activeProgress, status: 'active' as const }
            : activeProgress,
        },
        error: null,
      };
    });
  }, [resetGuidance, updateState]);

  const publishCameraStream = useCallback(async (stream: MediaStream): Promise<void> => {
    await adapterRef.current?.publishCameraStream?.(stream);
  }, []);

  useEffect(() => {
    const unsubscribe = adapterRef.current?.subscribeConnection?.(reportConnectionState);
    return () => unsubscribe?.();
  }, [adapter, reportConnectionState]);

  useEffect(() => {
    const unsubscribe = adapterRef.current?.subscribeGuidance?.(reportGuidance);
    return () => unsubscribe?.();
  }, [adapter, reportGuidance]);

  useEffect(() => {
    const unsubscribe = adapterRef.current?.subscribeState?.(reportState);
    return () => unsubscribe?.();
  }, [adapter, reportState]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const onPageHide = () => stop();
    const onVisibilityChange = () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      if (document.visibilityState === 'hidden') {
        if (stateRef.current.transport === 'live') awaitingResyncRef.current = true;
        resetGuidance(false);
        updateState((current) => current.sessionId === sessionId ? {
          ...current,
          latestGuidance: null,
          primaryGuidance: null,
          guidanceAcknowledgement: null,
        } : current);
        return;
      }
      if (stateRef.current.transport !== 'live' || stateRef.current.connectionState !== 'connected') {
        applyGuidance(Date.now());
        return;
      }
      awaitingResyncRef.current = true;
      resetGuidance(false);
      const sync = adapterRef.current?.setActiveShot?.(stateRef.current.activeSlot);
      if (sync) {
        void sync.catch((error: unknown) => updateState((current) => current.sessionId === sessionId ? {
          ...current,
          error: `${providerMessage(error, '撮影ステップを同期できませんでした。')} 再接続して続行できます。`,
        } : current));
      }
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [applyGuidance, resetGuidance, stop, updateState]);

  const getListingHandoff = useCallback((): GuidedCaptureHandoff | null => {
    const current = stateRef.current;
    if (!current.sessionId || current.phase !== 'ready' || !allImageSlotsApproved(current.slots) || !isApprovedMeasurement(current.measurement)) return null;
    const handoff = createListingHandoff({ sessionId: current.sessionId, slots: current.slots, measurement: current.measurement, background: { status: current.backgroundApproval } });
    return handoff.images.length === CAPTURE_SLOTS.length && handoff.garmentMeasurements ? handoff : null;
  }, []);

  return useMemo(() => ({ state, start, retryConnection, stop, selectSlot, recordMedia, recordMeasurement, replaceMedia, removeMedia, retakeMeasurement, updateMeasurement, approveMeasurement, approveCapture, approveBackground, reportConnectionState, reportGuidance, reportLocalGuidance, reportState, publishCameraStream, getListingHandoff }), [approveBackground, approveCapture, approveMeasurement, getListingHandoff, publishCameraStream, recordMedia, recordMeasurement, removeMedia, replaceMedia, reportConnectionState, reportGuidance, reportLocalGuidance, reportState, retakeMeasurement, retryConnection, selectSlot, start, state, stop, updateMeasurement]);
};
