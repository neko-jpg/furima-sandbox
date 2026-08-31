import assert from "node:assert/strict";
import test from "node:test";

import {
  QUALITY_ANALYSIS_HZ,
  assessGrayscaleImageQuality,
  assessRgbaImageQuality,
  rgbaToGrayscale,
} from "./imageQuality.ts";

test("quality analyzer is configured for four local checks per second", () => {
  assert.equal(QUALITY_ANALYSIS_HZ, 4);
  const dark = new Uint8ClampedArray(16).fill(10);
  assert.equal(assessGrayscaleImageQuality(dark, 4, 4).issue, "TOO_DARK");
});

test("RGBA conversion ignores alpha and detects a high-contrast ROI", () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 0, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const grayscale = rgbaToGrayscale(rgba, 2, 2);
  assert.deepEqual([...grayscale], [76, 150, 29, 255]);
  const result = assessRgbaImageQuality(rgba, 2, 2, { blurVarianceMin: 0 });
  assert.equal(result.brightnessOk, true);
  assert.equal(result.issue, null);
});
