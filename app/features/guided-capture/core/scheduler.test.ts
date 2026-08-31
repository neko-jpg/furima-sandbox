import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FRAME_INTERVAL_MS,
  FrameScheduler,
} from "./scheduler.ts";

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

test("manual scheduler processes at most one frame and drops the older pending frame", async () => {
  const processed: number[] = [];
  const disposed: number[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scheduler = new FrameScheduler<number>({
    mode: "manual",
    onFrame: async (frame) => {
      processed.push(frame);
      await gate;
    },
    disposeFrame: (frame) => disposed.push(frame),
  });

  assert.equal(scheduler.interval, DEFAULT_FRAME_INTERVAL_MS);
  scheduler.tick(1, 0);
  await flush();
  scheduler.tick(2, 10);
  scheduler.tick(3, 20);
  assert.equal(scheduler.isProcessing, true);
  assert.equal(scheduler.pendingFrameCount, 1);
  assert.deepEqual(disposed, [2]);
  release?.();
  await flush();
  scheduler.stop();
  assert.deepEqual(disposed, [2, 3]);
  assert.deepEqual(processed, [1]);
});

test("invalid scheduler options are rejected", () => {
  assert.throws(
    () => new FrameScheduler({ onFrame: () => undefined, intervalMs: 0 }),
    /intervalMs/,
  );
});
