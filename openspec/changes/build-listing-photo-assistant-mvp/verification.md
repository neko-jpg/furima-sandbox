# Verification map

This map is the implementation and verification index for
`build-listing-photo-assistant-mvp`. Every Requirement and Scenario in the
change specs appears exactly once below. `automated` means the deterministic
test named in the evidence column passed locally. `manual-gate` means the
code path and fallback are implemented, but the evidence still requires a
physical iPhone/Safari, an external LiveKit room, a real provider, a printed
50 mm marker, or an operator-controlled failure injection.

## Guided garment capture

| Requirement / Scenario | Status | Evidence | Remaining gate |
| --- | --- | --- | --- |
| GGC-1 session start / front accepted / tag accepted | automated | `app/features/guided-capture/core/captureReducer.test.ts`; `tests/e2e/listing-photo-assistant-fixture.spec.mjs` | none for fixture state flow |
| GGC-2 ready / dark / movement | automated | `app/features/guided-capture/core/imageQuality.test.ts`; `app/features/guided-capture/core/frameDifference.test.ts`; `app/features/guided-capture/core/guidanceSelector.test.ts` | live camera latency still needs device measurement |
| GGC-2 garment out of frame / wrong side | automated | `app/features/guided-capture/core/guidanceSelector.test.ts`; `app/features/guided-capture/ui/GuidedCaptureCamera.tsx` | real vision provider requires live LLM |
| GGC-3 new pushed guidance | automated | `app/features/guided-capture/adapters/liveKitAdapter.test.ts`; `services/listing_photo_assistant/tests/test_guidance_transport.py` | external room participant check |
| GGC-3 stale, wrong-session, expired guidance | automated | `app/features/guided-capture/adapters/liveKitAdapter.test.ts`; `app/features/guided-capture/core/guidanceSelector.test.ts` | none for contract filtering |
| GGC-4 preview resize / object-fit ROI | automated | `app/features/guided-capture/core/pixelRoi.test.ts` | real browser rotation check |
| GGC-4 frame burst backpressure | automated | `app/features/guided-capture/core/scheduler.test.ts` | none for bounded scheduler |
| GGC-5 manual capture before READY | manual-gate | `app/features/guided-capture/ui/GuidedCaptureCamera.tsx`; `docs/runbooks/listing-photo-assistant.md` | real camera shutter and raw Blob check |
| GGC-5 manual measurement capture | automated | `tests/e2e/listing-photo-assistant-fixture.spec.mjs`; `app/features/guided-capture/ui/GuidedCapturePanel.tsx` | iPhone camera check |
| GGC-6 valid front assessment | automated | `services/listing_photo_assistant/tests/test_shot_assessor_contract.py`; `services/listing_photo_assistant/tests/test_api.py` | real LLM response |
| GGC-6 retry assessment / READY mismatch | automated | `tests/e2e/listing-photo-assistant-fixture.spec.mjs`; `app/features/guided-capture/core/captureReducer.test.ts` | none for fixture retry |
| GGC-7 measurement preparation | automated | `app/features/guided-capture/ui/GuidedCapturePanel.tsx`; `tests/e2e/listing-photo-assistant-fixture.spec.mjs` | target-category visual check |
| GGC-7 measurement raw capture | automated | `tests/e2e/listing-photo-assistant-fixture.spec.mjs` | physical marker and camera check |
| GGC-8 valid marker, homography, scale | automated | `app/features/guided-capture/measurement/markerDetector.test.ts`; `app/features/guided-capture/measurement/perspective.test.ts`; `app/features/guided-capture/measurement/markerWorker.test.ts`; fixture E2E OpenCV Worker smoke | printed 50 mm measurement |
| GGC-8 missing / multiple / small / occluded marker | automated | `app/features/guided-capture/measurement/markerDetector.test.ts` | UI injection on a device |
| GGC-9 four endpoint provider response | automated | `app/features/guided-capture/ui/httpAdapter.test.ts`; `services/listing_photo_assistant/tests/test_measurement.py`; fixture E2E | real LLM endpoint response |
| GGC-9 endpoint provider timeout / schema failure | automated | `services/listing_photo_assistant/tests/test_api.py`; `services/listing_photo_assistant/tests/test_measurement.py` | UI browser injection |
| GGC-10 endpoint edit and CV approval | automated | `app/features/guided-capture/measurement/calculation.test.ts`; `app/features/guided-capture/core/captureReducer.test.ts`; fixture E2E | representative-shirt accuracy record |
| GGC-10 manual input approval and unapproved gate | automated | `app/features/guided-capture/core/captureReducer.test.ts`; fixture E2E | none for deterministic gate |
| GGC-11 back-only retake | automated | `app/features/guided-capture/core/captureReducer.test.ts`; fixture E2E retry flow | none for fixture state flow |
| GGC-11 required photos complete | automated | `app/features/guided-capture/core/captureReducer.test.ts`; fixture E2E | none for fixture state flow |
| GGC-11 four-slot approval complete | automated | `app/features/guided-capture/core/captureReducer.test.ts`; fixture E2E | none for fixture state flow |
| GGC-12 Agent disconnect / reconnect | automated | `app/features/guided-capture/adapters/liveKitAdapter.test.ts`; `app/features/guided-capture/ui/useGuidedCaptureController.ts` | external LiveKit room |
| GGC-12 local analyzer unavailable | automated | `app/features/guided-capture/measurement/markerDetector.test.ts`; `app/features/guided-capture/core/cameraController.test.ts` | browser API fault injection |
| GGC-12 camera permission denied | automated | `app/features/guided-capture/core/cameraController.test.ts`; `app/features/guided-capture/ui/GuidedCapturePanel.tsx` | iPhone permission prompt |
| GGC-12 image assessment error / timeout | automated | `app/features/guided-capture/core/captureReducer.test.ts`; `services/listing_photo_assistant/tests/test_api.py`; fixture retry path | browser timeout injection |

