import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMeasurementMarker } from './markerDetector.ts';

const image = (width: number, height: number, draw: (x: number, y: number) => [number, number, number, number]): ImageDataLike => ({
  width,
  height,
  data: Uint8Array.from({ length: width * height * 4 }, (_, index) => draw(Math.floor(index / 4) % width, Math.floor(index / 4 / width))[index % 4]),
});

interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const markerImage = (width = 240, height = 240, left = 80, top = 80, size = 80): ImageDataLike => image(width, height, (x, y) => {
  const inMarker = x >= left && x < left + size && y >= top && y < top + size;
  const inBorder = inMarker && (x - left < 8 || left + size - 1 - x < 8 || y - top < 8 || top + size - 1 - y < 8);
  return inBorder ? [0, 0, 0, 255] : [255, 255, 255, 255];
});

test('detects one safe 50mm marker and creates a projection', () => {
  const result = detectMeasurementMarker(markerImage());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.marker.marker.knownSideCm, 5);
  assert.ok(result.marker.sidePx >= 80);
  assert.equal(result.marker.corners.length, 4);
  assert.equal(result.projection.values.length, 9);
});

test('classifies missing, too-small, multiple, and occluded markers', () => {
  assert.equal(detectMeasurementMarker(markerImage(240, 240, 80, 80, 60)).ok, false);
  assert.equal(detectMeasurementMarker(markerImage(240, 240, 0, 80, 90)).ok, false);
  const firstMarker = markerImage(300, 240, 40, 80, 80);
  const two = image(300, 240, (x, y) => {
    const first = firstMarker.data[(y * 300 + x) * 4] === 0;
    const second = x >= 180 && x < 260 && y >= 80 && y < 160 && (x - 180 < 8 || 259 - x < 8 || y - 80 < 8 || 159 - y < 8);
    return first || second ? [0, 0, 0, 255] : [255, 255, 255, 255];
  });
  const multiple = detectMeasurementMarker(two);
  assert.equal(multiple.ok, false);
  if (!multiple.ok) assert.equal(multiple.code, 'MARKER_MULTIPLE');
  const blocked = image(240, 240, (x, y) => x >= 80 && x < 160 && y >= 80 && y < 160 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  const occluded = detectMeasurementMarker(blocked);
  assert.equal(occluded.ok, false);
  if (!occluded.ok) assert.equal(occluded.code, 'MARKER_OCCLUDED');
});

test('rejects garment bounds that leave the frame or overlap the marker', () => {
  const boundsOutside = detectMeasurementMarker(markerImage(), {}, { left: 10, top: 10, right: 240, bottom: 220 });
  assert.equal(boundsOutside.ok, false);
  if (!boundsOutside.ok) assert.equal(boundsOutside.code, 'GARMENT_OUT_OF_FRAME');
  const boundsOverlap = detectMeasurementMarker(markerImage(), {}, { left: 100, top: 100, right: 180, bottom: 180 });
  assert.equal(boundsOverlap.ok, false);
  if (!boundsOverlap.ok) assert.equal(boundsOverlap.code, 'GARMENT_MARKER_OVERLAP');
});
