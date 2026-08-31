import {
  ShotAssessmentSchema,
  type ShotAssessment as ContractShotAssessment,
} from '../../../types/guidedCapture.ts';
import {
  MeasurementPointSuggestionSchema,
  type MeasurementPointSuggestion,
} from '../../../types/measurement.ts';
import type {
  AdapterConnection,
  CaptureRequest,
  GuidedCaptureAdapter,
  GuidanceEvent,
  GuidanceStateEvent,
  MeasurementDraft,
  MeasurementRequest,
  SessionSlot,
  ShotAssessment,
} from './contracts';
import type { LiveKitAdapter, LiveKitStateEvent } from '../adapters/liveKitAdapter.ts';
import { LiveKitHttpTokenProvider } from '../adapters/liveKitHttpTokenProvider.ts';

export interface GuidedCaptureHttpAdapterOptions {
  /** Public browser URL only; API secrets never belong here. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  mode?: 'fixture' | 'live';
}

export class GuidedCaptureHttpError extends Error {
  public readonly status: number;
  public readonly retryable: boolean;

  public constructor(message: string, status = 503, retryable = true) {
    super(message);
    this.name = 'GuidedCaptureHttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

const trimBaseUrl = (value: string): string => value.trim().replace(/\/+$/u, '');
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;
const isValidSessionId = (value: string): boolean => SESSION_ID_PATTERN.test(value);

const asContractAssessment = (value: ContractShotAssessment): ShotAssessment => ({
  shotType: value.shotType,
  quality: value.quality,
  issues: [...value.issues],
  missingShots: [...value.missingShots],
  nextAction: value.nextAction,
});

const errorMessage = (body: unknown, fallback: string): string => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const requestError = async (response: Response, fallback: string): Promise<GuidedCaptureHttpError> => {
  const body = await readJson(response);
  const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
  return new GuidedCaptureHttpError(errorMessage(body, fallback), response.status, retryable);
};

const measurementDraftFromSuggestion = (suggestion: MeasurementPointSuggestion): MeasurementDraft => ({
  endpoints: {
    lengthStart: suggestion.lengthStart,
    lengthEnd: suggestion.lengthEnd,
    widthStart: suggestion.widthStart,
    widthEnd: suggestion.widthEnd,
  },
  // The HTTP contract returns points only. A local calibration/worker or the
  // user must provide centimetres before the approval action can proceed.
  lengthCm: null,
  widthCm: null,
  source: 'ai',
});

/**
 * Browser adapter for the separate Python service. It is intentionally small:
 * health, post-capture assessment, and measurement-point suggestion only.
 * LiveKit owns live video transport and is injected through its own adapter.
 */
export class GuidedCaptureHttpAdapter implements GuidedCaptureAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly mode: 'fixture' | 'live';
  private liveKitAdapter: LiveKitAdapter | null = null;
  private readonly connectionListeners = new Set<(connectionState: AdapterConnection['connectionState'] | 'disconnected', error?: string) => void>();
  private readonly guidanceListeners = new Set<(event: GuidanceEvent) => void>();
  private readonly stateListeners = new Set<(event: GuidanceStateEvent) => void>();

  public constructor(options: GuidedCaptureHttpAdapterOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl);
    if (!this.baseUrl) throw new TypeError('baseUrl must not be empty');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.mode = options.mode ?? 'fixture';
  }

  public async connect(sessionId: string): Promise<AdapterConnection> {
    if (!isValidSessionId(sessionId)) throw new GuidedCaptureHttpError('撮影セッションIDが不正です。', 422, false);
    const previousAdapter = this.liveKitAdapter;
    this.liveKitAdapter = null;
    if (previousAdapter) {
      try {
        await previousAdapter.disconnect();
      } catch {
        // A stale room must not prevent a new session from being attempted.
      }
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/health`, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
      });
    } catch {
      throw new GuidedCaptureHttpError('撮影アシスタントAPIに接続できません。', 503, true);
    }
    if (!response.ok) throw await requestError(response, '撮影アシスタントAPIに接続できません。');
    const body = await readJson(response);
    if (typeof body !== 'object' || body === null || (body as { status?: unknown }).status !== 'ok') {
      throw new GuidedCaptureHttpError('撮影アシスタントAPIの応答が不正です。', 502, true);
    }
    if (this.mode === 'live') {
      const [{ LiveKitAdapter: LiveKitAdapterConstructor }, { createLiveKitClientRoomPort }] = await Promise.all([
        import('../adapters/liveKitAdapter.ts'),
        import('../adapters/liveKitRoomAdapter.ts'),
      ]);
      const room = createLiveKitClientRoomPort();
      const adapter = new LiveKitAdapterConstructor(room, new LiveKitHttpTokenProvider({ baseUrl: this.baseUrl }), {
        onConnectionState: (connectionState) => this.notifyConnection(connectionState),
        onGuidance: (event) => this.notifyGuidance(event),
        onState: (event) => this.notifyState(event),
        onError: (error) => this.notifyConnection('disconnected', error.message),
      });
      this.liveKitAdapter = adapter;
      try {
        await adapter.connect(sessionId);
      } catch (error) {
        try {
          await adapter.disconnect();
        } catch {
          // Keep the original connection error as the user-facing cause.
        }
        if (this.liveKitAdapter === adapter) this.liveKitAdapter = null;
        throw error;
      }
    }
    return { connectionState: 'connected', transport: this.mode };
  }

  public async disconnect(): Promise<void> {
    const adapter = this.liveKitAdapter;
    this.liveKitAdapter = null;
    try {
      await adapter?.disconnect();
    } finally {
      this.notifyConnection('disconnected');
    }
  }

  public subscribeConnection(listener: (connectionState: AdapterConnection['connectionState'] | 'disconnected', error?: string) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  public subscribeGuidance(listener: (event: GuidanceEvent) => void): () => void {
    this.guidanceListeners.add(listener);
    return () => this.guidanceListeners.delete(listener);
  }

  public subscribeState(listener: (event: GuidanceStateEvent) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public async setActiveShot(slot: SessionSlot): Promise<void> {
    if (this.mode !== 'live') return;
    const adapter = this.liveKitAdapter;
    const sessionId = adapter?.activeSessionId;
    if (!adapter || !sessionId) {
      throw new GuidedCaptureHttpError('LiveKit接続が確立していません。', 503, true);
    }
    await adapter.sendGuidanceRpc(
      { type: 'set_shot', sessionId, shot: slot },
      { reliable: true, topic: 'capture' },
    );
  }

  public async publishCameraStream(stream: MediaStream): Promise<void> {
    if (this.mode === 'live' && !this.liveKitAdapter) throw new GuidedCaptureHttpError('LiveKit接続が確立していません。', 503, true);
    if (this.liveKitAdapter) await this.liveKitAdapter.publishCameraStream(stream);
  }

  private notifyConnection(connectionState: AdapterConnection['connectionState'] | 'disconnected', error?: string): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(connectionState, error);
      } catch {
        // A UI observer must not break the transport lifecycle.
      }
    }
  }

  private notifyGuidance(event: GuidanceEvent): void {
    for (const listener of this.guidanceListeners) {
      try {
        listener(event);
      } catch {
        // A UI observer must not break subsequent guidance events.
      }
    }
  }

  private notifyState(event: LiveKitStateEvent): void {
    for (const listener of this.stateListeners) {
      try {
        listener(event);
      } catch {
        // A UI observer must not break subsequent state packets.
      }
    }
  }

  public async assessShot(request: CaptureRequest): Promise<ShotAssessment> {
    if (!request.blob) throw new GuidedCaptureHttpError('撮影画像が見つかりません。', 422, false);
    const form = new FormData();
    form.append('requestedShot', request.slot);
    form.append('file', request.blob, `guided-${request.slot}.jpg`);
    const response = await this.fetchImpl(`${this.baseUrl}/api/analyze-shot`, {
      method: 'POST',
      body: form,
      credentials: 'omit',
    });
    if (!response.ok) throw await requestError(response, '撮影画像の判定に失敗しました。');
    const parsed = ShotAssessmentSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new GuidedCaptureHttpError('撮影判定の応答が不正です。', 502, true);
    return asContractAssessment(parsed.data);
  }

  public async suggestMeasurement(request: MeasurementRequest): Promise<MeasurementDraft> {
    const form = new FormData();
    form.append('file', request.blob, 'guided-measurement.jpg');
    const response = await this.fetchImpl(`${this.baseUrl}/api/suggest-measurement-points`, {
      method: 'POST',
      body: form,
      credentials: 'omit',
    });
    if (!response.ok) throw await requestError(response, '採寸点の提案に失敗しました。');
    const parsed = MeasurementPointSuggestionSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new GuidedCaptureHttpError('採寸点の応答が不正です。', 502, true);
    return measurementDraftFromSuggestion(parsed.data);
  }
}

export function createHttpGuidedCaptureAdapter(
  options: GuidedCaptureHttpAdapterOptions,
): GuidedCaptureHttpAdapter {
  return new GuidedCaptureHttpAdapter(options);
}

/** Vite exposes only VITE_* values to browser code, never provider secrets. */
export function configuredGuidedCaptureApiUrl(): string | null {
  const runtime = import.meta as ImportMeta & { env?: Record<string, unknown> };
  const value = runtime.env?.VITE_LISTING_ASSISTANT_API_URL;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function createConfiguredGuidedCaptureAdapter(): GuidedCaptureAdapter | undefined {
  const baseUrl = configuredGuidedCaptureApiUrl();
  if (!baseUrl) return undefined;
  const runtime = import.meta as ImportMeta & { env?: Record<string, unknown> };
  const mode = runtime.env?.VITE_LISTING_ASSISTANT_MODE === 'live' ? 'live' : 'fixture';
  return createHttpGuidedCaptureAdapter({ baseUrl, mode });
}