## Background-preserving edit

| Requirement / Scenario | Status | Evidence | Remaining gate |
| --- | --- | --- | --- |
| BPE-1 all four slots and measurement approval required | automated | `app/features/background-edit/backgroundEditReducer.test.ts`; `tests/e2e/listing-photo-assistant-fixture.spec.mjs` | none for fixture gate |
| BPE-1 incomplete capture stays blocked | automated | `app/features/background-edit/backgroundEditReducer.test.ts`; `app/features/guided-capture/core/captureReducer.test.ts` | none for contract gate |
| BPE-2 text-only background request | automated | `app/features/background-edit/provider.test.ts`; `services/listing_photo_assistant/tests/test_background.py`; fixture E2E request spy | real image provider |
| BPE-2 background failure recovery | automated | `app/features/background-edit/provider.test.ts`; `services/listing_photo_assistant/tests/test_background.py` | UI live failure injection |
| BPE-3 original RGB preserved by mask composite | automated | `app/features/background-edit/canvasComposite.test.ts`; `app/features/background-edit/maskValidation.test.ts` | none for pixel contract |
| BPE-3 invalid mask blocks approval | automated | `app/features/background-edit/maskValidation.test.ts`; `services/listing_photo_assistant/tests/test_mask.py` | UI live failure injection |
| BPE-4 composite selection and approval | automated | `app/features/background-edit/backgroundEditReducer.test.ts`; fixture E2E | visual review on target device |
| BPE-4 original selection and approval | automated | `app/features/background-edit/backgroundEditReducer.test.ts`; `app/features/background-edit/approvedImage.test.ts` | none for reducer contract |
| BPE-5 approved image only is saved | automated | `app/features/background-edit/approvedImage.test.ts`; fixture E2E saved Blob/hash evidence | none for fixture persistence boundary |
| BPE-6 source retained after mask/generation/composite failure | automated | `app/features/background-edit/backgroundEditReducer.test.ts`; `app/features/background-edit/provider.test.ts` | UI live failure injection |

