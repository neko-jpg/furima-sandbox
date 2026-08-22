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
  assert.match(source, /isAllowedImageSourcePath/);
  assert.match(source, /IMAGE_SOURCE_FORBIDDEN/);
  assert.match(source, /MAX_IMAGE_INPUT_BYTES/);
  assert.match(source, /IMAGE_TRANSFORM_TIMEOUT_MS/);
  assert.match(source, /hasBlockedImageSignature/);
  assert.doesNotMatch(source, /dangerouslyAllowSVG:\s*true/);
});

test("Worker image helpers enforce same-origin asset and parser boundaries", async () => {
  const security = await import(new URL("../worker/image-security.ts", import.meta.url).href);
  assert.equal(security.isAllowedImageSourcePath('/images/products/pexels-selected/0001-pexels-1432236.jpg'), true);
  assert.equal(security.isAllowedImageSourcePath('/images/products/../secrets.json'), false);
  assert.equal(security.isAllowedImageSourcePath('https://example.invalid/image.jpg'), false);
  assert.equal(security.isAllowedImageSourcePath('/images/products/pexels-selected/0001.jpg?raw=1'), false);
  assert.equal(security.hasBlockedImageSignature(new Uint8Array([0x69, 0x63, 0x6e, 0x73])), true);
  assert.equal(security.hasBlockedImageSignature(new Uint8Array([0xff, 0x0a, 0x00])), true);
  assert.equal(security.hasBlockedImageSignature(new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), true);
  assert.equal(security.hasBlockedImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), false);
});
