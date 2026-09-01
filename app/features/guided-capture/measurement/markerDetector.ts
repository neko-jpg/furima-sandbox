import type { MeasurementMarker } from '../../../types/measurement.ts';
import { homographyFromCorners, type ImageDimensions, type QuadrilateralCorners } from './geometry.ts';

/** Finite reasons exposed by the measurement fallback; no provider text crosses this boundary. */
export const MEASUREMENT_DETECTION_FAILURE_CODES = [
  'MARKER_MISSING',
  'MARKER_MULTIPLE',
  'MARKER_TOO_SMALL',
  'MARKER_OCCLUDED',
  'GARMENT_OUT_OF_FRAME',
  'GARMENT_MARKER_OVERLAP',
  'SEGMENTATION_FAILED',
  'ENDPOINTS_INVALID',
] as const;
export type MeasurementDetectionFailureCode = (typeof MEASUREMENT_DETECTION_FAILURE_CODES)[number];

export interface RgbaImageData {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface MarkerDetectionOptions {
  /** Black ink threshold used by the deterministic contour fallback. */
  readonly darknessThreshold?: number;
  /** Outer edge length of the printed 50mm marker in source pixels. */
  readonly minSidePx?: number;
  /** Minimum safe distance from the image edge. */
  readonly edgeMarginPx?: number;
  /** Minimum short-side / long-side ratio. */
  readonly minAspectRatio?: number;
  /** Minimum image-space gap between marker and garment bounds. */
  readonly minGarmentGapPx?: number;
}

/** Internal QA metadata; never displayed as an AI confidence signal. */
export type MarkerDetectionEngine = 'opencv' | 'fallback';

export interface DetectedMarker {
  readonly corners: QuadrilateralCorners;
  readonly sidePx: number;
  readonly marker: MeasurementMarker;
  readonly boundingBox: PixelRect;
  readonly score: number;
}

export interface MarkerDetectionSuccess {
  readonly ok: true;
  readonly engine?: MarkerDetectionEngine;
  readonly marker: DetectedMarker;
  readonly projection: ReturnType<typeof homographyFromCorners>;
}

export interface MarkerDetectionFailure {
  readonly ok: false;
  readonly engine?: MarkerDetectionEngine;
  readonly code: MeasurementDetectionFailureCode;
  readonly message: string;
}

export type MarkerDetectionResult = MarkerDetectionSuccess | MarkerDetectionFailure;

interface Component {
  readonly pixels: number[];
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const DEFAULT_OPTIONS: Required<MarkerDetectionOptions> = {
  darknessThreshold: 105,
  minSidePx: 80,
  edgeMarginPx: 16,
  minAspectRatio: 0.65,
  minGarmentGapPx: 24,
};

const failure = (code: MeasurementDetectionFailureCode, message: string): MarkerDetectionFailure => ({
  ok: false,
  code,
  message,
});

const finitePositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

const validImage = (image: RgbaImageData): boolean => (
  finitePositiveInteger(image.width)
  && finitePositiveInteger(image.height)
  && image.width * image.height <= 16_777_216
  && image.data.length >= image.width * image.height * 4
);

const pixelIndex = (x: number, y: number, width: number): number => (y * width + x) * 4;

const luminance = (image: RgbaImageData, x: number, y: number): number => {
  const index = pixelIndex(x, y, image.width);
  const alpha = Number(image.data[index + 3]);
  if (!Number.isFinite(alpha) || alpha < 24) return 255;
  const red = Number(image.data[index]);
  const green = Number(image.data[index + 1]);
  const blue = Number(image.data[index + 2]);
  if (![red, green, blue].every(Number.isFinite)) return 255;
  return 0.299 * red + 0.587 * green + 0.114 * blue;
};

const isDark = (image: RgbaImageData, x: number, y: number, threshold: number): boolean => (
  luminance(image, x, y) <= threshold
);

const componentFor = (
  image: RgbaImageData,
  startX: number,
  startY: number,
  dark: Uint8Array,
  visited: Uint8Array,
): Component => {
  const queue = [startY * image.width + startX];
  const pixels: number[] = [];
  visited[startY * image.width + startX] = 1;
  let left = startX;
  let right = startX;
  let top = startY;
  let bottom = startY;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    pixels.push(index);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nextX < 0 || nextX >= image.width || nextY < 0 || nextY >= image.height) continue;
      const nextIndex = nextY * image.width + nextX;
      if (dark[nextIndex] === 1 && visited[nextIndex] === 0) {
        visited[nextIndex] = 1;
        queue.push(nextIndex);
      }
    }
  }
  return { pixels, left, top, right, bottom };
};