## 8.1–8.8 evidence

| Task | Status | Evidence | Boundary |
| --- | --- | --- | --- |
| 8.1 deterministic two-run vertical slice | automated | `npm run qa:listing-photo-assistant`; `tests/e2e/listing-photo-assistant-fixture.spec.mjs` | fixture transport is not external LiveKit |
| 8.2 representative shirt + iPhone + live provider | manual-gate | `docs/runbooks/listing-photo-assistant.md` live checklist | requires real LLM, LiveKit credentials, iPhone, and measured shirt |
| 8.3 failure/recovery matrix | automated-partial | marker, provider, reducer, background tests; fixture retry/hash flow | LiveKit/device lifecycle and every operator injection remain manual |
| 8.4 responsive iPhone/Safari visual QA | manual-gate | `app/features/guided-capture/ui/GuidedCaptureCamera.tsx`; `app/globals.css`; `docs/runbooks/listing-photo-assistant.md` | requires physical Safari, VoiceOver, Dynamic Type, and reduced-motion check |
| 8.5 cleanup and persistence boundary | automated-partial | fixture E2E localStorage/IndexedDB/hash evidence; camera/LiveKit cleanup unit tests | physical track/Room/Worker/object-URL observation remains manual |
| 8.6 runnable provider/runbook preparation | automated-partial | `scripts/run-listing-photo-assistant-fixture-e2e.mjs`; `docs/runbooks/listing-photo-assistant.md`; OpenCV Worker smoke | live Agent/rembg prewarm and printed marker remain manual |
| 8.7 lockfile and full QA | automated-partial | final command record in this file and runbook; `npm run e2e:pr`; `npm run e2e` | clean-install and device console gate are separate manual release checks |
| 8.8 traceability and OpenSpec validation | automated | this map; `docs/qa/test-matrix.yaml`; `npm run qa:matrix`; OpenSpec strict validation | none for repository traceability |

## External gates that are intentionally not represented as fixture success

The repository is ready to accept real provider credentials through server-only
environment variables. The following are not falsely marked as passed by the
fixture suite: an external LiveKit participant/track observation, real LLM
semantic guidance and measurement points, rembg/BiRefNet model download and
prewarm, a physical 50 mm print measured with a ruler, representative-shirt
±1.0 cm accuracy, and iPhone Safari/VoiceOver lifecycle QA. The copyable
commands and expected observations are in
`docs/runbooks/listing-photo-assistant.md`.

## Final repository command record

The repository checks below were executed locally on 2026-09-01 after a clean
`npm ci` with Node 22.13.0 and npm 10.9.2. No image bytes, tokens, or provider
secrets were written to the record.

| Area | Result |
| --- | --- |
| Shared runtime / install | `npm run check:shared`, `npm ci`, `npm audit --omit=dev` passed; 0 production vulnerabilities |
| Unit / component / reducer | `npm test` passed: 2 rendered, 50 guided, 126 unit tests |
| Backend fixture | `npm run test:backend:fixture` passed: 118 tests |
| Type / lint / build | `npm run typecheck`, `npm run lint`, `npm run build` passed |
| Browser / fixture | `npm run e2e` passed: 44, skipped: 4; `npm run e2e:pr` passed: 29, skipped: 3; dedicated assistant fixture passed twice |
| Security / contract | `npm run qa:static`, `npm run security:mcp`, `npm run security:audit`, `npm run security:schemathesis`, and `npm run framework:check` passed |
| Docs / traceability | `docs:check`, `qa:matrix`, `docs:validate-public`, `docs:wiki:check`, OpenSpec strict validation passed |
| Runtime / asset checks | `npm run audit:opencv`, `npm run assets:audit`, `docker compose config --quiet` passed |
