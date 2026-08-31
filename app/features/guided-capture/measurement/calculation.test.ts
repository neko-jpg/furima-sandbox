import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMeasurement } from './calculation.ts';
import { homographyFromCorners, projectMeasurementEndpoints } from './geometry.ts';

const endpoints = {
  lengthStart: { x: 0.5, y: 0.1 },
  lengthEnd: { x: 0.5, y: 0.6 },
  widthStart: { x: 0.2, y: 0.5 },
  widthEnd: { x: 0.8, y: 0.5 },
} as const;

test('local measurement calculation stays unavailable until a marker scale exists', () => {
  const withoutScale = calculateMeasurement({ endpoints, imageDimensions: { width: 1001, height: 801 } });
  assert.equal(withoutScale.lengthCm, null);
  assert.equal(withoutScale.widthCm, null);

  const calculated = calculateMeasurement({
    endpoints,
    imageDimensions: { width: 1001, height: 801 },
    markerSidePx: 250,
  });
  assert.equal(calculated.pixelsPerCm, 50);
  assert.equal(calculated.lengthCm, 8);
  assert.equal(calculated.widthCm, 12);
});

test('quadrilateral projection maps marker plane corners to a unit rectangle', () => {
  const homography = homographyFromCorners([
    { x: 0.2, y: 0.1 },
    { x: 0.8, y: 0.2 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.8 },
  ]);
  const projected = projectMeasurementEndpoints({
    lengthStart: { x: 0.2, y: 0.1 },
    lengthEnd: { x: 0.9, y: 0.9 },
    widthStart: { x: 0.8, y: 0.2 },
    widthEnd: { x: 0.1, y: 0.8 },
  }, homography);
  const expected = [
    [projected.lengthStart, { x: 0, y: 0 }],
    [projected.lengthEnd, { x: 1, y: 1 }],
    [projected.widthStart, { x: 1, y: 0 }],
    [projected.widthEnd, { x: 0, y: 1 }],
  ] as const;
  expected.forEach(([actual, target]) => {
    assert.ok(Math.abs(actual.x - target.x) < 1e-6);
    assert.ok(Math.abs(actual.y - target.y) < 1e-6);
  });
});

test('degenerate projection corners are rejected', () => {
  assert.throws(() => homographyFromCorners([
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
  ]), RangeError);
});
