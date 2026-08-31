/**
 * Local guided-capture contracts.
 *
 * These types intentionally live below the feature boundary while the shared
 * API contracts are being integrated.  They are serializable where possible,
 * and do not import React, a transport SDK, or an application domain type.
 */

export const SESSION_SLOTS = ["front", "back", "tag", "measurement"] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

export const IMAGE_SLOTS = ["front", "back", "tag"] as const;
export type ImageSlot = (typeof IMAGE_SLOTS)[number];

export const SHOT_TYPES = ["front", "back", "tag", "unknown"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const SHOT_ISSUE_CODES = [
  "TOO_DARK",
  "TOO_BRIGHT",
  "TOO_BLURRY",
  "BLURRY",
  "GARMENT_CROPPED",
  "TAG_UNREADABLE",
  "WRONG_SHOT",
] as const;
export type ShotIssueCode = (typeof SHOT_ISSUE_CODES)[number];

export const SHOT_QUALITIES = ["ok", "retry"] as const;
export type ShotQuality = (typeof SHOT_QUALITIES)[number];

export const NEXT_ACTIONS = ["RETAKE", "REQUEST_NEXT", "COMPLETE"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

/** The post-capture assessor never accepts a measurement image. */
export interface ShotAssessment {
  readonly shotType: ShotType;
  readonly quality: ShotQuality;
  readonly issues: readonly ShotIssueCode[];
  readonly missingShots: readonly ImageSlot[];
  readonly nextAction: NextAction;
}

export const GUIDANCE_CODES = [
  "MOVE_CLOSER",
  "MOVE_FARTHER",
  "CENTER_GARMENT",
  "SHOW_FULL_GARMENT",
  "WRONG_SIDE",
  "MOVE_TO_TAG",
  "PLACE_MARKER",
  "MARKER_NOT_VISIBLE",
  "FLATTEN_GARMENT",
  "CAMERA_OVERHEAD",
  "HOLD_STEADY",
  "READY",
  "AGENT_UNAVAILABLE",
] as const;
export type GuidanceCode = (typeof GUIDANCE_CODES)[number];

export interface GuidanceEvent {
  readonly sessionId: string;
  readonly sequence: number;
  readonly shot: SessionSlot;
  readonly code: GuidanceCode;
  readonly message: string;
  readonly confidence: number;
  readonly observedAt: number;
  readonly expiresAt: number;
}

export const CONNECTION_STATES = [
  "connecting",
  "connected",
  "reconnecting",
  "disconnected",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const PROVIDER_NAMES = [
  "shot-assessor",
  "vision-guidance",
  "measurement-line",
  "background-generator",
  "garment-masker",
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const PROVIDER_ERROR_CODES = [
  "TIMEOUT",
  "UNAVAILABLE",
  "INVALID_RESPONSE",
  "INVALID_INPUT",
  "STALE_SESSION",
  "STALE_SEQUENCE",
  "STALE_REQUEST",
  "UNKNOWN",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export interface ProviderError {
  readonly provider: ProviderName | "capture-session" | "livekit";
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export const MEASUREMENT_ENDPOINT_KEYS = [
  "lengthStart",
  "lengthEnd",
  "widthStart",
  "widthEnd",
] as const;
export type MeasurementEndpointKey = (typeof MEASUREMENT_ENDPOINT_KEYS)[number];

export type MeasurementEndpoints = Readonly<
  Record<MeasurementEndpointKey, NormalizedPoint>
>;

export interface MeasurementDraft {
  readonly imageId: string;
  readonly endpoints: MeasurementEndpoints;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly confidence: number;
  readonly source: "ai" | "contour" | "user";
  readonly status: "needs_review";
}

export interface ApprovedMeasurement {
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly source: "approved_cv" | "approved_manual";
}

export type CapturePhase =
  | "capturing"
  | "analyzing"
  | "measurement"
  | "error"
  | "ready";

export type CaptureSlotStatus = "pending" | "captured" | "approved";

export interface AcceptedImageSlot {
  readonly kind: "image";
  readonly slot: ImageSlot;
  readonly blob: Blob;
  readonly objectUrl: string;
  readonly assessment: ShotAssessment;
  readonly status: "captured";
  readonly acceptedSequence: number;
}

export interface MeasurementSlot {
  readonly kind: "measurement";
  readonly slot: "measurement";
  /** Kept only for the in-memory session; never part of a listing handoff. */
  readonly blob: Blob;
  readonly objectUrl: string;
  readonly draft: MeasurementDraft;
  readonly status: "captured" | "approved";
  readonly acceptedSequence: number;
}

export type AcceptedSlot = AcceptedImageSlot | MeasurementSlot;
export type CaptureSlotRecord = AcceptedSlot | null;
export type CaptureSlots = Readonly<Record<SessionSlot, CaptureSlotRecord>>;

export interface PendingImageCapture {
  readonly kind: "image";
  readonly sessionId: string;
  readonly slot: ImageSlot;
  readonly blob: Blob;
  readonly objectUrl: string;
  readonly requestId: string;
  readonly sequence: number;
}

export interface PendingMeasurementCapture {
  readonly kind: "measurement";
  readonly sessionId: string;
  readonly slot: "measurement";
  readonly blob: Blob;
  readonly objectUrl: string;
  readonly requestId: string;
  readonly sequence: number;
}

export type PendingCapture = PendingImageCapture | PendingMeasurementCapture;

export interface CaptureState {
  readonly sessionId: string;
  readonly phase: CapturePhase;
  readonly currentSlot: SessionSlot;
  readonly slots: CaptureSlots;
  readonly pendingCapture: PendingCapture | null;
  readonly lastAssessment: ShotAssessment | null;
  readonly measurementDraft: MeasurementDraft | null;
  readonly approvedMeasurement: ApprovedMeasurement | null;
  readonly latestGuidance: GuidanceEvent | null;
  readonly connectionState: ConnectionState;
  /** Highest accepted session sequence; lower/equal transport events are stale. */
  readonly lastSequence: number;
  readonly providerError: ProviderError | null;
}

export type CaptureAction =
  | {
      readonly type: "CAPTURE_SUBMITTED";
      readonly sessionId: string;
      readonly slot: SessionSlot;
      readonly blob: Blob;
      readonly objectUrl: string;
      readonly requestId: string;
      readonly sequence: number;
    }
  | {
      readonly type: "SHOT_ASSESSED";
      readonly sessionId: string;
      readonly slot: ImageSlot;
      readonly assessment: ShotAssessment;
      readonly requestId: string;
      readonly sequence: number;
    }
  | {
      readonly type: "MEASUREMENT_DRAFTED";
      readonly sessionId: string;
      readonly draft: MeasurementDraft;
      readonly requestId: string;
      readonly sequence: number;
    }
  | {
      readonly type: "PROVIDER_ERROR";
      readonly sessionId: string;
      readonly requestId: string;
      readonly sequence: number;
      readonly error: ProviderError;
    }
  | {
      readonly type: "RETRY_ANALYSIS";
      readonly sessionId: string;
      readonly requestId: string;
      readonly sequence: number;
    }
  | {
      readonly type: "MEASUREMENT_APPROVED";
      readonly sessionId: string;
      readonly measurement: ApprovedMeasurement;
      readonly sequence: number;
    }
  | {
      readonly type: "GUIDANCE_RECEIVED";
      readonly event: GuidanceEvent;
      readonly now: number;
    }
  | {
      readonly type: "CONNECTION_CHANGED";
      readonly sessionId: string;
      readonly connectionState: ConnectionState;
    }
  | {
      readonly type: "RETAKE";
      readonly sessionId: string;
      readonly slot: SessionSlot;
    }
  | {
      readonly type: "EDIT_REQUESTED";
      readonly sessionId: string;
    }
  | {
      readonly type: "RESET";
      readonly sessionId: string;
    };

export type CaptureReducer = (
  state: CaptureState,
  action: CaptureAction,
) => CaptureState;

