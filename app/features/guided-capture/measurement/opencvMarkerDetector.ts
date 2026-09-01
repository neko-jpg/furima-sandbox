import { homographyFromCorners, type ImageDimensions, type QuadrilateralCorners } from './geometry.ts';
import { detectMeasurementMarker, type MarkerDetectionEngine, type MarkerDetectionOptions, type MarkerDetectionResult, type PixelRect, type RgbaImageData } from './markerDetector.ts';

/**
 * The npm OpenCV.js distribution is a UMD Emscripten module. Keep this small
 * structural type local so the application does not depend on the package's
 * generated global `cv` declaration or leak it into the UI contract.
 */
interface OpenCvMat {
  readonly rows: number;
  readonly cols: number;
  readonly data32S: Int32Array;
  delete(): void;
}

interface OpenCvMatVector {
  size(): number;
  get(index: number): OpenCvMat;
  delete(): void;
}

interface OpenCvRuntime {
  readonly Mat: new (...args: unknown[]) => OpenCvMat;
  readonly MatVector: new (...args: unknown[]) => OpenCvMatVector;
  readonly CV_8UC4: number;
  readonly CV_8UC1: number;
  readonly COLOR_RGBA2GRAY: number;
  readonly THRESH_BINARY_INV: number;
  readonly RETR_TREE: number;
  readonly CHAIN_APPROX_SIMPLE: number;
  readonly Mat_AUTO_STEP?: number;
  threshold(source: OpenCvMat, destination: OpenCvMat, threshold: number, maxValue: number, type: number): void;
  cvtColor(source: OpenCvMat, destination: OpenCvMat, code: number): void;
  findContours(source: OpenCvMat, contours: OpenCvMatVector, hierarchy: OpenCvMat, mode: number, method: number): void;
  arcLength(contour: OpenCvMat, closed: boolean): number;
  approxPolyDP(contour: OpenCvMat, approximation: OpenCvMat, epsilon: number, closed: boolean): void;
  contourArea(contour: OpenCvMat): number;
  boundingRect(contour: OpenCvMat): { x: number; y: number; width: number; height: number };
}

interface OpenCvModuleNamespace {
  readonly default?: unknown;
}

/** Public image shape accepted by the dedicated marker Worker. */
export type OpenCvMarkerImage = RgbaImageData;

const hasRuntimeShape = (value: unknown): value is OpenCvRuntime => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<OpenCvRuntime>;
  return typeof candidate.Mat === 'function'
    && typeof candidate.MatVector === 'function'
    && typeof candidate.threshold === 'function'
    && typeof candidate.cvtColor === 'function'
    && typeof candidate.findContours === 'function'
    && typeof candidate.arcLength === 'function'
    && typeof candidate.approxPolyDP === 'function'
    && typeof candidate.contourArea === 'function'
    && typeof candidate.boundingRect === 'function';
};

const isThenable = (value: unknown): value is PromiseLike<unknown> => (
  typeof value === 'object'
  && value !== null
  && 'then' in value
  && typeof (value as { then?: unknown }).then === 'function'
);

/**
 * OpenCV.js exposes the Emscripten Module as a self-resolving thenable. Using
 * `await module` directly makes the native Promise resolution procedure
 * recursively assimilate the same object forever. Resolve through a wrapper
 * so the callback can signal readiness without handing the thenable back to
 * Promise resolution.
 */
const withoutThenMethod = (value: unknown): unknown => {
  if (!isThenable(value)) return value;
  // Preserve the Emscripten Module through the prototype while shadowing its
  // self-resolving `then` method. Native Promises must never receive the
  // original Module as a fulfillment value or they will assimilate it again.
  const wrapper = Object.create(value) as { then?: unknown };
  Object.defineProperty(wrapper, 'then', { configurable: true, value: undefined });
  return wrapper;
};

const waitForOpenCvThenable = async (value: PromiseLike<unknown>): Promise<unknown> => {
  const result = await new Promise<{ value: unknown }>((resolve, reject) => {
    value.then(
      (resolved) => resolve({ value: withoutThenMethod(resolved) }),
      reject,
    );
  });
  return result.value;
};

let runtimePromise: Promise<OpenCvRuntime> | null = null;

