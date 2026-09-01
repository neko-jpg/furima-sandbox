import {
  GUIDANCE_CODES,
  SESSION_SLOTS,
  type GuidanceCode,
  type GuidanceEvent,
  type SessionSlot,
} from "./types.ts";

/** Codes produced by the device-side quality/stability checks. */
export const LOCAL_GUIDANCE_CODES = [
  "TOO_DARK",
  "TOO_BRIGHT",
  "TOO_BLURRY",
  "HOLD_STEADY",
] as const;
export type LocalGuidanceCode = (typeof LOCAL_GUIDANCE_CODES)[number];
export type GuidanceCandidateCode = GuidanceCode | LocalGuidanceCode;
export type GuidanceCandidateSource = "agent" | "device";

export interface GuidanceCandidate {
  readonly shot: SessionSlot;
  readonly code: GuidanceCandidateCode;
  readonly message: string;
  readonly source: GuidanceCandidateSource;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly sequence?: number;
  readonly event?: GuidanceEvent;
}

export const GUIDANCE_PRIORITY_GROUPS = {
  process: 5,
  missing: 4,
  composition: 3,
  angleOrWrinkles: 2,
  quality: 1,
  stability: 0,
} as const;

const CODE_PRIORITY: Readonly<Record<GuidanceCandidateCode, number>> = {
  WRONG_SIDE: GUIDANCE_PRIORITY_GROUPS.process,
  AGENT_UNAVAILABLE: GUIDANCE_PRIORITY_GROUPS.process,
  MOVE_TO_TAG: GUIDANCE_PRIORITY_GROUPS.missing,
  SHOW_FULL_GARMENT: GUIDANCE_PRIORITY_GROUPS.missing,
  PLACE_MARKER: GUIDANCE_PRIORITY_GROUPS.missing,
  MARKER_NOT_VISIBLE: GUIDANCE_PRIORITY_GROUPS.missing,
  MOVE_CLOSER: GUIDANCE_PRIORITY_GROUPS.composition,
  MOVE_FARTHER: GUIDANCE_PRIORITY_GROUPS.composition,
  CENTER_GARMENT: GUIDANCE_PRIORITY_GROUPS.composition,
  CAMERA_OVERHEAD: GUIDANCE_PRIORITY_GROUPS.angleOrWrinkles,
  FLATTEN_GARMENT: GUIDANCE_PRIORITY_GROUPS.angleOrWrinkles,
  TOO_DARK: GUIDANCE_PRIORITY_GROUPS.quality,
  TOO_BRIGHT: GUIDANCE_PRIORITY_GROUPS.quality,
  TOO_BLURRY: GUIDANCE_PRIORITY_GROUPS.quality,
  HOLD_STEADY: GUIDANCE_PRIORITY_GROUPS.stability,
  READY: -1,
};

const DEVICE_MESSAGES: Readonly<Record<LocalGuidanceCode, string>> = {
  TOO_DARK: "もう少し明るい場所で撮影してください。",
  TOO_BRIGHT: "反射が少ない場所へ移動してください。",
  TOO_BLURRY: "ピントが合うまで、カメラをゆっくり止めてください。",
  HOLD_STEADY: "カメラを動かさず、そのまま保ってください。",
};

const isSessionSlot = (value: unknown): value is SessionSlot => (
  typeof value === "string" && (SESSION_SLOTS as readonly string[]).includes(value)
);

const isGuidanceCode = (value: unknown): value is GuidanceCode => (
  typeof value === "string" && (GUIDANCE_CODES as readonly string[]).includes(value)
);

const isLocalGuidanceCode = (value: unknown): value is LocalGuidanceCode => (
  typeof value === "string" && (LOCAL_GUIDANCE_CODES as readonly string[]).includes(value)
);

const isCandidateCode = (value: unknown): value is GuidanceCandidateCode => (
  isGuidanceCode(value) || isLocalGuidanceCode(value)
);

const candidateKey = (candidate: GuidanceCandidate): string => (
  `${candidate.source}:${candidate.shot}:${candidate.code}`
);

const sameCandidate = (
  left: GuidanceCandidate | null,
  right: GuidanceCandidate | null,
): boolean => (
  (left === null && right === null)
  || (left !== null && right !== null && candidateKey(left) === candidateKey(right))
);

