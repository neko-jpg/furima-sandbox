import assert from "node:assert/strict";
import test from "node:test";

import { clampNormalizedRect, toPixelRoi } from "./pixelRoi.ts";

test("cover ROI maps normalized display coordinates to intrinsic video pixels", () => {
  const roi = toPixelRoi({
    guide: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    display: { width: 400, height: 400 },
    video: { width: 800, height: 400 },
    objectFit: "cover",
  });
  assert.deepEqual(roi, { x: 300, y: 100, width: 200, height: 200 });
});

test("offscreen guides are clipped and fully invisible guides return null", () => {
  const clipped = clampNormalizedRect({ x: -0.2, y: 0.2, width: 0.4, height: 0.4 });
  assert.ok(clipped !== null);
  assert.equal(clipped.x, 0);
  assert.equal(clipped.y, 0.2);
  assert.equal(clipped.width, 0.2);
  assert.ok(Math.abs(clipped.height - 0.4) < 1e-12);
  assert.equal(clampNormalizedRect({ x: 2, y: 0, width: 0.2, height: 0.2 }), null);
  assert.equal(toPixelRoi({
    guide: { x: 2, y: 0, width: 0.2, height: 0.2 },
    display: { width: 400, height: 400 },
    video: { width: 400, height: 400 },
    objectFit: "contain",
  }), null);
});
