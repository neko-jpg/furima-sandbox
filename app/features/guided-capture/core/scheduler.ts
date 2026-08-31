/**
 * A transport-agnostic frame scheduler for local guidance.
 *
 * The source camera may produce frames much faster than the analyzer.  This
 * scheduler keeps one pending frame, drops older pending frames, and never
 * starts a second analysis while the first one is in flight.  The default rate
 * is four hertz, matching the on-device quality requirement.
 */

export const FRAME_RATE_HZ = 4;
export const DEFAULT_FRAME_INTERVAL_MS = 1_000 / FRAME_RATE_HZ;

export type FrameSchedulerSource = "rvfc" | "raf" | "timer" | "manual";
export type SchedulerHandle = unknown;

export interface FrameSchedulerTick<Frame> {
  readonly source: FrameSchedulerSource;
  readonly timestamp: number;
  readonly metadata?: unknown;
  readonly frame?: Frame;
}

export type FrameProcessor<Frame> = (
  frame: Frame,
  tick: FrameSchedulerTick<Frame>,
) => void | PromiseLike<void>;

export type FrameReader<Frame> = (
  tick: Omit<FrameSchedulerTick<Frame>, "frame">,
) => Frame | undefined;

export interface VideoFrameSource {
  readonly requestVideoFrameCallback?: (
    callback: (timestamp: number, metadata: unknown) => void,
  ) => SchedulerHandle;
  readonly cancelVideoFrameCallback?: (handle: SchedulerHandle) => void;
}

export interface FrameSchedulerPlatform {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => SchedulerHandle;
  readonly clearTimeout: (handle: SchedulerHandle) => void;
  readonly requestVideoFrameCallback?: VideoFrameSource["requestVideoFrameCallback"];
  readonly cancelVideoFrameCallback?: VideoFrameSource["cancelVideoFrameCallback"];
  readonly requestAnimationFrame?: (callback: (timestamp: number) => void) => SchedulerHandle;
  readonly cancelAnimationFrame?: (handle: SchedulerHandle) => void;
}

export interface FrameSchedulerOptions<Frame> {
  readonly onFrame: FrameProcessor<Frame>;
  readonly readFrame?: FrameReader<Frame>;
  readonly video?: VideoFrameSource;
  readonly platform?: Partial<FrameSchedulerPlatform>;
  readonly intervalMs?: number;
  readonly mode?: "auto" | "manual";
  readonly onError?: (error: unknown, tick?: FrameSchedulerTick<Frame>) => void;
  readonly disposeFrame?: (frame: Frame) => void;
}

interface PendingFrame<Frame> {
  readonly frame: Frame;
  readonly tick: FrameSchedulerTick<Frame>;
}

function browserPlatform(): FrameSchedulerPlatform {
  const scope = globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };

  return {
    now: () =>
      typeof scope.performance?.now === "function" ? scope.performance.now() : Date.now(),
    setTimeout: (callback, delayMs) => scope.setTimeout(callback, delayMs),
    clearTimeout: (handle) => scope.clearTimeout(handle as number),
    requestAnimationFrame: scope.requestAnimationFrame === undefined
      ? undefined
      : (callback) => scope.requestAnimationFrame?.(callback) as number,
    cancelAnimationFrame: scope.cancelAnimationFrame === undefined
      ? undefined
      : (handle) => scope.cancelAnimationFrame?.(handle as number),
  };
}

function finiteTimestamp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("frame timestamp must be finite");
  }
  return value;
}

function mergedPlatform(
  override: Partial<FrameSchedulerPlatform> | undefined,
): FrameSchedulerPlatform {
  const fallback = browserPlatform();
  return {
    now: override?.now ?? fallback.now,
    setTimeout: override?.setTimeout ?? fallback.setTimeout,
    clearTimeout: override?.clearTimeout ?? fallback.clearTimeout,
    requestVideoFrameCallback: override?.requestVideoFrameCallback,
    cancelVideoFrameCallback: override?.cancelVideoFrameCallback,
    requestAnimationFrame: override?.requestAnimationFrame ?? fallback.requestAnimationFrame,
    cancelAnimationFrame: override?.cancelAnimationFrame ?? fallback.cancelAnimationFrame,
  };
}

export class FrameScheduler<Frame> {
  private readonly processFrame: FrameProcessor<Frame>;
  private readonly readFrame: FrameReader<Frame> | undefined;
  private readonly video: VideoFrameSource | undefined;
  private readonly platform: FrameSchedulerPlatform;
  private readonly intervalMs: number;
  private readonly mode: "auto" | "manual";
  private readonly onError: ((error: unknown, tick?: FrameSchedulerTick<Frame>) => void) | undefined;
  private readonly disposeFrame: ((frame: Frame) => void) | undefined;

