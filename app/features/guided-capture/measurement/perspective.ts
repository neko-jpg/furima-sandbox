import type { Homography } from './geometry.ts';
import type { RgbaImageData } from './markerDetector.ts';

export interface ProjectedRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** Effective pixels per unit side after the bounded output resize. */
  readonly markerSidePx: number;
  readonly scale: number;
}

const MAX_IMAGE_PIXELS = 16_777_216;
const DEFAULT_MAX_EDGE = 1_280;
const MIN_DENOMINATOR = 1e-9;

type PlanePoint = { x: number; y: number };

const isFinitePoint = (point: PlanePoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const projectPlanePoint = (point: PlanePoint, homography: Homography): PlanePoint => {
  const values = homography.values;
  if (values.length !== 9 || !values.every(Number.isFinite)) throw new RangeError('Homography must contain nine finite values.');
  const denominator = values[6] * point.x + values[7] * point.y + values[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < MIN_DENOMINATOR) throw new RangeError('Homography has a zero projection denominator.');
  const projected = {
    x: (values[0] * point.x + values[1] * point.y + values[2]) / denominator,
    y: (values[3] * point.x + values[4] * point.y + values[5]) / denominator,
  };
  if (!isFinitePoint(projected)) throw new RangeError('Homography produced a non-finite point.');
  return projected;
};

const inverseHomography = (homography: Homography): Homography => {
  const [a, b, c, d, e, f, g, h, i] = homography.values;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < MIN_DENOMINATOR) throw new RangeError('Homography cannot be inverted.');
  const inverse = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ].map((value) => value / determinant);
  if (!inverse.every(Number.isFinite)) throw new RangeError('Homography inverse is not finite.');
  return { values: inverse as unknown as Homography['values'] };
};

const sampleChannel = (
  data: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number => {
  if (x < 0 || x > width - 1 || y < 0 || y > height - 1) return 255;
  const sourceX = Math.min(width - 1, Math.max(0, x));
  const sourceY = Math.min(height - 1, Math.max(0, y));
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const horizontal = sourceX - left;
  const vertical = sourceY - top;
  const at = (column: number, row: number): number => Number(data[(row * width + column) * 4 + channel]);
  const topValue = at(left, top) * (1 - horizontal) + at(right, top) * horizontal;
  const bottomValue = at(left, bottom) * (1 - horizontal) + at(right, bottom) * horizontal;
  return Math.round(topValue * (1 - vertical) + bottomValue * vertical);
};

const validInput = (image: RgbaImageData): boolean => (
  Number.isInteger(image.width)
  && image.width >= 2
  && Number.isInteger(image.height)
  && image.height >= 2
  && image.width * image.height <= MAX_IMAGE_PIXELS
  && image.data.length >= image.width * image.height * 4
);

/**
 * Warps a bounded RGBA analysis copy into the photographed marker plane.
 *
 * The detected marker is mapped to a square whose side is the measured marker
 * side in pixels. The whole source frame is retained by translating the
 * projected source bounds into a fresh output raster. This keeps the marker
 * scale and endpoint coordinate system consistent while avoiding any upload of
 * the original Blob or a main-thread WASM operation.
 */
export function projectRgbaImage(
  image: RgbaImageData,
  homography: Homography,
  markerSidePx: number,
  maxEdge = DEFAULT_MAX_EDGE,
): ProjectedRgbaImage {
  if (!validInput(image)) throw new RangeError('Projection image is invalid or exceeds the pixel limit.');
  if (!Number.isFinite(markerSidePx) || markerSidePx <= 0) throw new RangeError('Marker side must be finite and positive.');
  if (!Number.isInteger(maxEdge) || maxEdge < 64 || maxEdge > 4_096) throw new RangeError('Projection maxEdge is invalid.');

  const sourceCorners: readonly PlanePoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const projectedCorners = sourceCorners.map((point) => projectPlanePoint(point, homography));
  const minX = Math.min(...projectedCorners.map((point) => point.x));
  const maxX = Math.max(...projectedCorners.map((point) => point.x));
  const minY = Math.min(...projectedCorners.map((point) => point.y));
  const maxY = Math.max(...projectedCorners.map((point) => point.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (![minX, maxX, minY, maxY, spanX, spanY].every(Number.isFinite) || spanX <= 0 || spanY <= 0) {
    throw new RangeError('Projected source bounds are invalid.');
  }

  const unboundedWidth = Math.ceil(spanX * markerSidePx) + 1;
  const unboundedHeight = Math.ceil(spanY * markerSidePx) + 1;
  if (!Number.isFinite(unboundedWidth) || !Number.isFinite(unboundedHeight) || unboundedWidth < 2 || unboundedHeight < 2) {
    throw new RangeError('Projected output dimensions are invalid.');
  }
  const areaScale = Math.min(
    1,
    maxEdge / Math.max(unboundedWidth, unboundedHeight),
    Math.sqrt(MAX_IMAGE_PIXELS / Math.max(1, unboundedWidth * unboundedHeight)),
  );
  const effectiveScale = markerSidePx * areaScale;
  const width = Math.max(2, Math.min(maxEdge, Math.ceil(spanX * effectiveScale) + 1));
  const height = Math.max(2, Math.min(maxEdge, Math.ceil(spanY * effectiveScale) + 1));
  if (!Number.isFinite(effectiveScale) || effectiveScale <= 0 || width * height > MAX_IMAGE_PIXELS) {
    throw new RangeError('Projected output exceeds the safe image bound.');
  }

  const inverse = inverseHomography(homography);
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const planePoint = {
        x: minX + (x + 0.5) / effectiveScale,
        y: minY + (y + 0.5) / effectiveScale,
      };
      let sourcePoint: PlanePoint;
      try {
        sourcePoint = projectPlanePoint(planePoint, inverse);
      } catch {
        sourcePoint = { x: -1, y: -1 };
      }
      const outputOffset = (y * width + x) * 4;
      const sourceX = sourcePoint.x * (image.width - 1);
      const sourceY = sourcePoint.y * (image.height - 1);
      if (sourcePoint.x < 0 || sourcePoint.x > 1 || sourcePoint.y < 0 || sourcePoint.y > 1) {
        output[outputOffset] = 255;
        output[outputOffset + 1] = 255;
        output[outputOffset + 2] = 255;
        output[outputOffset + 3] = 255;
        continue;
      }
      output[outputOffset] = sampleChannel(image.data, image.width, image.height, sourceX, sourceY, 0);
      output[outputOffset + 1] = sampleChannel(image.data, image.width, image.height, sourceX, sourceY, 1);
      output[outputOffset + 2] = sampleChannel(image.data, image.width, image.height, sourceX, sourceY, 2);
      output[outputOffset + 3] = sampleChannel(image.data, image.width, image.height, sourceX, sourceY, 3);
    }
  }

  return { width, height, data: output, markerSidePx: effectiveScale, scale: areaScale };
}

export { DEFAULT_MAX_EDGE };
