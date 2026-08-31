/** Four-hertz, fixed-ROI image-quality checks for local guidance. */

export const QUALITY_ANALYSIS_HZ = 4;
export const QUALITY_ANALYSIS_INTERVAL_MS = 1_000 / QUALITY_ANALYSIS_HZ;
export const DEFAULT_BRIGHTNESS_MIN = 45;
export const DEFAULT_BRIGHTNESS_MAX = 215;
export const DEFAULT_BLUR_VARIANCE_MIN = 24;

export type ImageQualityIssue = "TOO_DARK" | "TOO_BRIGHT" | "TOO_BLURRY";

export interface ImageQualityThresholds {
  readonly brightnessMin?: number;
  readonly brightnessMax?: number;
  readonly blurVarianceMin?: number;
}

export interface BrightnessCheckResult {
  readonly averageLuma: number;
  readonly ok: boolean;
  readonly issue: "TOO_DARK" | "TOO_BRIGHT" | null;
}

export interface ImageQualityResult {
  readonly issue: ImageQualityIssue | null;
  readonly averageLuma: number;
  readonly laplacianVariance: number;
  readonly brightnessOk: boolean;
  readonly blurOk: boolean;
}

interface ResolvedThresholds {
  readonly brightnessMin: number;
  readonly brightnessMax: number;
  readonly blurVarianceMin: number;
}

function assertDimensions(width: number, height: number): number {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError("width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError("height must be a positive integer");
  }
  return width * height;
}

function assertLength(pixels: ArrayLike<number>, expected: number, label: string): void {
  if (pixels.length !== expected) {
    throw new RangeError(`${label} length ${pixels.length} does not match ${expected}`);
  }
}

function resolveThresholds(thresholds: ImageQualityThresholds): ResolvedThresholds {
  const resolved = {
    brightnessMin: thresholds.brightnessMin ?? DEFAULT_BRIGHTNESS_MIN,
    brightnessMax: thresholds.brightnessMax ?? DEFAULT_BRIGHTNESS_MAX,
    blurVarianceMin: thresholds.blurVarianceMin ?? DEFAULT_BLUR_VARIANCE_MIN,
  };
  if (
    !Number.isFinite(resolved.brightnessMin) ||
    resolved.brightnessMin < 0 ||
    resolved.brightnessMin > 255 ||
    !Number.isFinite(resolved.brightnessMax) ||
    resolved.brightnessMax < 0 ||
    resolved.brightnessMax > 255 ||
    resolved.brightnessMin > resolved.brightnessMax
  ) {
    throw new RangeError("brightness thresholds must be ordered values between 0 and 255");
  }
  if (!Number.isFinite(resolved.blurVarianceMin) || resolved.blurVarianceMin < 0) {
    throw new RangeError("blurVarianceMin must be zero or greater");
  }
  return resolved;
}

export function rgbaToGrayscale(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  reuse?: Uint8ClampedArray,
): Uint8ClampedArray {
  const pixels = assertDimensions(width, height);
  assertLength(rgba, pixels * 4, "RGBA buffer");
  const grayscale = reuse?.length === pixels ? reuse : new Uint8ClampedArray(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    grayscale[index] = Math.round(
      0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2],
    );
  }
  return grayscale;
}

export function brightnessCheck(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  thresholds: ImageQualityThresholds = {},
): BrightnessCheckResult {
  const pixels = assertDimensions(width, height);
  assertLength(grayscale, pixels, "grayscale buffer");
  const resolved = resolveThresholds(thresholds);
  let sum = 0;
  for (let index = 0; index < pixels; index += 1) {
    sum += grayscale[index];
  }
  const averageLuma = sum / pixels;
  const issue = averageLuma < resolved.brightnessMin
    ? "TOO_DARK"
    : averageLuma > resolved.brightnessMax
      ? "TOO_BRIGHT"
      : null;
  return { averageLuma, ok: issue === null, issue };
}

/** Population variance of the four-neighbour Laplacian over interior pixels. */
export function laplacianVariance(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const pixels = assertDimensions(width, height);
  assertLength(grayscale, pixels, "grayscale buffer");
  let sum = 0;
  let squaredSum = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value =
        grayscale[index] * 4 -
        grayscale[index - width] -
        grayscale[index + width] -
        grayscale[index - 1] -
        grayscale[index + 1];
      sum += value;
      squaredSum += value * value;
      samples += 1;
    }
  }
  if (samples === 0) {
    return 0;
  }
  const mean = sum / samples;
  return squaredSum / samples - mean * mean;
}

export function assessGrayscaleImageQuality(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number,
  thresholds: ImageQualityThresholds = {},
): ImageQualityResult {
  const brightness = brightnessCheck(grayscale, width, height, thresholds);
  const blurVariance = laplacianVariance(grayscale, width, height);
  const blurOk = blurVariance >= (thresholds.blurVarianceMin ?? DEFAULT_BLUR_VARIANCE_MIN);
  return {
    issue: brightness.issue ?? (blurOk ? null : "TOO_BLURRY"),
    averageLuma: brightness.averageLuma,
    laplacianVariance: blurVariance,
    brightnessOk: brightness.ok,
    blurOk,
  };
}

export function assessRgbaImageQuality(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  thresholds: ImageQualityThresholds = {},
  reuse?: Uint8ClampedArray,
): ImageQualityResult {
  return assessGrayscaleImageQuality(
    rgbaToGrayscale(rgba, width, height, reuse),
    width,
    height,
    thresholds,
  );
}

