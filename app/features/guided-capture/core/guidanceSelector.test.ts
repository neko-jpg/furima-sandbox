import assert from "node:assert/strict";
import test from "node:test";

import {
  GuidanceHysteresis,
  candidateFromGuidanceEvent,
  createLocalGuidanceCandidate,
  selectPrimaryGuidance,
} from "./guidanceSelector.ts";

const event = (code: "READY" | "SHOW_FULL_GARMENT" | "WRONG_SIDE", sequence: number, expiresAt = 2_000, observedAt = 1_000) => ({
  sessionId: "selector-session",
  sequence,
  shot: "front" as const,
  code,
  message: code === "READY"
    ? "撮影できます。"
    : code === "WRONG_SIDE"
      ? "衣類を裏返して、指定された面を見せてください。"
      : "衣類全体が入るようにカメラを離してください。",
  confidence: 1,
  observedAt,
  expiresAt,
});

test("primary guidance follows process, missing, and stability priority", () => {
  const selected = selectPrimaryGuidance([
    candidateFromGuidanceEvent(event("READY", 1)),
    candidateFromGuidanceEvent(event("SHOW_FULL_GARMENT", 2)),
    candidateFromGuidanceEvent(event("WRONG_SIDE", 3)),
    createLocalGuidanceCandidate({
      shot: "front",
      code: "TOO_DARK",
      observedAt: 1_000,
      expiresAt: 2_000,
    }),
  ], 1_100);

  assert.equal(selected?.code, "WRONG_SIDE");
  assert.equal(selectPrimaryGuidance([
    candidateFromGuidanceEvent(event("READY", 1)),
    createLocalGuidanceCandidate({
      shot: "front",
      code: "TOO_DARK",
      observedAt: 1_000,
      expiresAt: 2_000,
    }),
  ], 1_100)?.code, "TOO_DARK");
  assert.equal(selectPrimaryGuidance([candidateFromGuidanceEvent(event("READY", 1, 1_100))], 1_100), null);
});

test("hysteresis delays entry, delays clear, and emits a short acknowledgement", () => {
  const selector = new GuidanceHysteresis({ enterMs: 200, clearMs: 300, readyMs: 400 });
  const warning = candidateFromGuidanceEvent(event("SHOW_FULL_GARMENT", 1, 5_000, 0));

  assert.equal(selector.update([warning], 1_000, "front").primary, null);
  assert.equal(selector.update([warning], 1_199, "front").primary, null);
  assert.equal(selector.update([warning], 1_200, "front").primary?.code, "SHOW_FULL_GARMENT");

  assert.equal(selector.update([], 1_300, "front").primary?.code, "SHOW_FULL_GARMENT");
  assert.equal(selector.update([], 1_599, "front").primary?.code, "SHOW_FULL_GARMENT");
  const cleared = selector.update([], 1_600, "front");
  assert.equal(cleared.primary, null);
  assert.equal(cleared.acknowledgement, "その調子です。");
});

test("READY requires a stable clear window and stale candidates never resurrect it", () => {
  const selector = new GuidanceHysteresis({ enterMs: 100, clearMs: 200, readyMs: 300 });
  const warning = candidateFromGuidanceEvent(event("SHOW_FULL_GARMENT", 1, 5_000, 0));
  assert.equal(selector.update([warning], 0, "back").primary, null);
  assert.equal(selector.update([warning], 100, "back").primary?.code, "SHOW_FULL_GARMENT");
  assert.equal(selector.update([], 300, "back").primary?.code, "SHOW_FULL_GARMENT");
  assert.equal(selector.update([], 499, "back").primary?.code, "SHOW_FULL_GARMENT");
  assert.equal(selector.update([], 500, "back").primary, null);
  assert.equal(selector.update([], 799, "back").primary, null);
  assert.equal(selector.update([], 800, "back").primary?.code, "READY");
  assert.equal(selector.snapshot.active?.shot, "back");

  const expiredReady = selectPrimaryGuidance([
    candidateFromGuidanceEvent(event("READY", 2, 600, 0)),
  ], 600);
  assert.equal(expiredReady, null);
});
