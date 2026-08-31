/**
 * Camera lifecycle and frame-capture ports.
 *
 * The controller owns only the stream it acquired.  Browser objects are
 * represented by structural interfaces so tests and a future UI adapter do
 * not need a DOM implementation or a camera SDK in the feature core.
 */

export interface CameraTrackLike {
  readonly kind?: string;
  stop(): void;
}

export interface CameraStreamLike {
  getTracks(): readonly CameraTrackLike[];
  getVideoTracks?(): readonly CameraTrackLike[];
}

export interface CameraVideoLike {
  muted: boolean;
  playsInline: boolean;
  autoplay: boolean;
  srcObject: unknown;
  readonly videoWidth: number;
  readonly videoHeight: number;
  play(): Promise<void>;
  pause(): void;
}

export interface CameraVideoConstraints {
  readonly facingMode?: string | { readonly ideal?: string; readonly exact?: string };
  readonly width?: number | { readonly ideal?: number; readonly min?: number; readonly max?: number };
  readonly height?: number | { readonly ideal?: number; readonly min?: number; readonly max?: number };
  readonly frameRate?: number | { readonly ideal?: number; readonly min?: number; readonly max?: number };
  readonly [key: string]: unknown;
}

export interface CameraMediaConstraints {
  readonly video: CameraVideoConstraints | boolean;
  readonly audio: false;
}

export interface CameraRuntime {
  readonly hostname: string;
  readonly isSecureContext: boolean;
  readonly getUserMedia?: (
    constraints: CameraMediaConstraints,
  ) => Promise<CameraStreamLike>;
}

export const DEFAULT_VIDEO_CONSTRAINTS: CameraVideoConstraints = {
  facingMode: "environment",
  width: { ideal: 1_920 },
  height: { ideal: 1_080 },
};

export type CameraStartErrorCode =
  | "aborted"
  | "camera-not-found"
  | "camera-unavailable"
  | "insecure-context"
  | "permission-denied"
  | "playback-failed"
  | "unsupported"
  | "unknown";

export class CameraStartError extends Error {
  public readonly code: CameraStartErrorCode;

  public constructor(code: CameraStartErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CameraStartError";
    this.code = code;
  }
}

const LOCAL_CAMERA_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function browserRuntime(): CameraRuntime {
  const mediaDevices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return {
    hostname: typeof window === "undefined" ? "" : window.location.hostname,
    isSecureContext: typeof window !== "undefined" && window.isSecureContext === true,
    getUserMedia: mediaDevices?.getUserMedia?.bind(mediaDevices) as
      | ((constraints: CameraMediaConstraints) => Promise<CameraStreamLike>)
      | undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConstraintValue<T>(base: T | undefined, override: T | undefined): T | undefined {
  if (override === undefined) {
    return base;
  }
  return isRecord(base) && isRecord(override)
    ? ({ ...base, ...override } as T)
    : override;
}

function mergeConstraints(
  override: CameraVideoConstraints | undefined,
): CameraVideoConstraints {
  const safeOverride = override ?? {};
  return {
    ...DEFAULT_VIDEO_CONSTRAINTS,
    ...safeOverride,
    width: mergeConstraintValue(DEFAULT_VIDEO_CONSTRAINTS.width, safeOverride.width),
    height: mergeConstraintValue(DEFAULT_VIDEO_CONSTRAINTS.height, safeOverride.height),
    facingMode: mergeConstraintValue(DEFAULT_VIDEO_CONSTRAINTS.facingMode, safeOverride.facingMode),
  };
}

function errorName(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.name !== "string") {
    return undefined;
  }
  return error.name;
}

function mapMediaError(error: unknown): CameraStartError {
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return new CameraStartError("permission-denied", "Camera permission was denied.", { cause: error });
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new CameraStartError("camera-not-found", "No camera was found on this device.", { cause: error });
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new CameraStartError("camera-unavailable", "The camera is already in use.", { cause: error });
  }
  return new CameraStartError(
    "unknown",
    error instanceof Error ? error.message : "Camera start failed.",
    { cause: error },
  );
}

function stopTracks(stream: CameraStreamLike | undefined): void {
  for (const track of stream?.getTracks() ?? []) {
    try {
      track.stop();
    } catch {
      // A partially stopped stream must not prevent the remaining tracks from closing.
    }
  }
}

export function cleanupCameraStream(
  video: CameraVideoLike | undefined,
  stream: CameraStreamLike | undefined,
): void {
  try {
    video?.pause();
  } finally {
    if (video !== undefined) {
      video.srcObject = null;
    }
    stopTracks(stream);
  }
}

export interface CameraControllerOptions {
  readonly runtime?: CameraRuntime;
  readonly videoConstraints?: CameraVideoConstraints;
  /** Optional wait used when mobile browsers abort the first play() call. */
  readonly waitForVideoReady?: () => Promise<void>;
}

export interface CameraSession {
  readonly currentStream: CameraStreamLike | undefined;
  readonly currentVideoTrack: CameraTrackLike | undefined;
  readonly isRunning: boolean;
  start(): Promise<void>;
  stop(): void;
}