  private running = false;
  private processing = false;
  private pending: PendingFrame<Frame> | undefined;
  private activeFrame: Frame | undefined;
  private source: FrameSchedulerSource = "manual";
  private nextProcessAt = 0;
  private sourceHandle: SchedulerHandle | undefined;
  private wakeHandle: SchedulerHandle | undefined;
  private sourceScheduled = false;

  public constructor(options: FrameSchedulerOptions<Frame>) {
    if (options.onFrame === undefined) {
      throw new TypeError("FrameScheduler requires an onFrame processor");
    }

    const intervalMs = options.intervalMs ?? DEFAULT_FRAME_INTERVAL_MS;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError("intervalMs must be greater than zero");
    }

    this.processFrame = options.onFrame;
    this.readFrame = options.readFrame;
    this.video = options.video;
    this.platform = mergedPlatform(options.platform);
    this.intervalMs = intervalMs;
    this.mode = options.mode ?? "auto";
    this.onError = options.onError;
    this.disposeFrame = options.disposeFrame;
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public get isProcessing(): boolean {
    return this.processing;
  }

  public get pendingFrameCount(): 0 | 1 {
    return this.pending === undefined ? 0 : 1;
  }

  public get interval(): number {
    return this.intervalMs;
  }

  public get selectedSource(): FrameSchedulerSource {
    return this.source;
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.nextProcessAt = this.platform.now();
    this.source = this.mode === "manual" ? "manual" : this.selectSource();
    if (this.source !== "manual") {
      this.scheduleNextFrame();
    }
  }

  public stop(): void {
    this.running = false;
    this.cancelScheduledSource();
    this.clearWakeTimer();
    const pending = this.pending;
    this.pending = undefined;
    if (pending !== undefined) {
      this.disposeDroppedFrame(pending.frame);
    }
  }

  /** Queue a frame from a test, worker, or an explicitly controlled adapter. */
  public tick(frame: Frame, timestamp = this.platform.now(), metadata?: unknown): void {
    if (!this.running) {
      if (this.mode !== "manual") {
        return;
      }
      this.start();
    }

    this.acceptTick({
      source: "manual",
      timestamp: finiteTimestamp(timestamp),
      metadata,
      frame,
    });
  }

  public manualTick(frame: Frame, timestamp = this.platform.now(), metadata?: unknown): void {
    this.tick(frame, timestamp, metadata);
  }

  public scheduleNextFrame(): void {
    if (!this.running || this.source === "manual" || this.sourceScheduled) {
      return;
    }

    if (this.source === "rvfc") {
      this.scheduleVideoFrame();
    } else if (this.source === "raf") {
      this.scheduleAnimationFrame();
    } else {
      this.scheduleTimerFrame();
    }
  }

  private selectSource(): FrameSchedulerSource {
    if (this.video?.requestVideoFrameCallback ?? this.platform.requestVideoFrameCallback) {
      return "rvfc";
    }
    return this.platform.requestAnimationFrame === undefined ? "timer" : "raf";
  }

  private scheduleVideoFrame(): void {
    const request = this.video?.requestVideoFrameCallback ?? this.platform.requestVideoFrameCallback;
    if (request === undefined) {
      this.source = this.platform.requestAnimationFrame === undefined ? "timer" : "raf";
      this.scheduleNextFrame();
      return;
    }

    this.sourceScheduled = true;
    try {
      this.sourceHandle = this.video === undefined
        ? request((timestamp, metadata) => this.onBrowserFrame("rvfc", timestamp, metadata))
        : request.call(this.video, (timestamp, metadata) => this.onBrowserFrame("rvfc", timestamp, metadata));
    } catch (error) {
      this.sourceScheduled = false;
      this.sourceHandle = undefined;
      this.reportError(error);
      this.source = this.platform.requestAnimationFrame === undefined ? "timer" : "raf";
      this.scheduleNextFrame();
    }
  }

  private scheduleAnimationFrame(): void {
    const request = this.platform.requestAnimationFrame;
    if (request === undefined) {
      this.source = "timer";
      this.scheduleNextFrame();
      return;
    }

    this.sourceScheduled = true;
    try {
      this.sourceHandle = request((timestamp) => this.onBrowserFrame("raf", timestamp));
    } catch (error) {
      this.sourceScheduled = false;
      this.sourceHandle = undefined;
      this.reportError(error);
      this.source = "timer";
      this.scheduleNextFrame();
    }
  }

