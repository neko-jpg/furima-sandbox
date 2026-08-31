import type { MeasurementEndpoints, NormalizedPoint } from '../../../types/measurement';

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface Homography {
  /** Row-major 3×3 projective transform. */
  readonly values: readonly [number, number, number, number, number, number, number, number, number];
}

/**
 * Four source points in clockwise order, starting at the top-left corner.
 * The browser uses these points to map a photographed marker plane onto a
 * unit rectangle before measuring garment lines.
 */
export type QuadrilateralCorners = readonly [
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
];

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const assertDimensions = ({ width, height }: ImageDimensions): void => {
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2) {
    throw new RangeError('Image dimensions must be integers greater than one.');
  }
};

const assertNormalizedPoint = ({ x, y }: NormalizedPoint): void => {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new RangeError('Normalized points must contain finite coordinates between zero and one.');
  }
};

export function normalizedToPixel(point: NormalizedPoint, dimensions: ImageDimensions): PixelPoint {
  assertDimensions(dimensions);
  assertNormalizedPoint(point);
  return { x: point.x * (dimensions.width - 1), y: point.y * (dimensions.height - 1) };
}

export function pixelToNormalized(point: PixelPoint, dimensions: ImageDimensions): NormalizedPoint {
  assertDimensions(dimensions);
  if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y) || point.x < 0 || point.x > dimensions.width - 1 || point.y < 0 || point.y > dimensions.height - 1) {
    throw new RangeError('Pixel points must be inside the image.');
  }
  return { x: point.x / (dimensions.width - 1), y: point.y / (dimensions.height - 1) };
}

export function distancePx(start: PixelPoint, end: PixelPoint): number {
  if (![start.x, start.y, end.x, end.y].every(isFiniteNumber)) throw new RangeError('Pixel points must be finite.');
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance <= 0) throw new RangeError('Measurement endpoints must be different.');
  return distance;
}

export function pixelsPerCmFromMarker(knownSidePx: number, knownSideCm = 5): number {
  if (!isFiniteNumber(knownSidePx) || knownSidePx <= 0 || !isFiniteNumber(knownSideCm) || knownSideCm <= 0) {
    throw new RangeError('Marker dimensions must be finite and positive.');
  }
  return knownSidePx / knownSideCm;
}

export function centimetersFromPixels(distance: number, pixelsPerCm: number): number {
  if (!isFiniteNumber(distance) || distance <= 0 || !isFiniteNumber(pixelsPerCm) || pixelsPerCm <= 0) {
    throw new RangeError('Distance and scale must be finite and positive.');
  }
  return distance / pixelsPerCm;
}

export function measureLineCm(
  start: NormalizedPoint,
  end: NormalizedPoint,
  dimensions: ImageDimensions,
  pixelsPerCm: number,
): number {
  return centimetersFromPixels(distancePx(normalizedToPixel(start, dimensions), normalizedToPixel(end, dimensions)), pixelsPerCm);
}

export function applyHomography(point: NormalizedPoint, homography: Homography): NormalizedPoint {
  assertNormalizedPoint(point);
  const values = homography.values;
  if (values.length !== 9 || !values.every(isFiniteNumber)) throw new RangeError('Homography must contain nine finite values.');
  const denominator = values[6] * point.x + values[7] * point.y + values[8];
  if (!isFiniteNumber(denominator) || Math.abs(denominator) < Number.EPSILON) throw new RangeError('Homography has a zero projection denominator.');
  const x = (values[0] * point.x + values[1] * point.y + values[2]) / denominator;
  const y = (values[3] * point.x + values[4] * point.y + values[5]) / denominator;
  const epsilon = 1e-8;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || x < -epsilon || x > 1 + epsilon || y < -epsilon || y > 1 + epsilon) throw new RangeError('Projected point is outside the normalized image.');
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export function projectMeasurementEndpoints(endpoints: MeasurementEndpoints, homography: Homography): MeasurementEndpoints {
  return {
    lengthStart: applyHomography(endpoints.lengthStart, homography),
    lengthEnd: applyHomography(endpoints.lengthEnd, homography),
    widthStart: applyHomography(endpoints.widthStart, homography),
    widthEnd: applyHomography(endpoints.widthEnd, homography),
  };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  if (matrix.length !== size || matrix.some((row) => row.length !== size)) {
    throw new RangeError('Homography system has an invalid shape.');
  }
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (!Number.isFinite(augmented[pivot][column]) || Math.abs(augmented[pivot][column]) < 1e-10) {
      throw new RangeError('Marker corners are degenerate.');
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let value = column; value <= size; value += 1) augmented[column][value] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let value = column; value <= size; value += 1) augmented[row][value] -= factor * augmented[column][value];
    }
  }
  return augmented.map((row) => row[size]);
}

/**
 * Builds a projective transform from a photographed quadrilateral to the
 * normalized rectangle.  This stays in the browser so raw measurement
 * imagery never needs to be sent back to the provider for calibration.
 */
export function homographyFromCorners(corners: QuadrilateralCorners): Homography {
  const target: readonly NormalizedPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  corners.forEach(assertNormalizedPoint);
  const matrix: number[][] = [];
  const vector: number[] = [];
  corners.forEach((source, index) => {
    const destination = target[index];
    const { x, y } = source;
    const { x: u, y: v } = destination;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  });
  const values = solveLinearSystem(matrix, vector);
  const homography: Homography = {
    values: [values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], 1],
  };
  // Validate the four corners after solving.  This catches transforms that
  // are numerically finite but project outside the normalized image.
  corners.forEach((corner, index) => {
    const projected = applyHomography(corner, homography);
    if (Math.abs(projected.x - target[index].x) > 1e-6 || Math.abs(projected.y - target[index].y) > 1e-6) {
      throw new RangeError('Marker corners could not be projected reliably.');
    }
  });
  return homography;
}
