/**
 * UI-side contracts for the guided capture feature.
 *
 * The browser UI deliberately depends on this small boundary instead of on a
 * particular HTTP client, LiveKit SDK, or provider implementation. The
 * production adapter can be added later without changing ListingView.
 */

import type { Homography, ImageDimensions, QuadrilateralCorners } from '../measurement/geometry';
import type { MeasurementDetectionFailureCode } from '../measurement/markerDetector';
import type { GuidanceCandidate } from '../core/guidanceSelector';

export const GUIDED_CAPTURE_SLOTS = ['front', 'back', 'tag', 'measurement'] as const;
export type SessionSlot = (typeof GUIDED_CAPTURE_SLOTS)[number];
export type CaptureImageSlot = Exclude<SessionSlot, 'measurement'>;

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type TransportKind = 'fixture' | 'live';
export type GuidedCapturePhase = 'idle' | 'connecting' | 'capturing' | 'measurement' | 'review' | 'ready' | 'fallback';
export type GuidedCaptureStep = SessionSlot | 'measurement-preparation' | 'measurement-capture' | 'measurement-review' | 'edit';
export type SlotStatus = 'pending' | 'active' | 'captured' | 'approved';
export type BackgroundApproval = 'not_started' | 'preview' | 'approved';
export type CaptureSource = 'camera' | 'album';

export type GuidanceCode =
  | 'MOVE_CLOSER'
  | 'MOVE_FARTHER'
  | 'CENTER_GARMENT'
  | 'SHOW_FULL_GARMENT'
  | 'WRONG_SIDE'
  | 'MOVE_TO_TAG'
  | 'PLACE_MARKER'
  | 'MARKER_NOT_VISIBLE'
  | 'FLATTEN_GARMENT'
  | 'CAMERA_OVERHEAD'
  | 'HOLD_STEADY'
  | 'READY'
  | 'AGENT_UNAVAILABLE';

export interface GuidanceEvent {
  sessionId: string;
  sequence: number;
  shot: SessionSlot;
  code: GuidanceCode;
  message: string;
  confidence: number;
  observedAt: number;
  expiresAt: number;
}

export interface GuidanceStateEvent {
  type: 'shot_changed' | 'resync';
  sessionId: string;
  sequence: number;
  shot: SessionSlot | null;
  code: GuidanceCode | null;
  observedAt: number;
}

export interface MeasurementEndpoints {
  lengthStart: { x: number; y: number };
  lengthEnd: { x: number; y: number };
  widthStart: { x: number; y: number };
  widthEnd: { x: number; y: number };
}

export type MeasurementProjectionCorners = QuadrilateralCorners;

export interface ShotAssessment {
  shotType: CaptureImageSlot | 'unknown';
  quality: 'ok' | 'retry';
  issues: string[];
  missingShots: SessionSlot[];
  nextAction: 'RETAKE' | 'REQUEST_NEXT' | 'COMPLETE';
}

export interface MeasurementDraft {
  /** Values stay nullable until the user supplies or approves a scale. */
  lengthCm: number | null;
  widthCm: number | null;
  source: 'ai' | 'approved_manual';
  confidence?: number;
  endpoints?: MeasurementEndpoints;
  /** Session-only image metadata; the image bytes are never handed off. */
  imageDimensions?: ImageDimensions | null;
  /** Pixel length of one side of the fixed 5cm marker, entered locally. */
  markerSidePx?: number | null;
  /** Raw points are retained only to re-run a local projection correction. */
  rawEndpoints?: MeasurementEndpoints;
  projectionCorners?: MeasurementProjectionCorners | null;
  homography?: Homography | null;
  /** The disposable preview has already been warped into the marker plane. */
  projectionCorrected?: boolean;
  /** Local provenance for the four points, used to explain offline fallback. */
  endpointSource?: 'ai' | 'fallback';
  /** Local marker result; kept in the session and never sent to the listing handoff. */
  marker?: {
    knownSideCm: 5;
    corners: QuadrilateralCorners;
    pxPerCm: number;
  } | null;
  /** Finite local fallback reason, shown without provider diagnostics. */
  markerDetectionFailure?: MeasurementDetectionFailureCode;
}