const rectArea = (rect: PixelRect): number => Math.max(0, rect.right - rect.left + 1) * Math.max(0, rect.bottom - rect.top + 1);

const rectGap = (left: PixelRect, right: PixelRect): number => {
  const horizontal = left.right < right.left
    ? right.left - left.right - 1
    : right.right < left.left
      ? left.left - right.right - 1
      : 0;
  const vertical = left.bottom < right.top
    ? right.top - left.bottom - 1
    : right.bottom < left.top
      ? left.top - right.bottom - 1
      : 0;
  return Math.hypot(horizontal, vertical);
};

const componentShape = (
  component: Component,
  image: RgbaImageData,
  darknessThreshold: number,
): { rect: PixelRect; sidePx: number; aspectRatio: number; ringScore: number; innerDarkRatio: number } => {
  const rect = { left: component.left, top: component.top, right: component.right, bottom: component.bottom };
  const width = rect.right - rect.left + 1;
  const height = rect.bottom - rect.top + 1;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const inset = Math.max(2, Math.floor(shortSide * 0.2));
  const ringThickness = Math.max(2, Math.floor(shortSide * 0.08));
  let borderDark = 0;
  let borderTotal = 0;
  let innerDark = 0;
  let innerTotal = 0;
  for (let y = rect.top; y <= rect.bottom; y += 1) {
    for (let x = rect.left; x <= rect.right; x += 1) {
      const border = x - rect.left < ringThickness
        || rect.right - x < ringThickness
        || y - rect.top < ringThickness
        || rect.bottom - y < ringThickness;
      const centre = x >= rect.left + inset && x <= rect.right - inset && y >= rect.top + inset && y <= rect.bottom - inset;
      if (border) {
        borderTotal += 1;
        if (isDark(image, x, y, darknessThreshold)) borderDark += 1;
      }
      if (centre) {
        innerTotal += 1;
        if (isDark(image, x, y, darknessThreshold)) innerDark += 1;
      }
    }
  }
  return {
    rect,
    sidePx: (width + height) / 2,
    aspectRatio: shortSide / longSide,
    ringScore: borderTotal ? borderDark / borderTotal : 0,
    innerDarkRatio: innerTotal ? innerDark / innerTotal : 1,
  };
};

const cornersFromRect = (rect: PixelRect, dimensions: ImageDimensions): QuadrilateralCorners => {
  const x = (value: number): number => value / Math.max(1, dimensions.width - 1);
  const y = (value: number): number => value / Math.max(1, dimensions.height - 1);
  return [
    { x: x(rect.left), y: y(rect.top) },
    { x: x(rect.right), y: y(rect.top) },
    { x: x(rect.right), y: y(rect.bottom) },
    { x: x(rect.left), y: y(rect.bottom) },
  ];
};

const markerFrom = (corners: QuadrilateralCorners, sidePx: number): MeasurementMarker => ({
  knownSideCm: 5,
  corners,
  pxPerCm: sidePx / 5,
});

const validateScene = (
  marker: PixelRect,
  image: RgbaImageData,
  garmentBounds: PixelRect | undefined,
  gap: number,
): MarkerDetectionFailure | null => {
  if (!garmentBounds) return null;
  const frame: PixelRect = { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1 };
  if (garmentBounds.left <= frame.left || garmentBounds.top <= frame.top || garmentBounds.right >= frame.right || garmentBounds.bottom >= frame.bottom) {
    return failure('GARMENT_OUT_OF_FRAME', '衣類全体が画角に収まるように撮影してください。');
  }
  if (rectArea({
    left: Math.max(marker.left, garmentBounds.left),
    top: Math.max(marker.top, garmentBounds.top),
    right: Math.min(marker.right, garmentBounds.right),
    bottom: Math.min(marker.bottom, garmentBounds.bottom),
  }) > 0 || rectGap(marker, garmentBounds) < gap) {
    return failure('GARMENT_MARKER_OVERLAP', 'マーカーを衣類から24px以上離して置いてください。');
  }
  return null;
};

/**
 * Detects the dedicated black-on-white square marker without network calls.
 * This is intentionally a bounded contour fallback: production may inject an
 * OpenCV.js implementation at this same boundary, while fixture and offline
 * browsers still get deterministic validation and safe manual fallback.
 */
