import {
  IMAGE_SLOTS,
  SESSION_SLOTS,
  type ApprovedMeasurement,
  type CaptureAction,
  type CapturePhase,
  type CaptureReducer,
  type CaptureSlotRecord,
  type CaptureSlots,
  type CaptureState,
  type GuidanceEvent,
  type ImageSlot,
  type MeasurementDraft,
  type PendingCapture,
  type ProviderError,
  type SessionSlot,
  type ShotAssessment,
} from "./types.ts";

export const CAPTURE_ORDER = SESSION_SLOTS;

function emptySlots(): CaptureSlots {
  return {
    front: null,
    back: null,
    tag: null,
    measurement: null,
  };
}

export function createInitialCaptureState(sessionId: string): CaptureState {
  if (sessionId.trim() === "") {
    throw new TypeError("sessionId must not be empty");
  }

  return {
    sessionId,
    phase: "capturing",
    currentSlot: "front",
    slots: emptySlots(),
    pendingCapture: null,
    lastAssessment: null,
    measurementDraft: null,
    approvedMeasurement: null,
    latestGuidance: null,
    connectionState: "disconnected",
    lastSequence: 0,
    providerError: null,
  };
}

export function createCaptureRequestId(prefix = "capture"): string {
  if (prefix.trim() === "") {
    throw new TypeError("request id prefix must not be empty");
  }

  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

export function isImageSlot(slot: SessionSlot): slot is ImageSlot {
  return (IMAGE_SLOTS as readonly string[]).includes(slot);
}

function hasAcceptedImage(slots: CaptureSlots, slot: ImageSlot): boolean {
  const value = slots[slot];
  return value?.kind === "image" && value.status === "captured";
}

export function hasAllImages(slots: CaptureSlots): boolean {
  return IMAGE_SLOTS.every((slot) => hasAcceptedImage(slots, slot));
}

export function hasApprovedMeasurement(slots: CaptureSlots): boolean {
  return slots.measurement?.kind === "measurement" && slots.measurement.status === "approved";
}

export function canEnterEdit(state: CaptureState): boolean {
  return hasAllImages(state.slots) && hasApprovedMeasurement(state.slots);
}

export function nextPendingSlot(slots: CaptureSlots): SessionSlot | "edit" {
  for (const slot of IMAGE_SLOTS) {
    if (!hasAcceptedImage(slots, slot)) {
      return slot;
    }
  }

  if (!hasApprovedMeasurement(slots)) {
    return "measurement";
  }

  return "edit";
}

function isValidSequence(sequence: number): boolean {
  return Number.isInteger(sequence) && sequence >= 0;
}

function acceptsNewSequence(state: CaptureState, sequence: number): boolean {
  return isValidSequence(sequence) && sequence > state.lastSequence;
}

function acceptsResponseSequence(
  state: CaptureState,
  pending: PendingCapture,
  sequence: number,
): boolean {
  // A response may use the request's sequence, or a later sequence assigned by
  // the transport.  It can never move backwards from a newer accepted event.
  return (
    isValidSequence(sequence) &&
    sequence >= pending.sequence &&
    sequence >= state.lastSequence
  );
}

function sameSession(state: CaptureState, sessionId: string): boolean {
  return state.sessionId === sessionId;
}

function replaceSlot(
  slots: CaptureSlots,
  slot: SessionSlot,
  value: CaptureSlotRecord,
): CaptureSlots {
  return { ...slots, [slot]: value };
}

function nextPhaseForSlots(slots: CaptureSlots): {
  readonly currentSlot: SessionSlot;
  readonly phase: CapturePhase;
} {
  const next = nextPendingSlot(slots);
  if (next === "edit") {
    return { currentSlot: "measurement", phase: "ready" };
  }
  return {
    currentSlot: next,
    phase: next === "measurement" ? "measurement" : "capturing",
  };
}

function acceptedAssessment(
  assessment: ShotAssessment,
  slot: ImageSlot,
): boolean {
  return assessment.quality === "ok" && assessment.shotType === slot;
}

function isMeasurementDraft(value: MeasurementDraft): boolean {
  return (
    value.status === "needs_review" &&
    value.imageId.trim() !== "" &&
    Number.isFinite(value.lengthCm) &&
    value.lengthCm > 0 &&
    Number.isFinite(value.widthCm) &&
    value.widthCm > 0 &&
    (value.confidence === undefined || (
      Number.isFinite(value.confidence) &&
      value.confidence >= 0 &&
      value.confidence <= 1
    ))
  );
}

function isApprovedMeasurement(value: ApprovedMeasurement): boolean {
  return (
    Number.isFinite(value.lengthCm) &&
    value.lengthCm > 0 &&
    Number.isFinite(value.widthCm) &&
    value.widthCm > 0 &&
    (value.source === "approved_cv" || value.source === "approved_manual")
  );
}

function shouldAcceptGuidance(
  state: CaptureState,
  event: GuidanceEvent,
  now: number,
): boolean {
  return (
    sameSession(state, event.sessionId) &&
    Number.isInteger(event.sequence) &&
    event.sequence > state.lastSequence &&
    Number.isFinite(event.observedAt) &&
    Number.isFinite(event.expiresAt) &&
    event.expiresAt > event.observedAt &&
    now < event.expiresAt
  );
}

/**
 * Pure state machine for one ephemeral guided-capture session.
 *
 * All async/provider actions carry session, sequence, and request identity.
 * Invalid or stale actions return the exact same state object, which makes
 * rejection cheap and prevents late responses from overwriting a retake.
 */
export const captureReducer: CaptureReducer = (state, action) => {
  switch (action.type) {
    case "RESET":
      return createInitialCaptureState(action.sessionId);

    case "CONNECTION_CHANGED":
      if (!sameSession(state, action.sessionId)) {
        return state;
      }
      return { ...state, connectionState: action.connectionState };

    case "CAPTURE_SUBMITTED": {
      if (
        !sameSession(state, action.sessionId) ||
        state.pendingCapture !== null ||
        state.currentSlot !== action.slot ||
        (action.slot === "measurement"
          ? state.phase !== "measurement"
          : state.phase !== "capturing") ||
        !acceptsNewSequence(state, action.sequence) ||
        action.requestId.trim() === ""
      ) {
        return state;
      }

      const pending: PendingCapture = isImageSlot(action.slot)
        ? {
            kind: "image",
            sessionId: action.sessionId,
            slot: action.slot,
            blob: action.blob,
            objectUrl: action.objectUrl,
            requestId: action.requestId,
            sequence: action.sequence,
          }
        : {
            kind: "measurement",
            sessionId: action.sessionId,
            slot: "measurement",
            blob: action.blob,
            objectUrl: action.objectUrl,
            requestId: action.requestId,
            sequence: action.sequence,
          };

      return {
        ...state,
        phase: "analyzing",
        pendingCapture: pending,
        lastAssessment: null,
        providerError: null,
        lastSequence: action.sequence,
      };
    }

    case "SHOT_ASSESSED": {
      const pending = state.pendingCapture;
      if (
        !sameSession(state, action.sessionId) ||
        pending === null ||
        pending.kind !== "image" ||
        pending.slot !== action.slot ||
        pending.requestId !== action.requestId ||
        !acceptsResponseSequence(state, pending, action.sequence)
      ) {
        return state;
      }

      if (!acceptedAssessment(action.assessment, action.slot)) {
        return {
          ...state,
          phase: "capturing",
          pendingCapture: null,
          lastAssessment: action.assessment,
          providerError: null,
          lastSequence: Math.max(state.lastSequence, action.sequence),
        };
      }

      const accepted: CaptureSlotRecord = {
        kind: "image",
        slot: action.slot,
        blob: pending.blob,
        objectUrl: pending.objectUrl,
        assessment: action.assessment,
        status: "captured",
        acceptedSequence: action.sequence,
      };
      const slots = replaceSlot(state.slots, action.slot, accepted);
      const next = nextPhaseForSlots(slots);

      return {
        ...state,
        ...next,
        pendingCapture: null,
        slots,
        lastAssessment: action.assessment,
        providerError: null,
        lastSequence: Math.max(state.lastSequence, action.sequence),
      };
    }

    case "MEASUREMENT_DRAFTED": {
      const pending = state.pendingCapture;
      if (
        !sameSession(state, action.sessionId) ||
        pending === null ||
        pending.kind !== "measurement" ||
        pending.requestId !== action.requestId ||
        !isMeasurementDraft(action.draft) ||
        !acceptsResponseSequence(state, pending, action.sequence)
      ) {
        return state;
      }

      const measurement: MeasurementSlot = {
        kind: "measurement",
        slot: "measurement",
        blob: pending.blob,
        objectUrl: pending.objectUrl,
        draft: action.draft,
        status: "captured",
        acceptedSequence: action.sequence,
      };

      return {
        ...state,
        phase: "measurement",
        currentSlot: "measurement",
        pendingCapture: null,
        slots: replaceSlot(state.slots, "measurement", measurement),
        measurementDraft: action.draft,
        approvedMeasurement: null,
        providerError: null,
        lastSequence: Math.max(state.lastSequence, action.sequence),
      };
    }

    case "PROVIDER_ERROR": {
      const pending = state.pendingCapture;
      if (
        !sameSession(state, action.sessionId) ||
        pending === null ||
        pending.requestId !== action.requestId ||
        !acceptsResponseSequence(state, pending, action.sequence)
      ) {
        return state;
      }

      return {
        ...state,
        phase: "error",
        providerError: action.error,
        lastSequence: Math.max(state.lastSequence, action.sequence),
      };
    }

    case "RETRY_ANALYSIS": {
      const pending = state.pendingCapture;
      if (
        !sameSession(state, action.sessionId) ||
        state.phase !== "error" ||
        pending === null ||
        !state.providerError ||
        !acceptsNewSequence(state, action.sequence) ||
        action.requestId.trim() === ""
      ) {
        return state;
      }

      return {
        ...state,
        phase: "analyzing",
        pendingCapture: { ...pending, requestId: action.requestId, sequence: action.sequence },
        providerError: null,
        lastSequence: action.sequence,
      };
    }

    case "MEASUREMENT_APPROVED": {
      if (
        !sameSession(state, action.sessionId) ||
        state.phase !== "measurement" ||
        !hasAllImages(state.slots) ||
        state.measurementDraft === null ||
        !isApprovedMeasurement(action.measurement) ||
        !acceptsNewSequence(state, action.sequence)
      ) {
        return state;
      }

      const measurementSlot = state.slots.measurement;
      if (measurementSlot?.kind !== "measurement") {
        return state;
      }

      const approvedSlot: CaptureSlotRecord = {
        ...measurementSlot,
        status: "approved",
        acceptedSequence: action.sequence,
      };

      return {
        ...state,
        phase: "ready",
        currentSlot: "measurement",
        slots: replaceSlot(state.slots, "measurement", approvedSlot),
        approvedMeasurement: action.measurement,
        providerError: null,
        lastSequence: action.sequence,
      };
    }

    case "GUIDANCE_RECEIVED":
      if (!shouldAcceptGuidance(state, action.event, action.now)) {
        return state;
      }
      return {
        ...state,
        latestGuidance: action.event,
        lastSequence: action.event.sequence,
      };

    case "RETAKE": {
      if (!sameSession(state, action.sessionId)) {
        return state;
      }

      if (action.slot === "measurement") {
        return {
          ...state,
          phase: "measurement",
          currentSlot: "measurement",
          pendingCapture: null,
          slots: replaceSlot(state.slots, "measurement", null),
          measurementDraft: null,
          approvedMeasurement: null,
          providerError: null,
        };
      }

      return {
        ...state,
        phase: "capturing",
        currentSlot: action.slot,
        pendingCapture: null,
        slots: replaceSlot(state.slots, action.slot, null),
        measurementDraft: null,
        approvedMeasurement: null,
        providerError: null,
      };
    }

    case "EDIT_REQUESTED":
      if (!sameSession(state, action.sessionId) || !canEnterEdit(state)) {
        return state;
      }
      return { ...state, phase: "ready", providerError: null };

    default:
      return state;
  }
};

export const captureActions = {
  reset: (sessionId: string): CaptureAction => ({ type: "RESET", sessionId }),
  connectionChanged: (
    sessionId: string,
    connectionState: CaptureState["connectionState"],
  ): CaptureAction => ({ type: "CONNECTION_CHANGED", sessionId, connectionState }),
  submit: (
    sessionId: string,
    slot: SessionSlot,
    blob: Blob,
    objectUrl: string,
    requestId: string,
    sequence: number,
  ): CaptureAction => ({
    type: "CAPTURE_SUBMITTED",
    sessionId,
    slot,
    blob,
    objectUrl,
    requestId,
    sequence,
  }),
  assessed: (
    sessionId: string,
    slot: ImageSlot,
    assessment: ShotAssessment,
    requestId: string,
    sequence: number,
  ): CaptureAction => ({
    type: "SHOT_ASSESSED",
    sessionId,
    slot,
    assessment,
    requestId,
    sequence,
  }),
  measurementDrafted: (
    sessionId: string,
    draft: MeasurementDraft,
    requestId: string,
    sequence: number,
  ): CaptureAction => ({
    type: "MEASUREMENT_DRAFTED",
    sessionId,
    draft,
    requestId,
    sequence,
  }),
  providerError: (
    sessionId: string,
    requestId: string,
    sequence: number,
    error: ProviderError,
  ): CaptureAction => ({ type: "PROVIDER_ERROR", sessionId, requestId, sequence, error }),
  retry: (
    sessionId: string,
    requestId: string,
    sequence: number,
  ): CaptureAction => ({ type: "RETRY_ANALYSIS", sessionId, requestId, sequence }),
  approveMeasurement: (
    sessionId: string,
    measurement: ApprovedMeasurement,
    sequence: number,
  ): CaptureAction => ({ type: "MEASUREMENT_APPROVED", sessionId, measurement, sequence }),
  guidance: (event: GuidanceEvent, now: number): CaptureAction => ({
    type: "GUIDANCE_RECEIVED",
    event,
    now,
  }),
  retake: (sessionId: string, slot: SessionSlot): CaptureAction => ({
    type: "RETAKE",
    sessionId,
    slot,
  }),
  requestEdit: (sessionId: string): CaptureAction => ({ type: "EDIT_REQUESTED", sessionId }),
};

type MeasurementSlot = NonNullable<CaptureSlots["measurement"]> & {
  readonly kind: "measurement";
};