export interface MeasurementPatch {
  lengthCm?: number | null;
  widthCm?: number | null;
  endpoints?: MeasurementEndpoints;
  markerSidePx?: number | null;
  projectionCorners?: MeasurementProjectionCorners | null;
}

export interface ApprovedMeasurement {
  lengthCm: number;
  widthCm: number;
  source: 'approved_cv' | 'approved_manual';
}

export interface SlotProgress {
  slot: SessionSlot;
  status: SlotStatus;
  mediaId?: string;
  previewUrl?: string;
  source?: CaptureSource;
}

export interface GuidedCaptureState {
  sessionId: string | null;
  phase: GuidedCapturePhase;
  /** Explicit workflow step; never inferred from an assessor's nextAction. */
  currentStep: GuidedCaptureStep;
  connectionState: ConnectionState;
  transport: TransportKind | null;
  activeSlot: SessionSlot;
  slots: Record<SessionSlot, SlotProgress>;
  lastAssessment: ShotAssessment | null;
  latestGuidance: GuidanceEvent | null;
  primaryGuidance: GuidanceCandidate | null;
  guidanceAcknowledgement: string | null;
  measurementDraft: MeasurementDraft | null;
  measurement: ApprovedMeasurement | null;
  backgroundApproval: BackgroundApproval;
  backgroundPreviewUrl?: string;
  error: string | null;
}

export interface CaptureRequest {
  sessionId: string;
  slot: SessionSlot;
  mediaId?: string;
  blob?: Blob;
  requestId?: string;
  sequence?: number;
}

export interface MeasurementRequest {
  sessionId: string;
  blob: Blob;
  /** Request identity is optional for old adapters but supplied by the controller. */
  requestId?: string;
  sequence?: number;
  mediaId?: string;
}

export interface AdapterConnection {
  connectionState: Exclude<ConnectionState, 'disconnected'>;
  transport: TransportKind;
}

export interface GuidedCaptureAdapter {
  connect: (sessionId: string) => Promise<AdapterConnection>;
  disconnect: () => Promise<void> | void;
  assessShot?: (request: CaptureRequest) => Promise<ShotAssessment>;
  suggestMeasurement?: (request: MeasurementRequest) => Promise<MeasurementDraft>;
  subscribeConnection?: (listener: (connectionState: ConnectionState, error?: string) => void) => () => void;
  subscribeGuidance?: (listener: (event: GuidanceEvent) => void) => () => void;
  subscribeState?: (listener: (event: GuidanceStateEvent) => void) => () => void;
  setActiveShot?: (slot: SessionSlot) => Promise<void>;
  publishCameraStream?: (stream: MediaStream) => Promise<void>;
}

export interface AcceptedGuidedMedia {
  mediaId: string;
  previewUrl: string;
  source: CaptureSource;
  /** Kept only for the in-memory provider call; never included in handoff. */
  blob?: Blob;
}

export interface ApprovedCaptureImage {
  slot: CaptureImageSlot;
  mediaId: string;
}

export interface GuidedCaptureHandoff {
  images: ApprovedCaptureImage[];
  garmentMeasurements?: ApprovedMeasurement;
}

export interface GuidedCaptureDraft {
  sessionId: string;
  slots: Record<SessionSlot, SlotProgress>;
  measurement: ApprovedMeasurement | null;
  background: { status: BackgroundApproval; previewUrl?: string };
}

/**
 * Build the only shape that can cross from guided capture into listing code.
 * Only explicitly reviewed image ids and explicitly approved measurements are
 * projected. Measurement images, points, guidance events, preview URLs,
 * background blobs, and all other intermediate results stay session-scoped.
 */
export const createListingHandoff = (draft: GuidedCaptureDraft): GuidedCaptureHandoff => {
  const images = (['front', 'back', 'tag'] as const)
    .map((slot) => ({ slot, progress: draft.slots[slot] }))
    .filter(({ progress }) => Boolean(progress.mediaId && progress.status === 'approved'))
    .map(({ slot, progress }) => ({
      slot,
      mediaId: progress.mediaId as string,
    }));

  return {
    images,
    garmentMeasurements: draft.measurement ?? undefined,
  };
};
