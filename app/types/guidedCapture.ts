import { z } from "zod";

/** The fixed four-slot order used by a guided garment-capture session. */
export const SESSION_SLOTS = ["front", "back", "tag", "measurement"] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

/** The three slots that the post-capture ShotAssessor is allowed to judge. */
export const SHOT_SLOTS = ["front", "back", "tag"] as const;
export type ShotSlot = (typeof SHOT_SLOTS)[number];

/** Backward-compatible aliases for callers that use the capture terminology. */
export const CAPTURE_SLOTS = SHOT_SLOTS;
export type CaptureSlot = ShotSlot;

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

/** Finite codes that can be pushed as live capture guidance. */
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
  "UNKNOWN",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

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

export interface ShotAssessment {
  shotType: ShotType;
  quality: ShotQuality;
  issues: ShotIssueCode[];
  /** Deliberately excludes measurement; measurement has its own contract. */
  missingShots: ShotSlot[];
  nextAction: NextAction;
}

export interface ProviderError {
  provider: ProviderName;
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
}

export const SessionSlotSchema = z.enum(SESSION_SLOTS);
export const ShotSlotSchema = z.enum(SHOT_SLOTS);
export const CaptureSlotSchema = ShotSlotSchema;
export const ShotTypeSchema = z.enum(SHOT_TYPES);
export const ShotIssueCodeSchema = z.enum(SHOT_ISSUE_CODES);
export const ShotQualitySchema = z.enum(SHOT_QUALITIES);
export const NextActionSchema = z.enum(NEXT_ACTIONS);
export const GuidanceCodeSchema = z.enum(GUIDANCE_CODES);
export const ConnectionStateSchema = z.enum(CONNECTION_STATES);
export const ProviderNameSchema = z.enum(PROVIDER_NAMES);
export const ProviderErrorCodeSchema = z.enum(PROVIDER_ERROR_CODES);

const sessionIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u);
const finiteNonNegativeInteger = z.number().finite().int().min(0);

export const GuidanceEventSchema: z.ZodType<GuidanceEvent> = z
  .object({
    sessionId: sessionIdSchema,
    sequence: finiteNonNegativeInteger.min(1),
    shot: SessionSlotSchema,
    code: GuidanceCodeSchema,
    message: z.string().min(1).max(240),
    confidence: z.number().finite().min(0).max(1),
    observedAt: finiteNonNegativeInteger,
    expiresAt: finiteNonNegativeInteger,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt <= value.observedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must be strictly after observedAt",
      });
    }
  });

export const ShotAssessmentSchema: z.ZodType<ShotAssessment> = z
  .object({
    shotType: ShotTypeSchema,
    quality: ShotQualitySchema,
    issues: z.array(ShotIssueCodeSchema).max(7).refine(
      (values) => new Set(values).size === values.length,
      "issues must not contain duplicates",
    ),
    missingShots: z.array(ShotSlotSchema).max(3).refine(
      (values) => new Set(values).size === values.length,
      "missingShots must not contain duplicates",
    ),
    nextAction: NextActionSchema,
  })
  .strict();

export const ProviderErrorSchema: z.ZodType<ProviderError> = z
  .object({
    provider: ProviderNameSchema,
    code: ProviderErrorCodeSchema,
    message: z.string().min(1).max(240),
    retryable: z.boolean(),
  })
  .strict();

/** Returns false for an expired event without mutating the event. */
export function isGuidanceEventFresh(
  event: GuidanceEvent,
  now: number,
): boolean {
  return Number.isFinite(now) && now >= 0 && now < event.expiresAt;
}
