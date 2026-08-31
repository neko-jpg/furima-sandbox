import type { MeasurementEndpoints, NormalizedPoint } from '../../../types/measurement.ts';
import {
  MARKER_KNOWN_SIDE_CM,
  MeasurementEndpointsSchema,
} from '../../../types/measurement.ts';
import {
  measureLineCm,
  pixelsPerCmFromMarker,
  projectMeasurementEndpoints,
  type Homography,
  type ImageDimensions,
} from './geometry.ts';

export interface MeasurementCalculationInput {
  readonly endpoints: MeasurementEndpoints;
  readonly rawEndpoints?: MeasurementEndpoints;
  readonly imageDimensions?: ImageDimensions | null;
  readonly markerSidePx?: number | null;
  readonly homography?: Homography | null;
}

export interface MeasurementCalculationResult {
  readonly endpoints: MeasurementEndpoints;
  readonly pixelsPerCm: number | null;
  readonly lengthCm: number | null;
  readonly widthCm: number | null;
}

const roundCm = (value: number): number => Math.round(value * 10) / 10;

const validDimensions = (dimensions: ImageDimensions | null | undefined): dimensions is ImageDimensions => {
  if (!dimensions) return false;
  return Number.isInteger(dimensions.width)
    && dimensions.width >= 2
    && Number.isInteger(dimensions.height)
    && dimensions.height >= 2;
};

const validMarkerSide = (value: number | null | undefined): value is number => (
  value !== null && value !== undefined && Number.isFinite(value) && value > 0
);

const safeEndpoints = (value: MeasurementEndpoints): MeasurementEndpoints | null => {
  const parsed = MeasurementEndpointsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * Computes local measurements from provider endpoints.  Missing calibration
 * is represented by null values rather than an invented scale, which forces
 * the user to enter a marker measurement or explicit cm values before
 * approval.
 */
export function calculateMeasurement(input: MeasurementCalculationInput): MeasurementCalculationResult {
  const base = safeEndpoints(input.rawEndpoints ?? input.endpoints) ?? input.endpoints;
  let endpoints = base;
  if (input.homography) {
    try {
      endpoints = projectMeasurementEndpoints(base, input.homography);
    } catch {
      endpoints = base;
    }
  }
  if (!validDimensions(input.imageDimensions) || !validMarkerSide(input.markerSidePx)) {
    return { endpoints, pixelsPerCm: null, lengthCm: null, widthCm: null };
  }
  try {
    const pixelsPerCm = pixelsPerCmFromMarker(input.markerSidePx, MARKER_KNOWN_SIDE_CM);
    return {
      endpoints,
      pixelsPerCm,
      lengthCm: roundCm(measureLineCm(endpoints.lengthStart, endpoints.lengthEnd, input.imageDimensions, pixelsPerCm)),
      widthCm: roundCm(measureLineCm(endpoints.widthStart, endpoints.widthEnd, input.imageDimensions, pixelsPerCm)),
    };
  } catch {
    return { endpoints, pixelsPerCm: null, lengthCm: null, widthCm: null };
  }
}

const validImageDimensions = (width: number, height: number): ImageDimensions | null => (
  Number.isInteger(width) && width >= 2 && Number.isInteger(height) && height >= 2
    ? { width, height }
    : null
);

/** Reads only dimensions; the image bytes remain in the caller's memory. */
export async function readImageDimensions(blob: Blob): Promise<ImageDimensions | null> {
  try {
    if (typeof globalThis.createImageBitmap === 'function') {
      const bitmap = await globalThis.createImageBitmap(blob);
      const dimensions = validImageDimensions(bitmap.width, bitmap.height);
      bitmap.close();
      return dimensions;
    }
  } catch {
    // Fall through to the HTMLImageElement decoder where available.
  }
  if (typeof URL === 'undefined' || typeof Image === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image decode failed'));
      element.src = url;
    });
    return validImageDimensions(image.naturalWidth, image.naturalHeight);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type { Homography, ImageDimensions, NormalizedPoint };
