import {
  GUIDANCE_CODES,
  SESSION_SLOTS,
  type ConnectionState,
  type GuidanceEvent,
  type ProviderError,
} from "../core/types.ts";

const GUIDANCE_MESSAGES: Readonly<Record<GuidanceEvent["code"], string>> = {
  MOVE_CLOSER: "カメラを少し近づけてください。",
  MOVE_FARTHER: "カメラを少し離してください。",
  CENTER_GARMENT: "衣類をガイドの中央に合わせてください。",
  SHOW_FULL_GARMENT: "衣類全体が入るようにカメラを離してください。",
  WRONG_SIDE: "衣類を裏返して、指定された面を見せてください。",
  MOVE_TO_TAG: "タグが見える位置へ移動してください。",
  PLACE_MARKER: "専用マーカーを衣類の右下に置いてください。",
  MARKER_NOT_VISIBLE: "専用マーカー全体が見えるようにしてください。",
  FLATTEN_GARMENT: "襟、袖、裾を広げて、しわを伸ばしてください。",
  CAMERA_OVERHEAD: "カメラを衣類の真上に構えてください。",
  HOLD_STEADY: "カメラを動かさず、そのまま保ってください。",
  READY: "撮影できます。",
  AGENT_UNAVAILABLE: "ライブ案内を利用できません。固定ガイドで撮影できます。",
};

export interface LiveKitTokenResponse {
  readonly token: string;
  readonly participantIdentity: string;
  readonly roomName: string;
  /** Unix epoch seconds as returned by the Python token endpoint. */
  readonly expiresAt: number;
  readonly livekitUrl: string;
}

export interface LiveKitTokenProvider {
  getToken(sessionId: string): Promise<LiveKitTokenResponse>;
}

export interface LiveKitStateEvent {
  readonly type: "shot_changed" | "resync";
  readonly sessionId: string;
  readonly sequence: number;
  readonly shot: GuidanceEvent["shot"] | null;
  readonly code: GuidanceEvent["code"] | null;
  readonly observedAt: number;
}

export type LiveKitRoomConnectionState = ConnectionState;
export type LiveKitDataPayload = string | Uint8Array | ArrayBuffer;

export interface LiveKitCameraTrack {
  readonly kind?: "video" | string;
}

export interface LiveKitRoomPort {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void> | void;
  publishTrack(track: LiveKitCameraTrack): Promise<void>;
  publishCameraStream?(stream: MediaStream): Promise<void>;
  /** Remove the camera track owned by publishCameraStream, when supported. */
  unpublishCameraStream?(): Promise<void> | void;
  sendData(payload: Uint8Array, options: { readonly reliable: boolean; readonly topic?: string }): Promise<void>;
  on(event: "connectionStateChanged", listener: (state: LiveKitRoomConnectionState) => void): () => void;
  on(event: "dataReceived", listener: (payload: LiveKitDataPayload) => void): () => void;
}

export interface LiveKitAdapterOptions {
  readonly now?: () => number;
  readonly onGuidance?: (event: GuidanceEvent) => void;
  readonly onState?: (event: LiveKitStateEvent) => void;
  readonly onError?: (error: ProviderError) => void;
  readonly onConnectionState?: (state: ConnectionState) => void;
}

export class LiveKitAdapterError extends Error {
  public readonly code: ProviderError["code"];

  public constructor(code: ProviderError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveKitAdapterError";
    this.code = code;
  }
}