/** Load the pinned, bundled OpenCV.js runtime only when a measurement starts. */
export const loadOpenCvRuntime = (): Promise<OpenCvRuntime> => {
  if (runtimePromise) return runtimePromise;
  runtimePromise = import('@techstark/opencv-js').then(async (namespace) => {
    const candidate = (namespace as unknown as OpenCvModuleNamespace).default ?? namespace;
    const resolved = isThenable(candidate) ? await waitForOpenCvThenable(candidate) : candidate;
    if (hasRuntimeShape(resolved)) return resolved;
    if (typeof resolved === 'object' && resolved !== null && 'onRuntimeInitialized' in resolved) {
      await new Promise<void>((resolve, reject) => {
        const runtimeModule = resolved as { onRuntimeInitialized?: () => void; onAbort?: (reason: unknown) => void };
        const previous = runtimeModule.onRuntimeInitialized;
        runtimeModule.onRuntimeInitialized = () => {
          previous?.();
          resolve();
        };
        runtimeModule.onAbort = (reason) => reject(reason instanceof Error ? reason : new Error('OpenCV.js runtime aborted'));
      });
      if (hasRuntimeShape(resolved)) return resolved;
    }
    throw new Error('OpenCV.js runtime is unavailable');
  });
  return runtimePromise;
};

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const normalizedCorners = (points: readonly { x: number; y: number }[], dimensions: ImageDimensions): QuadrilateralCorners => {
  if (points.length !== 4) throw new RangeError('OpenCV marker must have four corners');
  // OpenCV does not guarantee contour vertex order. The sum/difference
  // ordering is stable for the convex marker quadrilateral and produces the
  // same top-left -> top-right -> bottom-right -> bottom-left contract as the
  // deterministic detector. It also avoids the self-crossing order that an
  // angle sort can produce when two corners share a similar image angle.
  const topLeft = points.reduce((best, point) => point.x + point.y < best.x + best.y ? point : best);
  const bottomRight = points.reduce((best, point) => point.x + point.y > best.x + best.y ? point : best);
  const topRight = points.reduce((best, point) => point.x - point.y > best.x - best.y ? point : best);
  const bottomLeft = points.reduce((best, point) => point.x - point.y < best.x - best.y ? point : best);
  const ordered = [topLeft, topRight, bottomRight, bottomLeft];
  const normalizeX = (value: number): number => value / Math.max(1, dimensions.width - 1);
  const normalizeY = (value: number): number => value / Math.max(1, dimensions.height - 1);
  return ordered.map((point) => ({ x: normalizeX(point.x), y: normalizeY(point.y) })) as unknown as QuadrilateralCorners;
};

const sceneFailure = (marker: PixelRect, image: RgbaImageData, garmentBounds: PixelRect | undefined, minGap: number): MarkerDetectionResult | null => {
  if (!garmentBounds) return null;
  const frame: PixelRect = { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1 };
  if (garmentBounds.left <= frame.left || garmentBounds.top <= frame.top || garmentBounds.right >= frame.right || garmentBounds.bottom >= frame.bottom) {
    return { ok: false, code: 'GARMENT_OUT_OF_FRAME', message: '衣類全体が画角に収まるように撮影してください。' };
  }
  const overlaps = !(marker.right < garmentBounds.left || garmentBounds.right < marker.left || marker.bottom < garmentBounds.top || garmentBounds.bottom < marker.top);
  const horizontal = marker.right < garmentBounds.left
    ? garmentBounds.left - marker.right - 1
    : garmentBounds.right < marker.left ? marker.left - garmentBounds.right - 1 : 0;
  const vertical = marker.bottom < garmentBounds.top
    ? garmentBounds.top - marker.bottom - 1
    : garmentBounds.bottom < marker.top ? marker.top - garmentBounds.bottom - 1 : 0;
  if (overlaps || Math.hypot(horizontal, vertical) < minGap) {
    return { ok: false, code: 'GARMENT_MARKER_OVERLAP', message: 'マーカーを衣類から24px以上離して置いてください。' };
  }
  return null;
};

/**
 * Detect a nested black/white square using OpenCV.js. If the runtime cannot
 * initialize or the image is not suitable for OpenCV, the deterministic
 * contour implementation is used as an explicit offline fallback.
 */
