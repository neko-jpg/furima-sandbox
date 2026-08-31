import assert from 'node:assert/strict';
import test from 'node:test';
import { MaskValidationError, validateMaskPixels } from './maskValidation.ts';

const rgba = (...values: number[]): Uint8ClampedArray => new Uint8ClampedArray(values);

test('accepts a grayscale mask with foreground and background', () => {
  const result = validateMaskPixels({ width: 2, height: 1, data: rgba(255, 255, 255, 255, 0, 0, 0, 255) });
  assert.deepEqual(result, { width: 2, height: 1, foregroundPixels: 1, backgroundPixels: 1 });
});

test('rejects empty, full, and RGB masks', () => {
  assert.throws(() => validateMaskPixels({ width: 1, height: 1, data: rgba(0, 0, 0, 255) }), (error: unknown) => error instanceof MaskValidationError && error.code === 'EMPTY_MASK');
  assert.throws(() => validateMaskPixels({ width: 1, height: 1, data: rgba(255, 255, 255, 255) }), (error: unknown) => error instanceof MaskValidationError && error.code === 'FULL_MASK');
  assert.throws(() => validateMaskPixels({ width: 1, height: 1, data: rgba(255, 0, 0, 255) }), (error: unknown) => error instanceof MaskValidationError && error.code === 'INVALID_PIXELS');
});