export function detectMeasurementMarker(
  image: RgbaImageData,
  options: MarkerDetectionOptions = {},
  garmentBounds?: PixelRect,
): MarkerDetectionResult {
  if (!validImage(image)) return failure('SEGMENTATION_FAILED', '採寸画像を安全に解析できません。');
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  if (![resolved.darknessThreshold, resolved.minSidePx, resolved.edgeMarginPx, resolved.minAspectRatio, resolved.minGarmentGapPx].every(Number.isFinite)
    || resolved.darknessThreshold < 0 || resolved.darknessThreshold > 255 || resolved.minSidePx <= 0 || resolved.edgeMarginPx < 0
    || resolved.minAspectRatio <= 0 || resolved.minAspectRatio > 1 || resolved.minGarmentGapPx < 0) {
    return failure('SEGMENTATION_FAILED', '採寸画像の解析条件が不正です。');
  }

  const total = image.width * image.height;
  const dark = new Uint8Array(total);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      dark[y * image.width + x] = isDark(image, x, y, resolved.darknessThreshold) ? 1 : 0;
    }
  }
  const visited = new Uint8Array(total);
  const candidates: Array<{ component: Component; rect: PixelRect; sidePx: number; score: number }> = [];
  let tooSmall = false;
  let occluded = false;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      if (dark[index] === 0 || visited[index] === 1) continue;
      const component = componentFor(image, x, y, dark, visited);
      if (component.pixels.length < 12) continue;
      const shape = componentShape(component, image, resolved.darknessThreshold);
      if (shape.aspectRatio < resolved.minAspectRatio || shape.ringScore < 0.45) continue;
      if (shape.innerDarkRatio > 0.35) {
        occluded = true;
        continue;
      }
      const touchesEdge = shape.rect.left <= resolved.edgeMarginPx
        || shape.rect.top <= resolved.edgeMarginPx
        || image.width - 1 - shape.rect.right <= resolved.edgeMarginPx
        || image.height - 1 - shape.rect.bottom <= resolved.edgeMarginPx;
      if (shape.sidePx < resolved.minSidePx) {
        tooSmall = true;
        continue;
      }
      if (touchesEdge) {
        occluded = true;
        continue;
      }
      const score = shape.ringScore * (1 - shape.innerDarkRatio) * shape.aspectRatio;
      candidates.push({ component, rect: shape.rect, sidePx: shape.sidePx, score });
    }
  }
  if (candidates.length > 1) return failure('MARKER_MULTIPLE', '専用マーカーが複数見つかりました。1枚だけ写してください。');
  const selected = candidates[0];
  if (!selected) {
    if (occluded) return failure('MARKER_OCCLUDED', 'マーカー全体が見えるように置いてください。');
    if (tooSmall) return failure('MARKER_TOO_SMALL', 'マーカーを80px以上で写してください。');
    return failure('MARKER_MISSING', '50mm専用マーカーが見つかりません。');
  }
  const sceneFailure = validateScene(selected.rect, image, garmentBounds, resolved.minGarmentGapPx);
  if (sceneFailure) return sceneFailure;
  const corners = cornersFromRect(selected.rect, { width: image.width, height: image.height });
  try {
    const projection = homographyFromCorners(corners);
    const marker = markerFrom(corners, selected.sidePx);
    return {
      ok: true,
      marker: {
        corners,
        sidePx: selected.sidePx,
        marker,
        boundingBox: selected.rect,
        score: selected.score,
      },
      projection,
    };
  } catch {
    return failure('SEGMENTATION_FAILED', 'マーカーの四隅を補正できません。');
  }
}

export const markerDetectionFailureMessage = (code: MeasurementDetectionFailureCode): string => ({
  MARKER_MISSING: '50mm専用マーカーを衣類の右下に置いて、全体を写してください。',
  MARKER_MULTIPLE: '専用マーカーは1枚だけ写してください。',
  MARKER_TOO_SMALL: 'マーカーを80px以上で写してください。',
  MARKER_OCCLUDED: 'マーカー全体が見えるように、画像端や衣類の下から離してください。',
  GARMENT_OUT_OF_FRAME: '衣類全体が安全枠に入るように撮影してください。',
  GARMENT_MARKER_OVERLAP: 'マーカーを衣類から24px以上離して置いてください。',
  SEGMENTATION_FAILED: '端末内解析を完了できません。4端点と採寸値を手入力できます。',
  ENDPOINTS_INVALID: '採寸端点を確認してから続行してください。',
}[code]);