export async function detectMeasurementMarkerWithOpenCv(
  image: RgbaImageData,
  options: MarkerDetectionOptions = {},
  garmentBounds?: PixelRect,
): Promise<MarkerDetectionResult> {
  const fallback = (): MarkerDetectionResult => ({
    ...detectMeasurementMarker(image, options, garmentBounds),
    engine: 'fallback' satisfies MarkerDetectionEngine,
  });
  try {
    const cv = await loadOpenCvRuntime();
    const rgba = new cv.Mat(image.height, image.width, cv.CV_8UC4);
    const gray = new cv.Mat(image.height, image.width, cv.CV_8UC1);
    const thresholded = new cv.Mat(image.height, image.width, cv.CV_8UC1);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    try {
      // Emscripten views accept a Uint8ClampedArray through the underlying
      // Uint8Array copy. The input buffer belongs only to this worker job.
      const target = (rgba as OpenCvMat & { data?: Uint8Array }).data;
      if (!target || target.length < image.width * image.height * 4) return fallback();
      target.set(Uint8Array.from(image.data));
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      cv.threshold(gray, thresholded, options.darknessThreshold ?? 105, 255, cv.THRESH_BINARY_INV);
      cv.findContours(thresholded, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

      const minSidePx = options.minSidePx ?? 80;
      const edgeMarginPx = options.edgeMarginPx ?? 16;
      const minAspectRatio = options.minAspectRatio ?? 0.65;
      const candidates: Array<{ corners: QuadrilateralCorners; sidePx: number; boundingBox: PixelRect; area: number }> = [];
      const hierarchyData = hierarchy.data32S;
      for (let index = 0; index < contours.size(); index += 1) {
        // RETR_TREE returns both sides of the white opening in a bordered
        // marker. Only top-level contours represent the outer printed edge;
        // considering child contours would classify the same marker twice.
        const parentIndex = hierarchyData.length >= (index + 1) * 4 ? hierarchyData[index * 4 + 3] : -1;
        if (parentIndex >= 0) continue;
        const contour = contours.get(index);
        const approximation = new cv.Mat();
        try {
          const perimeter = cv.arcLength(contour, true);
          if (!finitePositive(perimeter)) continue;
          cv.approxPolyDP(contour, approximation, perimeter * 0.04, true);
          const points = approximation.data32S;
          const pointCount = Math.min(approximation.rows * Math.max(1, approximation.cols), Math.floor(points.length / 2));
          if (pointCount !== 4) continue;
          const rectangle = cv.boundingRect(approximation);
          const shortSide = Math.min(rectangle.width, rectangle.height);
          const longSide = Math.max(rectangle.width, rectangle.height);
          const touchesEdge = rectangle.x <= edgeMarginPx
            || rectangle.y <= edgeMarginPx
            || image.width - rectangle.x - rectangle.width <= edgeMarginPx
            || image.height - rectangle.y - rectangle.height <= edgeMarginPx;
          if (shortSide < minSidePx || touchesEdge || longSide <= 0 || shortSide / longSide < minAspectRatio) continue;
          const pointsInPixels = Array.from({ length: 4 }, (_, pointIndex) => ({
            x: points[pointIndex * 2],
            y: points[pointIndex * 2 + 1],
          }));
          const corners = normalizedCorners(pointsInPixels, { width: image.width, height: image.height });
          const boundingBox = { left: rectangle.x, top: rectangle.y, right: rectangle.x + rectangle.width - 1, bottom: rectangle.y + rectangle.height - 1 };
          candidates.push({ corners, sidePx: (rectangle.width + rectangle.height) / 2, boundingBox, area: Math.abs(cv.contourArea(contour)) });
        } finally {
          approximation.delete();
          contour.delete();
        }
      }
      if (candidates.length !== 1) return fallback();
      const selected = candidates[0];
      const failure = sceneFailure(selected.boundingBox, image, garmentBounds, options.minGarmentGapPx ?? 24);
      if (failure) return { ...failure, engine: 'opencv' };
      return {
        ok: true,
        engine: 'opencv',
        marker: {
          corners: selected.corners,
          sidePx: selected.sidePx,
          marker: { knownSideCm: 5, corners: selected.corners, pxPerCm: selected.sidePx / 5 },
          boundingBox: selected.boundingBox,
          score: selected.area,
        },
        projection: homographyFromCorners(selected.corners),
      };
    } finally {
      hierarchy.delete();
      contours.delete();
      thresholded.delete();
      gray.delete();
      rgba.delete();
    }
  } catch {
    return fallback();
  }
}
