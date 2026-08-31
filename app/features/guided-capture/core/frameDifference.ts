/** Pure grayscale frame-difference helpers used by live guidance. */

export const DEFAULT_FRAME_DIFFERENCE_THRESHOLD = 0.08;

export interface GrayFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayLike<number>;
}

export interface FrameDifferenceResult {
  readonly difference: number;
  readonly changed: boolean;
  readonly hasPrevious: boolean;
}

function assertFrame(frame: GrayFrame): void {
  if (!Number.isInteger(frame.width) || frame.width <= 0) {
    throw new RangeError("frame.width must be a positive integer");
  }
  if (!Number.isInteger(frame.height) || frame.height <= 0) {
    throw new RangeError("frame.height must be a positive integer");
  }
  const expected = frame.width * frame.height;
  if (frame.pixels.length !== expected) {
    throw new RangeError(`frame.pixels length must be ${expected}`);
  }
}

function assertThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("frame difference threshold must be between 0 and 1");
  }
}

/** Returns the mean absolute grayscale difference normalized to 0..1. */
export function normalizedFrameDifference(
  previous: GrayFrame,
  current: GrayFrame,
): number {
  assertFrame(previous);
  assertFrame(current);
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new RangeError("frames must have identical dimensions");
  }

  let total = 0;
  for (let index = 0; index < previous.pixels.length; index += 1) {
    const delta = Math.abs(previous.pixels[index] - current.pixels[index]);
    total += Math.min(255, Math.max(0, delta));
  }
  return total / (previous.pixels.length * 255);
}

/**
 * Stateful helper that copies the previous pixels so callers may reuse their
 * camera buffer.  A first frame is always considered stable (difference 0).
 */
export class FrameDifferenceTracker {
  private previous: GrayFrame | undefined;
  private readonly threshold: number;

  public constructor(threshold = DEFAULT_FRAME_DIFFERENCE_THRESHOLD) {
    assertThreshold(threshold);
    this.threshold = threshold;
  }

  public get previousFrame(): GrayFrame | undefined {
    return this.previous;
  }

  public get changeThreshold(): number {
    return this.threshold;
  }

  public reset(): void {
    this.previous = undefined;
  }

  public update(frame: GrayFrame): FrameDifferenceResult {
    assertFrame(frame);
    if (this.previous === undefined) {
      this.previous = {
        width: frame.width,
        height: frame.height,
        pixels: new Uint8Array(frame.pixels),
      };
      return { difference: 0, changed: false, hasPrevious: false };
    }

    if (this.previous.width !== frame.width || this.previous.height !== frame.height) {
      this.previous = {
        width: frame.width,
        height: frame.height,
        pixels: new Uint8Array(frame.pixels),
      };
      return { difference: 1, changed: true, hasPrevious: true };
    }

    const difference = normalizedFrameDifference(this.previous, frame);
    this.previous = {
      width: frame.width,
      height: frame.height,
      pixels: new Uint8Array(frame.pixels),
    };
    return {
      difference,
      changed: difference > this.threshold,
      hasPrevious: true,
    };
  }
}

export function createFrameDifferenceTracker(
  threshold = DEFAULT_FRAME_DIFFERENCE_THRESHOLD,
): FrameDifferenceTracker {
  return new FrameDifferenceTracker(threshold);
}

