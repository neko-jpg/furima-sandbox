import {
  IMAGE_SLOTS,
  SESSION_SLOTS,
  type GuidanceCode,
  type GuidanceEvent,
  type ImageSlot,
  type MeasurementDraft,
  type ProviderError,
  type SessionSlot,
  type ShotAssessment,
} from "../core/types.ts";

export type FixtureShotOutcome = "ok" | "retry" | "wrong-shot";

export interface FixtureAdapterOptions {
  readonly outcomeBySlot?: Partial<Record<ImageSlot, FixtureShotOutcome>>;
  readonly now?: () => number;
}

export interface FixtureConnection {
  readonly connectionState: "connected";
  readonly transport: "fixture";
  readonly sessionId: string;
}

export interface FixtureShotRequest {
  readonly sessionId: string;
  readonly slot: ImageSlot;
  readonly blob: Blob;
  readonly requestId: string;
  readonly sequence: number;
}

export interface FixtureMeasurementRequest {
  readonly sessionId: string;
  readonly blob: Blob;
  readonly imageId?: string;
  readonly requestId: string;
  readonly sequence: number;
}

export interface FixtureResponse<T> {
  readonly accepted: boolean;
  readonly sessionId: string;
  readonly requestId: string;
  readonly sequence: number;
  readonly value?: T;
  readonly error?: ProviderError;
}

const DEFAULT_MEASUREMENT_ENDPOINTS = {
  lengthStart: { x: 0.5, y: 0.12 },
  lengthEnd: { x: 0.5, y: 0.88 },
  widthStart: { x: 0.2, y: 0.5 },
  widthEnd: { x: 0.8, y: 0.5 },
} as const;

function error(
  code: ProviderError["code"],
  message: string,
  retryable: boolean,
): ProviderError {
  return { provider: "capture-session", code, message, retryable };
}

function resultError<T>(
  request: Pick<FixtureShotRequest, "sessionId" | "requestId" | "sequence">,
  providerError: ProviderError,
): FixtureResponse<T> {
  return {
    accepted: false,
    sessionId: request.sessionId,
    requestId: request.requestId,
    sequence: request.sequence,
    error: providerError,
  };
}

