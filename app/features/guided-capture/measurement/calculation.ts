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

export interface ImageRaster {
  /** Native decoded dimensions, retained for normalized-to-pixel conversion. */
  readonly dimensions: ImageDimensions;
  /** Bounded raster dimensions. These are the dimensions represented by data. */
  readonly width: number;
  readonly height: number;
  /** A bounded, disposable RGBA analysis copy. */
  readonly data: Uint8ClampedArray;
  /** Raster width / native width, used to restore pixel measurements. */
  readonly scale: number;
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

const rasterDimensions = (width: number, height: number, maxEdge: number): { width: number; height: number; scale: number } | null => {
  if (!validImageDimensions(width, height) || !Number.isFinite(maxEdge) || maxEdge < 2) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
    scale,
  };
};

const rasterizeImageSource = (
  source: CanvasImageSource,
  nativeWidth: number,
  nativeHeight: number,
  maxEdge: number,
): ImageRaster | null => {
  const target = rasterDimensions(nativeWidth, nativeHeight, maxEdge);
  if (!target) return null;
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas === 'function') {
    canvas = new OffscreenCanvas(target.width, target.height);
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
  } else {
    return null;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !('getImageData' in context)) return null;
  context.drawImage(source, 0, 0, target.width, target.height);
  const imageData = context.getImageData(0, 0, target.width, target.height);
  return {
    dimensions: { width: nativeWidth, height: nativeHeight },
    width: target.width,
    height: target.height,
    data: new Uint8ClampedArray(imageData.data),
    scale: target.scale,
  };
};

/**
 * Decode one bounded, disposable raster for local marker validation. The
 * original Blob is never uploaded by this helper and the returned pixels are
 * intended to be released with the surrounding request scope.
 */
export async function readImageRaster(blob: Blob, maxEdge = 1280): Promise<ImageRaster | null> {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(blob);
      try {
        return rasterizeImageSource(bitmap, bitmap.width, bitmap.height, maxEdge);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall through to the HTML image decoder where available.
    }
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
    return rasterizeImageSource(image, image.naturalWidth, image.naturalHeight, maxEdge);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Encodes a session-only projected raster without creating a data URL. The
 * caller owns the returned Blob and must not persist it with listing media.
 */
export async function rasterToBlob(
  raster: { readonly width: number; readonly height: number; readonly data: ArrayLike<number> },
  type = 'image/png',
): Promise<Blob> {
  if (!validImageDimensions(raster.width, raster.height) || raster.data.length < raster.width * raster.height * 4) {
    throw new RangeError('Raster dimensions or data are invalid.');
  }
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas === 'function') {
    canvas = new OffscreenCanvas(raster.width, raster.height);
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
  } else {
    throw new Error('Canvas encoding is unavailable.');
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !('putImageData' in context) || !('createImageData' in context)) throw new Error('Canvas encoding is unavailable.');
  const imageData = context.createImageData(raster.width, raster.height);
  imageData.data.set(Uint8ClampedArray.from(raster.data));
  context.putImageData(imageData, 0, 0);
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type });
  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas encoding failed.')), type);
    });
  }
  throw new Error('Canvas encoding is unavailable.');
}

export type { Homography, ImageDimensions, NormalizedPoint };