function isFreshCandidate(candidate: GuidanceCandidate, now: number): boolean {
  return (
    isSessionSlot(candidate.shot) &&
    isCandidateCode(candidate.code) &&
    typeof candidate.message === "string" &&
    candidate.message.trim() !== "" &&
    Number.isFinite(candidate.observedAt) &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > candidate.observedAt &&
    now < candidate.expiresAt &&
    (candidate.sequence === undefined || (
      Number.isSafeInteger(candidate.sequence) && candidate.sequence > 0
    ))
  );
}

/** Converts a validated server event into a selector candidate. */
export function candidateFromGuidanceEvent(event: GuidanceEvent): GuidanceCandidate {
  return {
    shot: event.shot,
    code: event.code,
    message: event.message,
    source: "agent",
    observedAt: event.observedAt,
    expiresAt: event.expiresAt,
    sequence: event.sequence,
    event,
  };
}

/** Creates a finite, app-owned candidate for local quality checks. */
export function createLocalGuidanceCandidate(input: {
  readonly shot: SessionSlot;
  readonly code: LocalGuidanceCode;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly message?: string;
}): GuidanceCandidate {
  return {
    shot: input.shot,
    code: input.code,
    message: input.message ?? DEVICE_MESSAGES[input.code],
    source: "device",
    observedAt: input.observedAt,
    expiresAt: input.expiresAt,
  };
}

/**
 * Selects exactly one primary instruction.  A READY event is considered only
 * when no blocking candidate is fresh, so an old READY cannot hide a newer
 * device or Agent warning.
 */
export function selectPrimaryGuidance(
  candidates: readonly GuidanceCandidate[],
  now: number,
): GuidanceCandidate | null {
  if (!Number.isFinite(now) || now < 0) {
    return null;
  }
  const fresh = candidates.filter((candidate) => isFreshCandidate(candidate, now));
  const blockers = fresh.filter((candidate) => candidate.code !== "READY");
  const eligible = blockers.length > 0
    ? blockers
    : fresh.filter((candidate) => candidate.code === "READY");
  return [...eligible].sort((left, right) => {
    const priority = CODE_PRIORITY[right.code] - CODE_PRIORITY[left.code];
    if (priority !== 0) return priority;
    // Device checks are more immediate when both sources report the same
    // category.  Sequence/observedAt then make the result deterministic.
    const source = (right.source === "device" ? 1 : 0) - (left.source === "device" ? 1 : 0);
    if (source !== 0) return source;
    const sequence = (right.sequence ?? 0) - (left.sequence ?? 0);
    if (sequence !== 0) return sequence;
    return right.observedAt - left.observedAt;
  })[0] ?? null;
}

export interface GuidanceHysteresisOptions {
  /** Minimum time a new blocker must remain present before it enters. */
  readonly enterMs?: number;
  /** Minimum time without a blocker before the current instruction clears. */
  readonly clearMs?: number;
  /** Minimum stable time before READY is exposed. */
  readonly readyMs?: number;
  /** How long the short positive acknowledgement remains visible. */
  readonly acknowledgementMs?: number;
}

export interface GuidanceHysteresisSnapshot {
  readonly active: GuidanceCandidate | null;
  readonly pending: GuidanceCandidate | null;
  readonly pendingSince: number | null;
  readonly clearSince: number | null;
  readonly readySince: number | null;
  readonly acknowledgementUntil: number | null;
}

export interface GuidanceHysteresisResult {
  readonly primary: GuidanceCandidate | null;
  readonly acknowledgement: string | null;
  readonly ready: boolean;
  readonly changed: boolean;
}

function duration(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return resolved;
}

/**
 * Time-based enter/clear hysteresis for live guidance.  It is intentionally
 * clock-driven rather than timer-driven, which keeps browser and fake-clock
 * behaviour identical and lets the UI schedule the next wake-up cheaply.
 */
export class GuidanceHysteresis {
  private readonly enterMs: number;
  private readonly clearMs: number;
  private readonly readyMs: number;
  private readonly acknowledgementMs: number;
  private active: GuidanceCandidate | null = null;
  private pending: GuidanceCandidate | null = null;
  private pendingSince: number | null = null;
  private clearSince: number | null = null;
  private readySince: number | null = null;
  private acknowledgementUntil: number | null = null;
  private lastShot: SessionSlot = "front";

  public constructor(options: GuidanceHysteresisOptions = {}) {
    this.enterMs = duration(options.enterMs, 250, "enterMs");
    this.clearMs = duration(options.clearMs, 500, "clearMs");
    this.readyMs = duration(options.readyMs, 600, "readyMs");
    this.acknowledgementMs = duration(options.acknowledgementMs, 1_200, "acknowledgementMs");
  }