  private scheduleTimerFrame(): void {
    this.sourceScheduled = true;
    try {
      this.sourceHandle = this.platform.setTimeout(() => {
        this.sourceScheduled = false;
        this.sourceHandle = undefined;
        if (!this.running) {
          return;
        }
        this.onBrowserFrame("timer", this.platform.now());
        this.scheduleNextFrame();
      }, this.intervalMs);
    } catch (error) {
      this.sourceScheduled = false;
      this.sourceHandle = undefined;
      this.reportError(error);
      this.running = false;
    }
  }

  private onBrowserFrame(
    source: Exclude<FrameSchedulerSource, "manual">,
    timestamp: number,
    metadata?: unknown,
  ): void {
    this.sourceScheduled = false;
    this.sourceHandle = undefined;
    if (!this.running) {
      return;
    }

    const tick: Omit<FrameSchedulerTick<Frame>, "frame"> = {
      source,
      timestamp: finiteTimestamp(timestamp),
      metadata,
    };
    try {
      const frame = this.readFrame?.(tick);
      if (frame !== undefined) {
        this.acceptTick({ ...tick, frame });
      }
    } catch (error) {
      this.reportError(error, tick as FrameSchedulerTick<Frame>);
    } finally {
      this.scheduleNextFrame();
    }
  }

  private acceptTick(tick: FrameSchedulerTick<Frame>): void {
    if (!this.running || tick.frame === undefined) {
      return;
    }

    const previous = this.pending;
    if (previous !== undefined && previous.frame !== tick.frame) {
      this.disposeDroppedFrame(previous.frame);
    }
    this.pending = { frame: tick.frame, tick };

    const now = Math.max(this.platform.now(), tick.timestamp);
    this.drainIfDue(now);
    if (this.pending !== undefined && !this.processing) {
      this.scheduleWakeTimer();
    }
  }

  private drainIfDue(now: number): void {
    if (!this.running || this.processing || this.pending === undefined) {
      return;
    }
    if (now < this.nextProcessAt) {
      return;
    }

    const pending = this.pending;
    this.pending = undefined;
    this.clearWakeTimer();
    this.processing = true;
    this.activeFrame = pending.frame;
    this.nextProcessAt = now + this.intervalMs;

    Promise.resolve()
      .then(() => this.processFrame(pending.frame, pending.tick))
      .catch((error: unknown) => this.reportError(error, pending.tick))
      .finally(() => {
        this.processing = false;
        this.activeFrame = undefined;
        if (!this.running || this.pending === undefined) {
          return;
        }
        this.drainIfDue(this.platform.now());
        if (this.pending !== undefined && !this.processing) {
          this.scheduleWakeTimer();
        }
      });
  }

  private scheduleWakeTimer(): void {
    if (!this.running || this.processing || this.pending === undefined || this.wakeHandle !== undefined) {
      return;
    }

    const delay = Math.max(0, this.nextProcessAt - this.platform.now());
    try {
      this.wakeHandle = this.platform.setTimeout(() => {
        this.wakeHandle = undefined;
        if (this.running) {
          this.drainIfDue(this.platform.now());
        }
      }, delay);
    } catch (error) {
      this.wakeHandle = undefined;
      this.reportError(error);
    }
  }

  private clearWakeTimer(): void {
    if (this.wakeHandle !== undefined) {
      this.platform.clearTimeout(this.wakeHandle);
      this.wakeHandle = undefined;
    }
  }

  private cancelScheduledSource(): void {
    if (this.sourceHandle === undefined) {
      this.sourceScheduled = false;
      return;
    }

    if (this.source === "rvfc") {
      (this.video?.cancelVideoFrameCallback ?? this.platform.cancelVideoFrameCallback)?.(this.sourceHandle);
    } else if (this.source === "raf") {
      this.platform.cancelAnimationFrame?.(this.sourceHandle);
    } else if (this.source === "timer") {
      this.platform.clearTimeout(this.sourceHandle);
    }
    this.sourceHandle = undefined;
    this.sourceScheduled = false;
  }

  private disposeDroppedFrame(frame: Frame): void {
    if (frame === this.activeFrame || this.disposeFrame === undefined) {
      return;
    }
    try {
      this.disposeFrame(frame);
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(
    error: unknown,
    tick?: FrameSchedulerTick<Frame>,
  ): void {
    try {
      this.onError?.(error, tick);
    } catch {
      // Observability must never terminate the capture loop.
    }
  }
}

export function createFrameScheduler<Frame>(
  options: FrameSchedulerOptions<Frame>,
): FrameScheduler<Frame> {
  return new FrameScheduler(options);
}
