import {
  GUIDANCE_CODES,
  SESSION_SLOTS,
  type ConnectionState,
  type GuidanceEvent,
  type ProviderError,
} from "../core/types.ts";

export interface LiveKitTokenResponse {
  readonly token: string;
  readonly participantIdentity: string;
  readonly roomName: string;
  readonly expiresAt: string;
  readonly livekitUrl: string;
}

export interface LiveKitTokenProvider {
  getToken(sessionId: string): Promise<LiveKitTokenResponse>;
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
  sendData(payload: Uint8Array, options: { readonly reliable: boolean; readonly topic?: string }): Promise<void>;
  on(event: "connectionStateChanged", listener: (state: LiveKitRoomConnectionState) => void): () => void;
  on(event: "dataReceived", listener: (payload: LiveKitDataPayload) => void): () => void;
}

export interface LiveKitAdapterOptions {
  readonly now?: () => number;
  readonly onGuidance?: (event: GuidanceEvent) => void;
  readonly onError?: (error: ProviderError) => void;
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

function parseGuidanceEvent(
  payload: LiveKitDataPayload,
  sessionId: string,
  latestSequence: number,
  now: number,
): GuidanceEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(decodePayload(payload));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (
    value.sessionId !== sessionId ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) <= latestSequence ||
    !isSessionSlot(value.shot) ||
    !isGuidanceCode(value.code) ||
    !nonEmptyString(value.message) ||
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
  private readonly onError?: (error: ProviderError) => void;
  private readonly unsubscribe: Array<() => void> = [];
  private sessionId: string | null = null;
  private state: ConnectionState = "disconnected";
  private latestSequence = 0;

  public constructor(
    room: LiveKitRoomPort,
    tokenProvider: LiveKitTokenProvider,
    options: LiveKitAdapterOptions = {},
  ) {
    this.room = room;
    this.tokenProvider = tokenProvider;
    this.now = options.now ?? (() => Date.now());
    this.onGuidance = options.onGuidance;
    this.onError = options.onError;
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
    this.setState("connecting");
    try {
      const token = await this.tokenProvider.getToken(sessionId);
      if (!nonEmptyString(token.token) || !nonEmptyString(token.livekitUrl)) {
        throw new LiveKitAdapterError("INVALID_RESPONSE", "LiveKit token response is incomplete.");
      }
      this.registerRoomListeners();
      await this.room.connect(token.livekitUrl, token.token);
      this.setState("connected");
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
      await this.room.disconnect();
    } finally {
      this.sessionId = null;
      this.latestSequence = 0;
      this.setState("disconnected");
    }
  }

  public async publishCameraTrack(track: LiveKitCameraTrack): Promise<void> {
    if (this.state !== "connected") {
      throw new LiveKitAdapterError("UNAVAILABLE", "LiveKit room is not connected.");
    }
    await this.room.publishTrack(track);
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
      this.room.on("connectionStateChanged", (state) => this.setState(state)),
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
  }

  private handleData(payload: LiveKitDataPayload): void {
    if (this.sessionId === null) {
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
}

export function createLiveKitAdapter(
  room: LiveKitRoomPort,
  tokenProvider: LiveKitTokenProvider,
  options: LiveKitAdapterOptions = {},
): LiveKitAdapter {
  return new LiveKitAdapter(room, tokenProvider, options);
}
