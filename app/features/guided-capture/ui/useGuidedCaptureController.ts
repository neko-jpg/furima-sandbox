import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createConfiguredGuidedCaptureAdapter } from './httpAdapter';
import { createFixtureGuidedCaptureAdapter } from './fixtureAdapter';
import { MeasurementEndpointsSchema } from '../../../types/measurement';
import { calculateMeasurement, homographyFromCorners, readImageDimensions } from '../measurement';
import { createListingHandoff, type AcceptedGuidedMedia, type ApprovedMeasurement, type CaptureImageSlot, type ConnectionState, type GuidedCaptureAdapter, type GuidedCaptureHandoff, type GuidedCaptureState, type GuidanceEvent, type GuidanceStateEvent, type MeasurementDraft, type MeasurementPatch, type MeasurementRequest, type SessionSlot, type SlotProgress, type CaptureRequest } from './contracts';

export interface GuidedCaptureController {
  state: GuidedCaptureState;
  start: () => void;
  retryConnection: () => void;
  stop: () => void;
  selectSlot: (slot: SessionSlot) => void;
  recordMedia: (media: AcceptedGuidedMedia) => Promise<void>;
  recordMeasurement: (blob: Blob) => Promise<void>;
  replaceMedia: (slot: CaptureImageSlot, media: AcceptedGuidedMedia) => void;
  removeMedia: (mediaId: string) => void;
  retakeMeasurement: () => void;
  updateMeasurement: (patch: MeasurementPatch) => void;
  approveMeasurement: (measurement?: ApprovedMeasurement) => void;
  approveCapture: () => void;
  approveBackground: (previewUrl?: string) => void;
  reportConnectionState: (connectionState: ConnectionState, error?: string) => void;
  reportGuidance: (event: GuidanceEvent) => void;
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
  connectionState: 'disconnected',
  transport: null,
  activeSlot: 'front',
  slots: createInitialSlots(),
  latestGuidance: null,
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

const issueMessage = (issues: readonly string[]): string => issues[0] ? `撮影結果を確認してください（${issues[0]}）。同じ向きで撮り直せます。` : '撮影結果を確認できませんでした。同じ向きで撮り直してください。';

const finiteMeasurement = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value) && value > 0;
const isApprovedMeasurement = (value: ApprovedMeasurement | null): value is ApprovedMeasurement => Boolean(
  value
  && finiteMeasurement(value.lengthCm)
  && value.lengthCm >= 20
  && value.lengthCm <= 100
  && finiteMeasurement(value.widthCm)
  && value.widthCm >= 20
  && value.widthCm <= 80
  && (value.source === 'approved_cv' || value.source === 'approved_manual'),
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
  const stateRef = useRef<GuidedCaptureState>(createInitialState());
  const [state, setState] = useState<GuidedCaptureState>(createInitialState);

  const updateState = useCallback((updater: StateUpdater): void => {
    setState((current) => {
      const next = updater(current);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (adapter !== undefined && adapter !== adapterRef.current) {
      void adapterRef.current?.disconnect();
      adapterRef.current = adapter;
    }
  }, [adapter]);

  useEffect(() => {
    sessionIdRef.current = state.sessionId;
    stateRef.current = state;
  }, [state]);

  useEffect(() => () => {
    captureGenerationRef.current += 1;
    sessionIdRef.current = null;
    sequenceRef.current = 0;
    transportSequenceRef.current = 0;
    void adapterRef.current?.disconnect();
  }, []);

  const connect = useCallback(async (sessionId: string): Promise<void> => {
    updateState((current) => current.sessionId === sessionId ? { ...current, phase: 'connecting', connectionState: 'connecting', error: null } : current);
    try {
      const connection = await adapterRef.current?.connect(sessionId);
      if (!connection) throw new Error('撮影アシスタントadapterがありません。');
      updateState((current) => current.sessionId === sessionId ? { ...current, phase: 'capturing', connectionState: connection.connectionState, transport: connection.transport, error: null } : current);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '撮影アシスタントAPIに接続できません。';
      updateState((current) => current.sessionId === sessionId ? { ...current, phase: 'fallback', connectionState: 'disconnected', error: `${message} 固定ガイドと手動撮影を利用できます。` } : current);
    }
  }, [updateState]);

  const start = useCallback(() => {
    captureGenerationRef.current += 1;
    const sessionId = createSessionId();
    sessionIdRef.current = sessionId;
    sequenceRef.current = 0;
    transportSequenceRef.current = 0;
    const initial = { ...createInitialState(), sessionId, phase: 'connecting' as const, connectionState: 'connecting' as const, slots: { ...createInitialSlots(), front: { slot: 'front' as const, status: 'active' as const } } };
    stateRef.current = initial;
    setState(initial);
    void connect(sessionId);
  }, [connect]);

  const retryConnection = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      start();
      return;
    }
    void connect(sessionId);
  }, [connect, start]);

  const stop = useCallback(() => {
    captureGenerationRef.current += 1;
    measurementGenerationRef.current += 1;
    sessionIdRef.current = null;
    sequenceRef.current = 0;
    transportSequenceRef.current = 0;
    void adapterRef.current?.disconnect();
    const initial = createInitialState();
    stateRef.current = initial;
    setState(initial);
  }, []);

  const selectSlot = useCallback((slot: SessionSlot) => {
    const sessionId = stateRef.current.sessionId;
    updateState((current) => {
      if (!current.sessionId) return current;
      const currentSlot = current.slots[slot];
      const isApproved = currentSlot.status === 'approved';
      return {
        ...current,
        activeSlot: slot,
        phase: isApproved ? 'review' : slot === 'measurement' ? 'measurement' : 'capturing',
        slots: { ...current.slots, [slot]: { ...currentSlot, status: isApproved ? 'approved' : currentSlot.status === 'pending' ? 'active' as const : currentSlot.status } },
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
  }, [updateState]);

  const processMedia = useCallback(async (media: AcceptedGuidedMedia): Promise<void> => {
    const snapshot = stateRef.current;
    if (!snapshot.sessionId) return;
    const target = snapshot.activeSlot !== 'measurement' && (snapshot.slots[snapshot.activeSlot].status === 'pending' || snapshot.slots[snapshot.activeSlot].status === 'active')
      ? snapshot.activeSlot
      : nextPendingCaptureSlot(snapshot.slots);
    if (!target) return;
    const sequence = ++sequenceRef.current;
    const request: CaptureRequest = { sessionId: snapshot.sessionId, slot: target, mediaId: media.mediaId, blob: media.blob, requestId: `${snapshot.sessionId}:${target}:${sequence}`, sequence };
    updateState((current) => {
      if (current.sessionId !== snapshot.sessionId) return current;
      return {
        ...current,
        activeSlot: target,
        phase: 'capturing',
        slots: { ...current.slots, [target]: { slot: target, status: 'active', mediaId: media.mediaId, previewUrl: media.previewUrl, source: media.source } },
        error: null,
      };
    });
    const requested = request;
    try {
      const assessment = await adapterRef.current?.assessShot?.(requested);
      updateState((current) => {
        const slot = requested.slot;
        if (current.sessionId !== requested.sessionId || current.slots[slot].mediaId !== media.mediaId) return current;
        if (assessment && (assessment.quality !== 'ok' || assessment.shotType !== slot)) {
          return { ...current, activeSlot: slot, phase: 'capturing', slots: { ...current.slots, [slot]: { ...current.slots[slot], status: 'active' } }, error: issueMessage(assessment.issues) };
        }
        const nextSlots = { ...current.slots, [slot]: { ...current.slots[slot], status: 'captured' as const } };
        const nextSlot = nextPendingCaptureSlot(nextSlots);
        return { ...current, slots: nextSlots, activeSlot: nextSlot ?? 'measurement', phase: nextSlot ? 'capturing' : 'measurement', error: null };
      });
    } catch (error) {
      // A provider outage must not discard a photo the user captured. Keep the
      // slot accepted and expose manual retry/fallback instead.
      const message = error instanceof Error && error.message ? error.message : '撮影後AIを利用できません。';
      updateState((current) => {
        if (current.sessionId !== requested.sessionId || current.slots[requested.slot].mediaId !== media.mediaId) return current;
        const nextSlots = { ...current.slots, [requested.slot]: { ...current.slots[requested.slot], status: 'captured' as const } };
        const nextSlot = nextPendingCaptureSlot(nextSlots);
        return { ...current, slots: nextSlots, activeSlot: nextSlot ?? 'measurement', phase: nextSlot ? 'capturing' : 'measurement', error: `${message} 写真は保持しています。手動で続行できます。` };
      });
    }
  }, [updateState]);

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

  const recordMeasurement = useCallback(async (blob: Blob): Promise<void> => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const snapshot = stateRef.current;
    if (!allImageSlotsCaptured(snapshot.slots)) {
      updateState((current) => current.sessionId === sessionId ? { ...current, error: 'front・back・tagの撮影が揃ってから採寸を開始してください。' } : current);
      return;
    }
    const generation = ++measurementGenerationRef.current;
    updateState((current) => current.sessionId === sessionId ? {
      ...current,
      activeSlot: 'measurement',
      phase: 'measurement',
      slots: { ...demoteImageApprovals(current.slots), measurement: { slot: 'measurement', status: 'active' } },
      measurementDraft: null,
      measurement: null,
      error: null,
    } : current);
    try {
      const request: MeasurementRequest = { sessionId, blob };
      const [suggestion, imageDimensions] = await Promise.all([
        adapterRef.current?.suggestMeasurement?.(request),
        readImageDimensions(blob),
      ]);
      const enrichedSuggestion = suggestion && imageDimensions
        ? { ...suggestion, imageDimensions, rawEndpoints: suggestion.endpoints }
        : suggestion && suggestion.endpoints
          ? { ...suggestion, rawEndpoints: suggestion.endpoints }
          : suggestion;
      updateState((current) => current.sessionId === sessionId && generation === measurementGenerationRef.current ? {
        ...current,
        activeSlot: 'measurement',
        phase: 'measurement',
        measurementDraft: enrichedSuggestion ?? { lengthCm: null, widthCm: null, source: 'ai' },
        slots: { ...current.slots, measurement: { slot: 'measurement', status: 'captured' } },
        error: null,
      } : current);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '採寸点を提案できません。';
      updateState((current) => current.sessionId === sessionId && generation === measurementGenerationRef.current ? { ...current, activeSlot: 'measurement', phase: 'measurement', slots: { ...current.slots, measurement: { slot: 'measurement', status: 'active' } }, error: `${message} 着丈・身幅を手入力できます。` } : current);
    }
  }, [updateState]);

  const removeMedia = useCallback((mediaId: string) => {
    updateState((current) => {
      if (!current.sessionId) return current;
      const slot = CAPTURE_SLOTS.find((candidate) => current.slots[candidate].mediaId === mediaId);
      if (!slot) return current;
      return { ...current, slots: { ...current.slots, [slot]: { slot, status: 'active' as const }, measurement: { slot: 'measurement', status: 'pending' as const } }, activeSlot: slot, phase: 'capturing', measurementDraft: null, measurement: null, backgroundApproval: slot === 'front' ? 'not_started' : current.backgroundApproval, backgroundPreviewUrl: slot === 'front' ? undefined : current.backgroundPreviewUrl, error: null };
    });
  }, [updateState]);

  const replaceMedia = useCallback((slot: CaptureImageSlot, media: AcceptedGuidedMedia) => {
    updateState((current) => {
      if (!current.sessionId) return current;
      const previous = current.slots[slot];
      if (previous.status !== 'captured' && previous.status !== 'approved') return current;
      return { ...current, slots: { ...current.slots, [slot]: { slot, status: previous.status, mediaId: media.mediaId, previewUrl: media.previewUrl, source: media.source } } };
    });
  }, [updateState]);

  const retakeMeasurement = useCallback(() => {
    measurementGenerationRef.current += 1;
    updateState((current) => {
      if (!current.sessionId || !allImageSlotsCaptured(current.slots)) return current;
      return {
        ...current,
        slots: { ...demoteImageApprovals(current.slots), measurement: { slot: 'measurement', status: 'pending' } },
        activeSlot: 'measurement',
        phase: 'measurement',
        measurementDraft: null,
        measurement: null,
        error: null,
      };
    });
  }, [updateState]);

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
      return { ...current, measurementDraft: nextDraft, slots: { ...current.slots, measurement: { slot: 'measurement', status: 'captured' as const } }, phase: 'measurement', error: null };
    });
  }, [updateState]);

  const approveMeasurement = useCallback((measurement?: ApprovedMeasurement) => {
    updateState((current) => {
      if (!current.sessionId) return current;
      const hasRequiredImages = CAPTURE_SLOTS.every((slot) => current.slots[slot].status === 'captured' || current.slots[slot].status === 'approved');
      if (!hasRequiredImages) return { ...current, error: 'front・back・tagの撮影が揃ってから採寸を承認してください。' };
      const draftLength = current.measurementDraft?.lengthCm;
      const draftWidth = current.measurementDraft?.widthCm;
      const candidate: ApprovedMeasurement | null = measurement ?? (finiteMeasurement(draftLength) && finiteMeasurement(draftWidth)
        ? { lengthCm: draftLength, widthCm: draftWidth, source: current.measurementDraft?.source === 'ai' ? 'approved_cv' : 'approved_manual' }
        : null);
      if (!isApprovedMeasurement(candidate)) return { ...current, error: '着丈は20〜100cm、身幅は20〜80cmの範囲で入力してから承認してください。' };
      return { ...current, slots: { ...current.slots, measurement: { slot: 'measurement', status: 'approved' } }, measurement: candidate, phase: 'review', activeSlot: 'measurement', error: null };
    });
  }, [updateState]);

  const approveCapture = useCallback(() => {
    updateState((current) => {
      if (!current.sessionId || !allImageSlotsCaptured(current.slots)) {
        return { ...current, error: 'front・back・tagの撮影を確認してから次へ進んでください。' };
      }
      if (!isApprovedMeasurement(current.measurement)) {
        return { ...current, error: '採寸値を明示承認してから写真確認へ進んでください。' };
      }
      const slots = { ...current.slots };
      for (const slot of CAPTURE_SLOTS) slots[slot] = { ...slots[slot], status: 'approved' as const };
      return { ...current, slots, phase: 'ready', activeSlot: 'measurement', error: null };
    });
  }, [updateState]);

  const reportConnectionState = useCallback((connectionState: ConnectionState, error?: string) => {
    updateState((current) => ({
      ...current,
      connectionState,
      phase: connectionState === 'disconnected' && !['idle', 'review', 'ready'].includes(current.phase) ? 'fallback' : current.phase,
      error: error ?? (connectionState === 'disconnected' && !['review', 'ready'].includes(current.phase) ? 'AI撮影アシスタントが切断されました。固定ガイドと手動撮影を利用できます。' : null),
    }));
  }, [updateState]);

  const reportGuidance = useCallback((event: GuidanceEvent) => {
    const now = Date.now();
    const snapshot = stateRef.current;
    const latestSequence = snapshot.latestGuidance?.sequence ?? 0;
    if (!snapshot.sessionId || event.sessionId !== snapshot.sessionId || !Number.isInteger(event.sequence) || event.sequence <= latestSequence || event.sequence <= transportSequenceRef.current || !Number.isFinite(event.observedAt) || !Number.isFinite(event.expiresAt) || event.expiresAt <= event.observedAt || now >= event.expiresAt) return;
    transportSequenceRef.current = event.sequence;
    updateState((current) => {
      if (!current.sessionId || event.sessionId !== current.sessionId) return current;
      return {
        ...current,
        latestGuidance: event,
        error: event.code === 'AGENT_UNAVAILABLE' ? 'ライブ案内を利用できません。固定ガイドと手動撮影を利用できます。' : null,
        phase: event.code === 'AGENT_UNAVAILABLE' && current.phase !== 'idle' && current.phase !== 'ready' ? 'fallback' : current.phase,
      };
    });
  }, [updateState]);

  const reportState = useCallback((event: GuidanceStateEvent) => {
    const snapshot = stateRef.current;
    if (!snapshot.sessionId || event.sessionId !== snapshot.sessionId || !Number.isInteger(event.sequence) || event.sequence < 1 || event.sequence <= transportSequenceRef.current) return;
    transportSequenceRef.current = event.sequence;
    updateState((current) => {
      if (!current.sessionId || event.sessionId !== current.sessionId) return current;
      // Reliable state is authoritative for the active shot. A state packet
      // intentionally has no expiry/confidence, so never synthesize a public
      // GuidanceEvent from it; clear any advice belonging to the old shot.
      // Keep the local phase/status coherent with a server-side resync so a
      // reconnect cannot leave the camera pointed at the wrong capture step.
      if (event.shot === null) return { ...current, latestGuidance: null, error: null };
      const activeProgress = current.slots[event.shot];
      const nextPhase = event.shot === 'measurement'
        ? 'measurement'
        : activeProgress.status === 'approved'
          ? 'review'
          : 'capturing';
      return {
        ...current,
        activeSlot: event.shot,
        phase: nextPhase,
        latestGuidance: null,
        slots: {
          ...current.slots,
          [event.shot]: activeProgress.status === 'pending'
            ? { ...activeProgress, status: 'active' as const }
            : activeProgress,
        },
        error: null,
      };
    });
  }, [updateState]);

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

  const getListingHandoff = useCallback((): GuidedCaptureHandoff | null => {
    const current = stateRef.current;
    if (!current.sessionId || current.phase !== 'ready' || !allImageSlotsApproved(current.slots) || !isApprovedMeasurement(current.measurement)) return null;
    const handoff = createListingHandoff({ sessionId: current.sessionId, slots: current.slots, measurement: current.measurement, background: { status: current.backgroundApproval } });
    return handoff.images.length === CAPTURE_SLOTS.length && handoff.garmentMeasurements ? handoff : null;
  }, []);

  return useMemo(() => ({ state, start, retryConnection, stop, selectSlot, recordMedia, recordMeasurement, replaceMedia, removeMedia, retakeMeasurement, updateMeasurement, approveMeasurement, approveCapture, approveBackground, reportConnectionState, reportGuidance, reportState, publishCameraStream, getListingHandoff }), [approveBackground, approveCapture, approveMeasurement, getListingHandoff, publishCameraStream, recordMedia, recordMeasurement, removeMedia, replaceMedia, reportConnectionState, reportGuidance, reportState, retakeMeasurement, retryConnection, selectSlot, start, state, stop, updateMeasurement]);
};