  public get snapshot(): GuidanceHysteresisSnapshot {
    return {
      active: this.active,
      pending: this.pending,
      pendingSince: this.pendingSince,
      clearSince: this.clearSince,
      readySince: this.readySince,
      acknowledgementUntil: this.acknowledgementUntil,
    };
  }

  public get nextWakeAt(): number | null {
    if (this.pendingSince !== null) {
      return this.pendingSince + (this.pending?.code === "READY" ? this.readyMs : this.enterMs);
    }
    if (this.clearSince !== null) return this.clearSince + this.clearMs;
    if (this.readySince !== null) return this.readySince + this.readyMs;
    if (this.active !== null && Number.isFinite(this.active.expiresAt)) return this.active.expiresAt;
    return null;
  }

  public reset(): void {
    this.active = null;
    this.pending = null;
    this.pendingSince = null;
    this.clearSince = null;
    this.readySince = null;
    this.acknowledgementUntil = null;
    this.lastShot = "front";
  }

  public update(
    candidates: readonly GuidanceCandidate[],
    now: number,
    shot?: SessionSlot,
  ): GuidanceHysteresisResult {
    if (!Number.isFinite(now) || now < 0) {
      throw new RangeError("now must be a finite non-negative number");
    }
    const selected = selectPrimaryGuidance(candidates, now);
    this.lastShot = shot ?? selected?.shot ?? this.active?.shot ?? this.lastShot;
    if (this.active !== null && !isFreshCandidate(this.active, now)) {
      this.active = null;
      this.clearSince = null;
    }
    const previous = this.active;
    let acknowledgement: string | null = null;

    if (selected !== null && selected.code !== "READY") {
      this.acknowledgementUntil = null;
      this.clearSince = null;
      this.readySince = null;
      if (sameCandidate(this.active, selected)) {
        this.active = selected;
        this.pending = null;
        this.pendingSince = null;
      } else if (sameCandidate(this.pending, selected) && this.pendingSince !== null) {
        if (now - this.pendingSince >= this.enterMs) {
          this.active = selected;
          this.pending = null;
          this.pendingSince = null;
        }
      } else {
        this.pending = selected;
        this.pendingSince = now;
        if (this.active !== null && !isFreshCandidate(this.active, now)) {
          this.active = null;
        }
      }
    } else if (selected !== null && selected.code === "READY") {
      if (this.active !== null && this.active.code !== "READY") {
        acknowledgement = this.clearActive(now);
      } else {
        this.clearSince = null;
        this.pending = null;
        this.pendingSince = null;
        if (this.readySince === null) this.readySince = now;
        if (now - this.readySince >= this.readyMs) {
          this.active = selected;
          this.readySince = null;
        }
      }
    } else {
      if (this.active !== null) {
        acknowledgement = this.clearActive(now);
      } else {
        this.pending = null;
        this.pendingSince = null;
        if (this.readySince === null) this.readySince = now;
        if (now - this.readySince >= this.readyMs) {
          this.active = {
            shot: this.lastShot,
            code: "READY",
            message: "撮影できます。",
            source: "device",
            observedAt: now,
            expiresAt: now + Math.max(this.readyMs, 1_000),
          };
          this.readySince = null;
        }
      }
    }

    if (this.acknowledgementUntil !== null) {
      if (now < this.acknowledgementUntil && acknowledgement === null) {
        acknowledgement = "その調子です。";
      } else if (now >= this.acknowledgementUntil) {
        this.acknowledgementUntil = null;
      }
    }

    return {
      primary: this.active,
      acknowledgement,
      ready: this.active?.code === "READY",
      changed: !sameCandidate(previous, this.active)
        || (previous === null) !== (this.active === null),
    };
  }

  private clearActive(now: number): string | null {
    this.pending = null;
    this.pendingSince = null;
    this.readySince = null;
    if (this.clearSince === null) {
      this.clearSince = now;
      return null;
    }
    if (now - this.clearSince < this.clearMs) {
      return null;
    }
    this.active = null;
    this.clearSince = null;
    this.readySince = now;
    this.acknowledgementUntil = now + this.acknowledgementMs;
    return "その調子です。";
  }
}

export const guidanceMessageForLocalCode = (code: LocalGuidanceCode): string => DEVICE_MESSAGES[code];
