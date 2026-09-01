import assert from 'node:assert/strict';
import test from 'node:test';
import { homographyFromCorners } from './geometry.ts';
import { projectRgbaImage } from './perspective.ts';

const identity = homographyFromCorners([
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]);

test('projectRgbaImage preserves a fronto-parallel image and marker scale', () => {
  const image = new Uint8ClampedArray([
    10, 20, 30, 255, 40, 50, 60, 255,
    70, 80, 90, 255, 100, 110, 120, 255,
  ]);
  const projected = projectRgbaImage({ width: 2, height: 2, data: image }, identity, 32, 64);
  assert.equal(projected.width, 33);
  assert.equal(projected.height, 33);
  assert.equal(projected.markerSidePx, 32);
  assert.equal(projected.data.length, projected.width * projected.height * 4);
  assert.deepEqual([...projected.data.slice(16 * projected.width * 4 + 16 * 4, 16 * projected.width * 4 + 16 * 4 + 4)], [56, 66, 76, 255]);
});

test('projectRgbaImage bounds output and rejects invalid marker scale', () => {
  const image = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
  const projected = projectRgbaImage(image, identity, 512, 64);
  assert.equal(Math.max(projected.width, projected.height), 64);
  assert.ok(projected.markerSidePx < 512);
  assert.throws(() => projectRgbaImage(image, identity, 0), RangeError);
});