function resultValue<T>(
  request: Pick<FixtureShotRequest, "sessionId" | "requestId" | "sequence">,
  value: T,
): FixtureResponse<T> {
  return {
    accepted: true,
    sessionId: request.sessionId,
    requestId: request.requestId,
    sequence: request.sequence,
    value,
  };
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function assertSessionId(sessionId: string): void {
  if (sessionId.trim() === "") {
    throw new TypeError("sessionId must not be empty");
  }
}

/**
 * Deterministic fixture transport for the guided-capture vertical slice.
 *
 * It models the same request identity checks as a remote provider, but never
 * calls fetch and never stores media outside this in-memory session instance.
 */
export class FixtureCaptureAdapter {
  private readonly outcomeBySlot: Partial<Record<ImageSlot, FixtureShotOutcome>>;
  private readonly now: () => number;
  private sessionId: string | null = null;
  private highestSequence = 0;
  private readonly seenRequests = new Set<string>();
  private readonly acceptedShots = new Set<ImageSlot>();

  public constructor(options: FixtureAdapterOptions = {}) {
    this.outcomeBySlot = options.outcomeBySlot ?? {};
    this.now = options.now ?? (() => Date.now());
  }

  public get connected(): boolean {
    return this.sessionId !== null;
  }

  public get activeSessionId(): string | null {
    return this.sessionId;
  }

  public get lastSequence(): number {
    return this.highestSequence;
  }

  public async connect(sessionId: string): Promise<FixtureConnection> {
    assertSessionId(sessionId);
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId;
      this.highestSequence = 0;
      this.seenRequests.clear();
      this.acceptedShots.clear();
    }
    return { connectionState: "connected", transport: "fixture", sessionId };
  }

  public disconnect(): void {
    this.sessionId = null;
    this.highestSequence = 0;
    this.seenRequests.clear();
    this.acceptedShots.clear();
  }

  public assessShot(request: FixtureShotRequest): Promise<FixtureResponse<ShotAssessment>> {
    const rejected = this.validateRequest(request, request.slot);
    if (rejected !== null) {
      return Promise.resolve(resultError(request, rejected));
    }
    const outcome = this.outcomeBySlot[request.slot] ?? "ok";
    if (outcome === "retry") {
      return Promise.resolve(resultValue(request, {
        shotType: request.slot,
        quality: "retry",
        issues: ["BLURRY"],
        missingShots: IMAGE_SLOTS.filter((slot) => !this.acceptedShots.has(slot)),
        nextAction: "RETAKE",
      }));
    }
    if (outcome === "wrong-shot") {
      return Promise.resolve(resultValue(request, {
        shotType: "unknown",
        quality: "retry",
        issues: ["WRONG_SHOT"],
        missingShots: IMAGE_SLOTS.filter((slot) => !this.acceptedShots.has(slot)),
        nextAction: "RETAKE",
      }));
    }

    this.acceptedShots.add(request.slot);
    const missingShots = IMAGE_SLOTS.filter((slot) => !this.acceptedShots.has(slot));
    return Promise.resolve(resultValue(request, {
      shotType: request.slot,
      quality: "ok",
      issues: [],
      missingShots,
      nextAction: missingShots.length === 0 ? "COMPLETE" : "REQUEST_NEXT",
    }));
  }

  public suggestMeasurementPoints(
    request: FixtureMeasurementRequest,
  ): Promise<FixtureResponse<MeasurementDraft>> {
    const rejected = this.validateRequest(request, "measurement");
    if (rejected !== null) {
      return Promise.resolve(resultError(request, rejected));
    }
    if (!isBlob(request.blob)) {
      return Promise.resolve(resultError(request, error("INVALID_INPUT", "A measurement image is required.", false)));
    }
    const draft: MeasurementDraft = {
      imageId: request.imageId?.trim() || `fixture-measurement-${request.sequence}`,
      endpoints: DEFAULT_MEASUREMENT_ENDPOINTS,
      lengthCm: 68,
      widthCm: 52,
      confidence: 0.98,
      source: "ai",
      status: "needs_review",
    };
    return Promise.resolve(resultValue(request, draft));
  }

  public guidance(
    slot: SessionSlot,
    code: GuidanceCode = "READY",
    message = "固定ガイド: 撮影位置を確認してください。",
  ): GuidanceEvent | null {
    if (this.sessionId === null) {
      return null;
    }
    const observedAt = this.now();
    const sequence = this.highestSequence + 1;
    this.highestSequence = sequence;
    return {
      sessionId: this.sessionId,
      sequence,
      shot: slot,
      code,
      message,
      confidence: 1,
      observedAt,
      expiresAt: observedAt + 2_000,
    };
  }

  private validateRequest(
    request: Pick<FixtureShotRequest, "sessionId" | "requestId" | "sequence" | "blob">,
    slot: SessionSlot,
  ): ProviderError | null {
    if (this.sessionId === null || request.sessionId !== this.sessionId) {
      return error("STALE_SESSION", "The capture session is no longer active.", false);
    }
    if (!isBlob(request.blob)) {
      return error("INVALID_INPUT", "An image Blob is required.", false);
    }
    if (request.requestId.trim() === "") {
      return error("INVALID_INPUT", "requestId must not be empty.", false);
    }
    if (!Number.isInteger(request.sequence) || request.sequence <= this.highestSequence) {
      return error("STALE_SEQUENCE", "The capture sequence is stale.", false);
    }
    if (this.seenRequests.has(request.requestId)) {
      return error("STALE_REQUEST", "The request was already handled.", false);
    }
    if (!SESSION_SLOTS.includes(slot)) {
      return error("INVALID_INPUT", "The capture slot is invalid.", false);
    }

    this.highestSequence = request.sequence;
    this.seenRequests.add(request.requestId);
    return null;
  }
}

export function createFixtureCaptureAdapter(
  options: FixtureAdapterOptions = {},
): FixtureCaptureAdapter {
  return new FixtureCaptureAdapter(options);
}
