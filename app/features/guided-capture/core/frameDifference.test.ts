import assert from "node:assert/strict";
import test from "node:test";

import {
  FrameDifferenceTracker,
  normalizedFrameDifference,
} from "./frameDifference.ts";

const frame = (pixels: number[]) => ({
  width: pixels.length,
  height: 1,
  pixels,
});

test("normalizedFrameDifference is symmetric and normalized", () => {
  assert.equal(normalizedFrameDifference(frame([0, 255]), frame([255, 0])), 1);
  assert.equal(normalizedFrameDifference(frame([10, 20]), frame([10, 20])), 0);
});

test("tracker copies input buffers and reports the first frame separately", () => {
  const tracker = new FrameDifferenceTracker(0.1);
  const pixels = new Uint8Array([10, 10]);
  assert.deepEqual(tracker.update({ width: 2, height: 1, pixels }), {
    difference: 0,
    changed: false,
    hasPrevious: false,
  });
  pixels[0] = 255;
  const result = tracker.update({ width: 2, height: 1, pixels });
  assert.equal(result.hasPrevious, true);
  assert.equal(result.changed, true);
  tracker.reset();
  assert.equal(tracker.previousFrame, undefined);
});
