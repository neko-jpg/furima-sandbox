import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Worker image boundary has binding and failure guards", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /isImageOptimizationRequest/);
  assert.match(source, /allowedImageWidths/);
  assert.match(source, /WORKER_BINDING_UNAVAILABLE/);
  assert.match(source, /IMAGE_OPTIMIZATION_FAILED/);
  assert.match(source, /DEFAULT_DEVICE_SIZES/);
  assert.match(source, /DEFAULT_IMAGE_SIZES/);
});

test("Worker boundary rejects non-allowlisted image paths before optimization", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /url\.pathname\)\)/);
  assert.doesNotMatch(source, /dangerouslyAllowSVG:\s*true/);
});
