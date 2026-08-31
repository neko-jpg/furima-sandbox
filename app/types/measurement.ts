import { z } from "zod";

/** A point normalized to the bounds of the projection-corrected image. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

export const MEASUREMENT_ENDPOINT_KEYS = [
  "lengthStart",
  "lengthEnd",
  "widthStart",
  "widthEnd",
] as const;
export type MeasurementEndpointKey = (typeof MEASUREMENT_ENDPOINT_KEYS)[number];

export interface MeasurementEndpoints {
  lengthStart: NormalizedPoint;
  lengthEnd: NormalizedPoint;
  widthStart: NormalizedPoint;
  widthEnd: NormalizedPoint;
}

/** The dedicated printed marker is 50mm on its outer edge. */
export const MARKER_KNOWN_SIDE_CM = 5 as const;

export interface MeasurementMarker {
  knownSideCm: typeof MARKER_KNOWN_SIDE_CM;
  corners: readonly [
    NormalizedPoint,
    NormalizedPoint,
    NormalizedPoint,
    NormalizedPoint,
  ];
  pxPerCm: number;
}

export interface MeasurementLine {
  start: NormalizedPoint;
  end: NormalizedPoint;
  valueCm: number;
}

export const MEASUREMENT_SOURCES = ["ai", "contour", "user"] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const MEASUREMENT_STATUSES = [
  "needs_review",
  "approved_cv",
  "approved_manual",
] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

export const APPROVED_MEASUREMENT_STATUSES = [
  "approved_cv",
  "approved_manual",
] as const;
export type ApprovedMeasurementStatus =
  (typeof APPROVED_MEASUREMENT_STATUSES)[number];

export const MEASUREMENT_FAILURE_CODES = [
  "MARKER_MISSING",
  "MARKER_MULTIPLE",
  "MARKER_TOO_SMALL",
  "MARKER_OCCLUDED",
  "GARMENT_OUT_OF_FRAME",
  "GARMENT_MARKER_OVERLAP",
  "SEGMENTATION_FAILED",
  "ENDPOINTS_INVALID",
] as const;
export type MeasurementFailureCode = (typeof MEASUREMENT_FAILURE_CODES)[number];

/**
 * The provider response is intentionally limited to the four normalized
 * endpoints.  Confidence, centimetres, and UI state are local concerns and
 * must not become required wire fields.
 */
export type MeasurementPointSuggestion = MeasurementEndpoints;

/** A reviewable, session-scoped measurement draft. */
export interface MeasurementDraft {
  imageId: string;
  marker: MeasurementMarker | null;
  length: MeasurementLine;
  width: MeasurementLine;
  source: MeasurementSource;
  status: MeasurementStatus;
}

/** A draft after an explicit CV or manual approval action. */
export interface ApprovedMeasurement
  extends Omit<MeasurementDraft, "status"> {
  status: ApprovedMeasurementStatus;
}

/** Warning-only plausibility ranges; review may still approve an outlier. */
export const LENGTH_CM_RANGE = { min: 20, max: 100 } as const;
export const WIDTH_CM_RANGE = { min: 20, max: 80 } as const;

export const NormalizedPointSchema: z.ZodType<NormalizedPoint> = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

export const MeasurementEndpointKeySchema = z.enum(MEASUREMENT_ENDPOINT_KEYS);
export const MeasurementSourceSchema = z.enum(MEASUREMENT_SOURCES);
export const MeasurementStatusSchema = z.enum(MEASUREMENT_STATUSES);
export const ApprovedMeasurementStatusSchema = z.enum(
  APPROVED_MEASUREMENT_STATUSES,
);
export const MeasurementFailureCodeSchema = z.enum(MEASUREMENT_FAILURE_CODES);

export const MeasurementEndpointsSchema: z.ZodType<MeasurementEndpoints> = z
  .object({
    lengthStart: NormalizedPointSchema,
    lengthEnd: NormalizedPointSchema,
    widthStart: NormalizedPointSchema,
    widthEnd: NormalizedPointSchema,
  })
  .strict();

export const MeasurementPointSuggestionSchema: z.ZodType<MeasurementPointSuggestion> = z
  .object({
    lengthStart: NormalizedPointSchema,
    lengthEnd: NormalizedPointSchema,
    widthStart: NormalizedPointSchema,
    widthEnd: NormalizedPointSchema,
  })
  .strict();

export const MeasurementMarkerSchema: z.ZodType<MeasurementMarker> = z
  .object({
    knownSideCm: z.literal(MARKER_KNOWN_SIDE_CM),
    corners: z.tuple([
      NormalizedPointSchema,
      NormalizedPointSchema,
      NormalizedPointSchema,
      NormalizedPointSchema,
    ]),
    pxPerCm: z.number().finite().positive(),
  })
  .strict();

export const MeasurementLineSchema: z.ZodType<MeasurementLine> = z
  .object({
    start: NormalizedPointSchema,
    end: NormalizedPointSchema,
    valueCm: z.number().finite().positive(),
  })
  .strict();

export const MeasurementDraftSchema: z.ZodType<MeasurementDraft> = z
  .object({
    imageId: z.string().min(1).max(160),
    marker: MeasurementMarkerSchema.nullable(),
    length: MeasurementLineSchema,
    width: MeasurementLineSchema,
    source: MeasurementSourceSchema,
    status: MeasurementStatusSchema,
  })
  .strict();

export const ApprovedMeasurementSchema: z.ZodType<ApprovedMeasurement> = z
  .object({
    imageId: z.string().min(1).max(160),
    marker: MeasurementMarkerSchema.nullable(),
    length: MeasurementLineSchema,
    width: MeasurementLineSchema,
    source: MeasurementSourceSchema,
    status: ApprovedMeasurementStatusSchema,
  })
  .strict();

export function isMeasurementWithinExpectedRange(
  draft: MeasurementDraft,
): boolean {
  return (
    draft.length.valueCm >= LENGTH_CM_RANGE.min &&
    draft.length.valueCm <= LENGTH_CM_RANGE.max &&
    draft.width.valueCm >= WIDTH_CM_RANGE.min &&
    draft.width.valueCm <= WIDTH_CM_RANGE.max
  );
}
