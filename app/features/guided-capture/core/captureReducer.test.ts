import assert from "node:assert/strict";
import test from "node:test";

import {
  canEnterEdit,
  captureActions,
  captureReducer,
  createInitialCaptureState,
} from "./captureReducer.ts";
import type { MeasurementDraft, ShotAssessment } from "./types.ts";

const blob = (label: string): Blob => new Blob([label], { type: "image/jpeg" });

const assessment = (slot: "front" | "back" | "tag", nextAction: ShotAssessment["nextAction"] = slot === "tag" ? "COMPLETE" : "REQUEST_NEXT"): ShotAssessment => ({
  shotType: slot,
  quality: "ok",
  issues: [],
  missingShots: [],
  nextAction,
});

const draft: MeasurementDraft = {
  imageId: "measurement-1",
  endpoints: {
    lengthStart: { x: 0.5, y: 0.1 },
    lengthEnd: { x: 0.5, y: 0.9 },
    widthStart: { x: 0.2, y: 0.5 },
    widthEnd: { x: 0.8, y: 0.5 },
  },
  lengthCm: 68,
  widthCm: 52,
  confidence: 0.96,
  source: "ai",
  status: "needs_review",
};

function acceptImage(
  state: ReturnType<typeof createInitialCaptureState>,
  slot: "front" | "back" | "tag",
  sequence: number,
) {
  const requestId = `${slot}-${sequence}`;
  const submitted = captureReducer(
    state,
    captureActions.submit(state.sessionId, slot, blob(slot), `blob:${slot}`, requestId, sequence),
  );
  return captureReducer(
    submitted,
    captureActions.assessed(state.sessionId, slot, assessment(slot), requestId, sequence),
  );
}

test("reducer completes all four slots without trusting nextAction", () => {
  const sessionId = "session-1";
  let state = createInitialCaptureState(sessionId);
  state = acceptImage(state, "front", 1);
  state = acceptImage(state, "back", 2);
  state = acceptImage(state, "tag", 3);

  assert.equal(state.currentSlot, "measurement");
  assert.equal(state.currentStep, "measurement-preparation");
  assert.equal(state.phase, "measurement");
  assert.equal(state.slots.measurement, null);

  const measurementRequest = "measurement-4";
  state = captureReducer(
    state,
    captureActions.submit(sessionId, "measurement", blob("measurement"), "blob:measurement", measurementRequest, 4),
  );
  assert.equal(state.currentStep, "measurement-capture");
  state = captureReducer(
    state,
    captureActions.measurementDrafted(sessionId, draft, measurementRequest, 4),
  );
  assert.equal(state.phase, "measurement");
  assert.equal(state.currentStep, "measurement-review");
  assert.equal(state.slots.measurement?.kind, "measurement");
  assert.equal(canEnterEdit(state), false);

  state = captureReducer(
    state,
    captureActions.approveMeasurement(sessionId, {
      lengthCm: 68,
      widthCm: 52,
      source: "approved_cv",
    }, 5),
  );
  assert.equal(state.phase, "ready");
  assert.equal(state.currentStep, "edit");
  assert.equal(state.currentSlot, "measurement");
  assert.equal(canEnterEdit(state), true);
});

test("workflow step advances from accepted slots and ignores a premature COMPLETE nextAction", () => {
  const sessionId = "session-step";
  let state = createInitialCaptureState(sessionId);
  assert.equal(state.currentStep, "front");

  const requestId = "front-step";
  state = captureReducer(state, captureActions.submit(sessionId, "front", blob("front"), "blob:front", requestId, 1));
  state = captureReducer(state, captureActions.assessed(sessionId, "front", assessment("front", "COMPLETE"), requestId, 1));
  assert.equal(state.currentSlot, "back");
  assert.equal(state.currentStep, "back");

  state = acceptImage(state, "back", 2);
  assert.equal(state.currentSlot, "tag");
  assert.equal(state.currentStep, "tag");
  state = acceptImage(state, "tag", 3);
  assert.equal(state.currentSlot, "measurement");
  assert.equal(state.currentStep, "measurement-preparation");
});

test("stale session, sequence, and request results are ignored by identity", () => {
  const state = createInitialCaptureState("session-current");
  const submitted = captureReducer(
    state,
    captureActions.submit("session-current", "front", blob("front"), "blob:front", "request-current", 1),
  );

  const staleSession = captureReducer(
    submitted,
    captureActions.assessed("session-old", "front", assessment("front"), "request-current", 1),
  );
  assert.strictEqual(staleSession, submitted);

  const staleRequest = captureReducer(
    submitted,
    captureActions.assessed("session-current", "front", assessment("front"), "request-old", 1),
  );
  assert.strictEqual(staleRequest, submitted);

  const newer = captureReducer(
    submitted,
    captureActions.assessed("session-current", "front", assessment("front"), "request-current", 1),
  );
  const staleSequence = captureReducer(
    newer,
    captureActions.guidance({
      sessionId: "session-current",
      sequence: 1,
      shot: "front",
      code: "READY",
      message: "old",
      confidence: 1,
      observedAt: 10,
      expiresAt: 100,
    }, 20),
  );
  assert.strictEqual(staleSequence, newer);

  const wrongShot = captureReducer(
    newer,
    captureActions.guidance({
      sessionId: "session-current",
      sequence: 2,
      shot: "front",
      code: "READY",
      message: "撮影できます。",
      confidence: 1,
      observedAt: 20,
      expiresAt: 100,
    }, 30),
  );
  assert.strictEqual(wrongShot, newer);
});

test("a retry gets a new request identity and fences the old provider result", () => {
  const sessionId = "session-provider-retry";
  const submitted = captureReducer(
    createInitialCaptureState(sessionId),
    captureActions.submit(sessionId, "front", blob("front"), "blob:front", "request-1", 1),
  );
  const errored = captureReducer(
    submitted,
    captureActions.providerError(sessionId, "request-1", 1, {
      provider: "shot-assessor",
      code: "TIMEOUT",
      message: "timeout",
      retryable: true,
    }),
  );
  assert.equal(errored.phase, "error");
  const retried = captureReducer(errored, captureActions.retry(sessionId, "request-2", 2));
  assert.equal(retried.phase, "analyzing");
  assert.equal(retried.pendingCapture?.requestId, "request-2");

  const sameRequestRetry = captureReducer(errored, captureActions.retry(sessionId, "request-1", 2));
  assert.strictEqual(sameRequestRetry, errored);

  const oldResult = captureReducer(retried, captureActions.assessed(sessionId, "front", assessment("front"), "request-1", 1));
  assert.strictEqual(oldResult, retried);
  const accepted = captureReducer(retried, captureActions.assessed(sessionId, "front", assessment("front"), "request-2", 2));
  assert.equal(accepted.slots.front?.kind, "image");
  assert.equal(accepted.currentSlot, "back");
});

test("retake clears only the requested slot and preserves accepted peers", () => {
  const sessionId = "session-retake";
  let state = createInitialCaptureState(sessionId);
  state = acceptImage(state, "front", 1);
  state = acceptImage(state, "back", 2);
  state = captureReducer(state, captureActions.retake(sessionId, "front"));

  assert.equal(state.currentSlot, "front");
  assert.equal(state.slots.front, null);
  assert.equal(state.slots.back?.kind, "image");
  assert.equal(state.phase, "capturing");
});
