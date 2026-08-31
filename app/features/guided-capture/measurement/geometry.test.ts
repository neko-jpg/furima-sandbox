import assert from 'node:assert/strict';
import test from 'node:test';
import { centimetersFromPixels, distancePx, measureLineCm, normalizedToPixel, pixelsPerCmFromMarker, projectMeasurementEndpoints } from './geometry.ts';

test('measurement geometry maps normalized endpoints and converts pixels to centimetres', () => {
  assert.deepEqual(normalizedToPixel({ x: 0.5, y: 0.5 }, { width: 1001, height: 801 }), { x: 500, y: 400 });
  assert.equal(distancePx({ x: 0, y: 0 }, { x: 300, y: 400 }), 500);
  assert.equal(pixelsPerCmFromMarker(250), 50);
  assert.equal(centimetersFromPixels(500, 50), 10);
  assert.equal(measureLineCm({ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.6 }, { width: 1001, height: 801 }, 50), 8);
});
test('measurement geometry applies a normalized projective transform', () => {
  const endpoints = projectMeasurementEndpoints({
    lengthStart: { x: 0.1, y: 0.2 }, lengthEnd: { x: 0.1, y: 0.8 },
    widthStart: { x: 0.2, y: 0.5 }, widthEnd: { x: 0.8, y: 0.5 },
  }, { values: [1, 0, 0.1, 0, 1, 0.1, 0, 0, 1] });
  assert.deepEqual(endpoints.lengthStart, { x: 0.2, y: 0.30000000000000004 });
  assert.deepEqual(endpoints.widthEnd, { x: 0.9, y: 0.6 });
});

test('measurement geometry rejects invalid values and zero-length lines', () => {
  assert.throws(() => normalizedToPixel({ x: 2, y: 0 }, { width: 10, height: 10 }), RangeError);
  assert.throws(() => distancePx({ x: 1, y: 1 }, { x: 1, y: 1 }), RangeError);
  assert.throws(() => pixelsPerCmFromMarker(0), RangeError);
});