export class CameraController implements CameraSession {
  private readonly video: CameraVideoLike;
  private readonly runtime: CameraRuntime;
  private readonly constraints: CameraVideoConstraints;
  private readonly waitForVideoReady: (() => Promise<void>) | undefined;
  private lifecycleToken = 0;
  private running = false;
  private stream: CameraStreamLike | undefined;
  private startTask: Promise<void> | undefined;
  private startTaskToken: number | undefined;

  public constructor(video: CameraVideoLike, options: CameraControllerOptions = {}) {
    this.video = video;
    this.runtime = options.runtime ?? browserRuntime();
    this.constraints = mergeConstraints(options.videoConstraints);
    this.waitForVideoReady = options.waitForVideoReady;
  }

  public get currentStream(): CameraStreamLike | undefined {
    return this.stream;
  }

  public get currentVideoTrack(): CameraTrackLike | undefined {
    return this.stream?.getVideoTracks?.().find((track) => track.kind === undefined || track.kind === "video")
      ?? this.stream?.getTracks().find((track) => track.kind === undefined || track.kind === "video");
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public start(): Promise<void> {
    if (this.running) {
      return Promise.resolve();
    }
    if (this.startTask !== undefined && this.startTaskToken === this.lifecycleToken) {
      return this.startTask;
    }

    const token = ++this.lifecycleToken;
    const task = this.startTask === undefined
      ? this.startInternal(token)
      : this.startTask.catch(() => undefined).then(() => this.startInternal(token));
    return this.trackStartTask(token, task);
  }

  public stop(): void {
    this.lifecycleToken += 1;
    this.running = false;
    const stream = this.stream;
    this.stream = undefined;
    cleanupCameraStream(this.video, stream);
  }

  private trackStartTask(token: number, task: Promise<void>): Promise<void> {
    const tracked = task.finally(() => {
      if (this.startTaskToken === token) {
        this.startTask = undefined;
        this.startTaskToken = undefined;
      }
    });
    this.startTask = tracked;
    this.startTaskToken = token;
    return tracked;
  }

  private assertCurrent(token: number): void {
    if (token !== this.lifecycleToken) {
      throw new CameraStartError("aborted", "Camera start was cancelled.");
    }
  }

  private getMediaRequest(): (constraints: CameraMediaConstraints) => Promise<CameraStreamLike> {
    if (!this.runtime.isSecureContext && !LOCAL_CAMERA_HOSTS.has(this.runtime.hostname)) {
      throw new CameraStartError("insecure-context", "Camera access requires HTTPS or localhost.");
    }
    if (this.runtime.getUserMedia === undefined) {
      throw new CameraStartError("unsupported", "Camera access is unavailable in this browser.");
    }
    return this.runtime.getUserMedia;
  }

  private async playVideo(): Promise<void> {
    try {
      await this.video.play();
    } catch (error) {
      if (errorName(error) !== "AbortError") {
        throw error;
      }
      await this.waitForVideoReady?.();
      await this.video.play();
    }
  }

  private async startInternal(token: number): Promise<void> {
    let acquired: CameraStreamLike | undefined;
    try {
      this.assertCurrent(token);
      const getUserMedia = this.getMediaRequest();
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.autoplay = true;
      try {
        acquired = await getUserMedia({ video: { ...this.constraints }, audio: false });
      } catch (error) {
        throw mapMediaError(error);
      }
      this.assertCurrent(token);
      this.stream = acquired;
      this.video.srcObject = acquired;
      try {
        await this.playVideo();
      } catch (error) {
        throw new CameraStartError(
          "playback-failed",
          error instanceof Error ? error.message : "The camera stream could not be played.",
          { cause: error },
        );
      }
      this.assertCurrent(token);
      this.running = true;
    } catch (error) {
      if (acquired !== undefined) {
        cleanupCameraStream(this.video, acquired);
      }
      if (this.stream === acquired) {
        this.stream = undefined;
      }
      this.running = false;
      if (error instanceof CameraStartError && error.code === "aborted") {
        return;
      }
      if (error instanceof CameraStartError) {
        throw error;
      }
      throw new CameraStartError(
        "unknown",
        error instanceof Error ? error.message : "Camera start failed.",
        { cause: error },
      );
    }
  }
}

export interface Canvas2DLike {
  drawImage(source: unknown, dx: number, dy: number, width: number, height: number): void;
}

export interface CaptureCanvasLike {
  width: number;
  height: number;
  getContext2D(): Canvas2DLike | null;
  toBlob(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void;
}

export interface CaptureVideoFrameOptions {
  readonly imageType?: string;
  readonly quality?: number;
}

export type CaptureCanvasFactory = (width: number, height: number) => CaptureCanvasLike;

export async function captureVideoFrame(
  video: CameraVideoLike,
  createCanvas: CaptureCanvasFactory,
  options: CaptureVideoFrameOptions = {},
): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Cannot capture a video frame without positive video dimensions.");
  }
  if (options.imageType !== undefined && options.imageType.trim() === "") {
    throw new Error("imageType must not be empty.");
  }
  if (options.quality !== undefined && (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)) {
    throw new Error("quality must be between 0 and 1.");
  }

  const canvas = createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext2D();
  if (context === null) {
    throw new Error("2D canvas context is unavailable.");
  }
  context.drawImage(video, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("Canvas encoding failed."));
      } else {
        resolve(blob);
      }
    }, options.imageType ?? "image/jpeg", options.quality);
  });
}
