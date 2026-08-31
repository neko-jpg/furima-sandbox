import assert from 'node:assert/strict';
import test from 'node:test';
import { compositeRgbaPixels } from './canvasComposite.ts';

const rgba = (...values: number[]): Uint8ClampedArray => new Uint8ClampedArray(values);

test('copies original RGB inside the mask and background pixels outside it', () => {
  const original = { width: 2, height: 2, data: rgba(
    220, 20, 30, 255,
    20, 220, 30, 255,
    20, 30, 220, 255,
    220, 220, 20, 255,
  ) };
  const mask = { width: 2, height: 2, data: rgba(
    255, 255, 255, 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ) };
  const background = { width: 2, height: 2, data: rgba(
    8, 9, 10, 255,
    8, 9, 10, 255,
    8, 9, 10, 255,
    8, 9, 10, 255,
  ) };

  assert.deepEqual(compositeRgbaPixels(original, mask, background), rgba(
    220, 20, 30, 255,
    8, 9, 10, 255,
    8, 9, 10, 255,
    220, 220, 20, 255,
  ));
  assert.deepEqual(original.data, rgba(
    220, 20, 30, 255,
    20, 220, 30, 255,
    20, 30, 220, 255,
    220, 220, 20, 255,
  ));
});

test('blends only fractional mask edges and preserves opaque pixels exactly', () => {
  const result = compositeRgbaPixels(
    { width: 2, height: 1, data: rgba(100, 50, 0, 255, 200, 100, 50, 255) },
    { width: 2, height: 1, data: rgba(128, 128, 128, 255, 255, 255, 255, 255) },
    { width: 2, height: 1, data: rgba(0, 0, 100, 255, 10, 20, 30, 255) },
  );
  assert.deepEqual(result, rgba(50, 25, 50, 255, 200, 100, 50, 255));
});

test('rejects dimension mismatches and empty or full masks before composition', () => {
  const original = { width: 2, height: 1, data: rgba(1, 2, 3, 255, 4, 5, 6, 255) };
  const background = { width: 2, height: 1, data: rgba(7, 8, 9, 255, 7, 8, 9, 255) };
  assert.throws(() => compositeRgbaPixels(original, { width: 1, height: 1, data: rgba(255, 255, 255, 255) }, background));
  assert.throws(() => compositeRgbaPixels(original, { width: 2, height: 1, data: rgba(0, 0, 0, 255, 0, 0, 0, 255) }, background));
  assert.throws(() => compositeRgbaPixels(original, { width: 2, height: 1, data: rgba(255, 255, 255, 255, 255, 255, 255, 255) }, background));
});