function providerError(
  code: ProviderError["code"],
  message: string,
  retryable: boolean,
): ProviderError {
  return { provider: "livekit", code, message, retryable };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function decodePayload(payload: LiveKitDataPayload): string {
  if (typeof payload === "string") {
    return payload;
  }
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  return new TextDecoder().decode(bytes);
}

function isGuidanceCode(value: unknown): value is GuidanceEvent["code"] {
  return typeof value === "string" && (GUIDANCE_CODES as readonly string[]).includes(value);
}

function isSessionSlot(value: unknown): value is GuidanceEvent["shot"] {
  return typeof value === "string" && (SESSION_SLOTS as readonly string[]).includes(value);
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function decodeJsonObject(payload: LiveKitDataPayload): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(decodePayload(payload));
  } catch {
    return null;
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function parseStateEvent(
  payload: LiveKitDataPayload,
  sessionId: string,
  latestSequence: number,
): LiveKitStateEvent | null {
  const value = decodeJsonObject(payload);
  if (
    value === null
    || Object.keys(value).length !== 6
    || value.type !== "shot_changed" && value.type !== "resync"
    || value.sessionId !== sessionId
    || !Number.isInteger(value.sequence)
    || (value.sequence as number) <= latestSequence
    || (value.shot !== null && !isSessionSlot(value.shot))
    || (value.code !== null && !isGuidanceCode(value.code))
    || !isFiniteNonNegativeInteger(value.observedAt)
  ) {
    return null;
  }
  return {
    type: value.type,
    sessionId,
    sequence: value.sequence as number,
    shot: value.shot as LiveKitStateEvent["shot"],
    code: value.code as LiveKitStateEvent["code"],
    observedAt: value.observedAt,
  };
}

function parseGuidanceEvent(
  payload: LiveKitDataPayload,
  sessionId: string,
  latestSequence: number,
  now: number,
): GuidanceEvent | null {
  const value = decodeJsonObject(payload);
  if (value === null || Object.keys(value).length !== 8) {
    return null;
  }
  if (
    value.sessionId !== sessionId ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) <= latestSequence ||
    !isSessionSlot(value.shot) ||
    !isGuidanceCode(value.code) ||
    !nonEmptyString(value.message) ||
    value.message !== GUIDANCE_MESSAGES[value.code] ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    typeof value.observedAt !== "number" ||
    !Number.isFinite(value.observedAt) ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= value.observedAt ||
    now >= value.expiresAt
  ) {
    return null;
  }
  return {
    sessionId,
    sequence: value.sequence as number,
    shot: value.shot,
    code: value.code,
    message: value.message,
    confidence: value.confidence,
    observedAt: value.observedAt,
    expiresAt: value.expiresAt,
  };
}

/**
 * SDK-free LiveKit boundary.  A tiny room port can be implemented with the
 * actual LiveKit client later, without importing that dependency into the
 * browser feature or its tests.
 */
export class LiveKitAdapter {
  private readonly room: LiveKitRoomPort;
  private readonly tokenProvider: LiveKitTokenProvider;
  private readonly now: () => number;
  private readonly onGuidance?: (event: GuidanceEvent) => void;
  private readonly onState?: (event: LiveKitStateEvent) => void;
  private readonly onError?: (error: ProviderError) => void;
  private readonly onConnectionState?: (state: ConnectionState) => void;
  private readonly unsubscribe: Array<() => void> = [];
  private sessionId: string | null = null;
  private state: ConnectionState = "disconnected";
  private latestSequence = 0;
  private needsResync = false;
  private resyncInFlight: Promise<void> | null = null;
  private publishedCameraStream: MediaStream | null = null;
  private cameraOperation: Promise<void> = Promise.resolve();

  public constructor(
    room: LiveKitRoomPort,
    tokenProvider: LiveKitTokenProvider,
    options: LiveKitAdapterOptions = {},
  ) {
    this.room = room;
    this.tokenProvider = tokenProvider;
    this.now = options.now ?? (() => Date.now());
    this.onGuidance = options.onGuidance;
    this.onState = options.onState;
    this.onError = options.onError;
    this.onConnectionState = options.onConnectionState;
  }

  public get connectionState(): ConnectionState {
    return this.state;
  }

  public get activeSessionId(): string | null {
    return this.sessionId;
  }

  public get lastSequence(): number {
    return this.latestSequence;
  }

  public async connect(sessionId: string): Promise<void> {
    if (!nonEmptyString(sessionId)) {
      throw new LiveKitAdapterError("INVALID_INPUT", "sessionId must not be empty.");
    }
    if (this.sessionId !== null && this.sessionId !== sessionId) {
      await this.disconnect();
    }
    this.sessionId = sessionId;
    this.latestSequence = 0;
    this.needsResync = false;
    this.resyncInFlight = null;
    this.setState("connecting");
    try {
      const token = await this.tokenProvider.getToken(sessionId);
      if (!nonEmptyString(token.token) || !nonEmptyString(token.livekitUrl)) {
        throw new LiveKitAdapterError("INVALID_RESPONSE", "LiveKit token response is incomplete.");
      }
      this.registerRoomListeners();
      await this.room.connect(token.livekitUrl, token.token);
      this.handleConnectionState("connected");
    } catch (error) {
      this.setState("disconnected");
      const mapped = error instanceof LiveKitAdapterError
        ? error
        : new LiveKitAdapterError("UNAVAILABLE", "LiveKit connection failed.", { cause: error });
      this.report(providerError(mapped.code, mapped.message, mapped.code === "UNAVAILABLE"));
      throw mapped;
    }
  }

  public async disconnect(): Promise<void> {
    this.removeRoomListeners();
    try {
      await this.enqueueCameraOperation(() => this.disconnectRoom());
    } finally {
      this.publishedCameraStream = null;
      this.sessionId = null;
      this.latestSequence = 0;
      this.needsResync = false;
      this.resyncInFlight = null;
      this.setState("disconnected");
    }
  }

  public async publishCameraTrack(track: LiveKitCameraTrack): Promise<void> {
    if (this.state !== "connected") {
      throw new LiveKitAdapterError("UNAVAILABLE", "LiveKit room is not connected.");
    }
    await this.room.publishTrack(track);
  }

  public async publishCameraStream(stream: MediaStream): Promise<void> {
    await this.enqueueCameraOperation(async () => {
      if (this.state !== "connected") {
        throw new LiveKitAdapterError("UNAVAILABLE", "LiveKit room is not connected.");
      }
      if (!this.room.publishCameraStream) {
        throw new LiveKitAdapterError("UNAVAILABLE", "This LiveKit room port cannot publish a camera stream.");
      }
      if (this.publishedCameraStream === stream) return;
      if (this.publishedCameraStream !== null) {
        await this.room.unpublishCameraStream?.();
      }
      this.publishedCameraStream = null;
      await this.room.publishCameraStream(stream);
      this.publishedCameraStream = stream;
    });
  }

  public async unpublishCameraStream(): Promise<void> {
    await this.enqueueCameraOperation(async () => {
      await this.room.unpublishCameraStream?.();
      this.publishedCameraStream = null;
    });
  }

  public async sendGuidanceRpc(
    payload: Record<string, unknown>,
    options: { readonly reliable?: boolean; readonly topic?: string } = {},
  ): Promise<void> {
    if (this.state !== "connected") {
      throw new LiveKitAdapterError("UNAVAILABLE", "LiveKit room is not connected.");
    }
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    await this.room.sendData(encoded, {
      reliable: options.reliable ?? true,
      topic: options.topic,
    });
  }

  private registerRoomListeners(): void {
    this.removeRoomListeners();
    this.unsubscribe.push(
      this.room.on("connectionStateChanged", (state) => this.handleConnectionState(state)),
      this.room.on("dataReceived", (payload) => this.handleData(payload)),
    );
  }

  private removeRoomListeners(): void {
    while (this.unsubscribe.length > 0) {
      this.unsubscribe.pop()?.();
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.onConnectionState?.(state);
  }

  private handleConnectionState(state: ConnectionState): void {
    const previous = this.state;
    if (state === "reconnecting" || state === "disconnected") {
      this.needsResync = true;
    }
    this.setState(state);
    if (state === "connected" && previous !== "connected" && this.needsResync) {
      void this.resyncAfterReconnect();
    }
  }

  private async resyncAfterReconnect(): Promise<void> {
    if (this.resyncInFlight !== null || this.sessionId === null || this.state !== "connected") {
      return this.resyncInFlight ?? Promise.resolve();
    }
    const sessionId = this.sessionId;
    const task = (async () => {
      try {
        await this.sendGuidanceRpc(
          { type: "resync", sessionId },
          { reliable: true, topic: "capture" },
        );
        if (this.sessionId === sessionId) this.needsResync = false;
      } catch (error) {
        this.report(providerError("UNAVAILABLE", "LiveKit resync failed.", true));
        throw error;
      }
    })();
    this.resyncInFlight = task;
    try {
      await task;
    } catch {
      // Connection observers receive the mapped error; the next connected
      // transition can retry the reliable resync.
    } finally {
      if (this.resyncInFlight === task) this.resyncInFlight = null;
    }
  }

  private handleData(payload: LiveKitDataPayload): void {
    if (this.sessionId === null) {
      return;
    }
    const stateEvent = parseStateEvent(payload, this.sessionId, this.latestSequence);
    if (stateEvent !== null) {
      this.latestSequence = stateEvent.sequence;
      this.onState?.(stateEvent);
      return;
    }
    const event = parseGuidanceEvent(payload, this.sessionId, this.latestSequence, this.now());
    if (event === null) {
      return;
    }
    this.latestSequence = event.sequence;
    this.onGuidance?.(event);
  }

  private report(error: ProviderError): void {
    try {
      this.onError?.(error);
    } catch {
      // Error observers cannot be allowed to break transport handling.
    }
  }

  /** Serialize camera replacement and teardown without making FakeRoom ports implement a mutex. */
  private enqueueCameraOperation(operation: () => Promise<void> | void): Promise<void> {
    const next = this.cameraOperation.catch(() => undefined).then(operation);
    this.cameraOperation = next.catch(() => undefined);
    return next;
  }

  private async disconnectRoom(): Promise<void> {
    let firstError: unknown = null;
    if (this.publishedCameraStream !== null) {
      try {
        await this.room.unpublishCameraStream?.();
      } catch (error) {
        firstError = error;
      }
    }
    this.publishedCameraStream = null;
    try {
      await this.room.disconnect();
    } catch (error) {
      if (firstError === null) firstError = error;
    }
    if (firstError !== null) throw firstError;
  }
}

export function createLiveKitAdapter(
  room: LiveKitRoomPort,
  tokenProvider: LiveKitTokenProvider,
  options: LiveKitAdapterOptions = {},
): LiveKitAdapter {
  return new LiveKitAdapter(room, tokenProvider, options);
}
