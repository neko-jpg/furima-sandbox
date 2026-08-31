import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureCaptureAdapter } from "./fixtureAdapter.ts";

const blob = new Blob(["image"], { type: "image/jpeg" });

test("fixture adapter completes front, back, tag, and measurement deterministically", async () => {
  const now = 1_000;
  const adapter = createFixtureCaptureAdapter({ now: () => now });
  await adapter.connect("fixture-session");

  const front = await adapter.assessShot({
    sessionId: "fixture-session",
    slot: "front",
    blob,
    requestId: "front-1",
    sequence: 1,
  });
  assert.equal(front.accepted, true);
  assert.equal(front.value?.nextAction, "REQUEST_NEXT");

  const back = await adapter.assessShot({
    sessionId: "fixture-session",
    slot: "back",
    blob,
    requestId: "back-2",
    sequence: 2,
  });
  const tag = await adapter.assessShot({
    sessionId: "fixture-session",
    slot: "tag",
    blob,
    requestId: "tag-3",
    sequence: 3,
  });
  assert.equal(back.accepted, true);
  assert.equal(tag.value?.nextAction, "COMPLETE");

  const measurement = await adapter.suggestMeasurementPoints({
    sessionId: "fixture-session",
    blob,
    requestId: "measurement-4",
    sequence: 4,
  });
  assert.equal(measurement.accepted, true);
  assert.equal(measurement.value?.status, "needs_review");
  assert.equal(measurement.value?.lengthCm, 68);
  assert.equal(adapter.guidance("measurement", "READY")?.expiresAt, now + 2_000);
});

test("fixture adapter rejects stale sessions, sequences, and duplicate request ids", async () => {
  const adapter = createFixtureCaptureAdapter();
  await adapter.connect("current");
  const request = {
    sessionId: "current",
    slot: "front" as const,
    blob,
    requestId: "same-request",
    sequence: 1,
  };
  assert.equal((await adapter.assessShot(request)).accepted, true);

  const staleSequence = await adapter.assessShot({ ...request, requestId: "new-request", sequence: 1 });
  assert.equal(staleSequence.error?.code, "STALE_SEQUENCE");
  const staleRequest = await adapter.assessShot({ ...request, sequence: 2 });
  assert.equal(staleRequest.error?.code, "STALE_REQUEST");
  const staleSession = await adapter.assessShot({ ...request, sessionId: "old", requestId: "old-request", sequence: 3 });
  assert.equal(staleSession.error?.code, "STALE_SESSION");
});
