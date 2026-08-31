export interface MaskPixelData {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes returned by CanvasRenderingContext2D.getImageData(). */
  readonly data: ArrayLike<number>;
}
export interface ValidatedMask {
  readonly width: number;
  readonly height: number;
  readonly foregroundPixels: number;
  readonly backgroundPixels: number;
}

export type MaskValidationErrorCode = 'INVALID_DIMENSIONS' | 'INVALID_PIXELS' | 'EMPTY_MASK' | 'FULL_MASK';

export class MaskValidationError extends Error {
  public readonly code: MaskValidationErrorCode;

  public constructor(code: MaskValidationErrorCode, message: string) {
    super(message);
    this.name = 'MaskValidationError';
    this.code = code;
  }
}

/**
 * Validates the decoded mask rather than trusting a file extension or MIME
 * type. RGB must be grayscale, and both foreground and background must exist.
 */
export function validateMaskPixels(input: MaskPixelData): ValidatedMask {
  const { width, height, data } = input;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new MaskValidationError('INVALID_DIMENSIONS', 'Mask dimensions must be positive integers.');
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || data.length !== pixelCount * 4) {
    throw new MaskValidationError('INVALID_PIXELS', 'Mask RGBA data does not match its dimensions.');
  }

  let foregroundPixels = 0;
  let backgroundPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (![red, green, blue, alpha].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
      throw new MaskValidationError('INVALID_PIXELS', 'Mask contains an invalid pixel value.');
    }
    if (red !== green || green !== blue) {
      throw new MaskValidationError('INVALID_PIXELS', 'Mask must be grayscale and contain no product RGB.');
    }
    const visible = alpha > 0 && red > 0;
    const hidden = alpha === 0 || red < 255;
    if (visible) foregroundPixels += 1;
    if (hidden) backgroundPixels += 1;
  }
  if (foregroundPixels === 0) throw new MaskValidationError('EMPTY_MASK', 'Mask contains no foreground.');
  if (backgroundPixels === 0) throw new MaskValidationError('FULL_MASK', 'Mask contains no background.');
  return { width, height, foregroundPixels, backgroundPixels };
}

export function assertMaskDimensions(
  mask: Pick<MaskPixelData, 'width' | 'height'>,
  expected: Pick<MaskPixelData, 'width' | 'height'>,
): void {
  if (mask.width !== expected.width || mask.height !== expected.height) {
    throw new MaskValidationError('INVALID_DIMENSIONS', 'Mask dimensions must match the source image.');
  }
}
