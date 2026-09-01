import {
  detectMeasurementMarkerWithOpenCv,
  type OpenCvMarkerImage,
} from './opencvMarkerDetector.ts';
import type { Homography } from './geometry.ts';
import { projectRgbaImage } from './perspective.ts';
import type {
  MarkerDetectionOptions,
  MarkerDetectionResult,
  PixelRect,
} from './markerDetector.ts';

export const MARKER_WORKER_ERROR_CODES = ['INVALID_REQUEST', 'INVALID_RESPONSE', 'TIMEOUT', 'CANCELLED'] as const;
export type MarkerWorkerErrorCode = (typeof MARKER_WORKER_ERROR_CODES)[number];

export interface MarkerWorkerImage {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayBuffer;
}

export interface MarkerWorkerDetectRequest {
  readonly type: 'detect-marker';
  readonly requestId: string;
  readonly image: MarkerWorkerImage;
  readonly options?: MarkerDetectionOptions;
  readonly garmentBounds?: PixelRect;
}

export interface MarkerWorkerCancelRequest {
  readonly type: 'cancel';
  readonly requestId: string;
}

export interface MarkerWorkerProjectRequest {
  readonly type: 'project-image';
  readonly requestId: string;
  readonly image: MarkerWorkerImage;
  readonly homography: Homography;
  readonly markerSidePx: number;
  readonly maxEdge?: number;
}

export type MarkerWorkerRequest = MarkerWorkerDetectRequest | MarkerWorkerCancelRequest | MarkerWorkerProjectRequest;

export interface MarkerWorkerDetectedResponse {
  readonly type: 'marker-detected';
  readonly requestId: string;
  readonly result: MarkerDetectionResult;
}

export interface MarkerWorkerErrorResponse {
  readonly type: 'error';
  readonly requestId: string;
  readonly code: Exclude<MarkerWorkerErrorCode, 'CANCELLED'>;
  readonly message: string;
}

export interface MarkerWorkerCancelledResponse {
  readonly type: 'cancelled';
  readonly requestId: string;
  readonly code: 'CANCELLED';
}

export interface MarkerWorkerProjectedImage {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayBuffer;
  readonly markerSidePx: number;
  readonly scale: number;
}

export interface MarkerWorkerProjectedResponse {
  readonly type: 'image-projected';
  readonly requestId: string;
  readonly image: MarkerWorkerProjectedImage;
}

export type MarkerWorkerResponse = MarkerWorkerDetectedResponse | MarkerWorkerProjectedResponse | MarkerWorkerErrorResponse | MarkerWorkerCancelledResponse;

const MAX_REQUEST_ID_LENGTH = 200;
const MAX_CANCELLED_REQUESTS = 128;
const cancelledRequestIds = new Set<string>();

interface MarkerWorkerRequestPort {
  postMessage(message: MarkerWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<MarkerWorkerResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<MarkerWorkerResponse>) => void): void;
  terminate?(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const validRequestId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.trim().length > 0
  && value.length <= MAX_REQUEST_ID_LENGTH
  && !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  })
);

const finitePositiveInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value > 0
);

const validRect = (value: unknown): value is PixelRect => (
  isRecord(value)
  && Object.keys(value).every((key) => ['left', 'top', 'right', 'bottom'].includes(key))
  && ['left', 'top', 'right', 'bottom'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
  && (value.right as number) >= (value.left as number)
  && (value.bottom as number) >= (value.top as number)
);

const validImage = (value: unknown): value is MarkerWorkerImage => {
  if (!isRecord(value) || !finitePositiveInteger(value.width) || !finitePositiveInteger(value.height)) return false;
  if (value.width * value.height > 16_777_216 || !(value.data instanceof ArrayBuffer)) return false;
  return value.data.byteLength >= value.width * value.height * 4;
};

const validHomography = (value: unknown): value is Homography => (
  isRecord(value)
  && Object.keys(value).every((key) => key === 'values')
  && Array.isArray(value.values)
  && value.values.length === 9
  && value.values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
);

const requestIdFor = (request: unknown): string => (
  isRecord(request) && validRequestId(request.requestId) ? request.requestId : 'invalid-request'
);

const errorResponse = (
  request: unknown,
  code: Exclude<MarkerWorkerErrorCode, 'CANCELLED'>,
  message: string,
): MarkerWorkerErrorResponse => ({ type: 'error', requestId: requestIdFor(request), code, message });

const cancelledResponse = (requestId: string): MarkerWorkerCancelledResponse => ({
  type: 'cancelled',
  requestId,
  code: 'CANCELLED',
});

const rememberCancellation = (requestId: string): void => {
  if (cancelledRequestIds.size >= MAX_CANCELLED_REQUESTS && !cancelledRequestIds.has(requestId)) {
    const oldest = cancelledRequestIds.values().next().value;
    if (typeof oldest === 'string') cancelledRequestIds.delete(oldest);
  }
  cancelledRequestIds.add(requestId);
};

const hasBeenCancelled = (requestId: string): boolean => cancelledRequestIds.delete(requestId);

const validDetectRequest = (request: Record<string, unknown>): request is Record<string, unknown> & MarkerWorkerDetectRequest => (
  request.type === 'detect-marker'
  && validRequestId(request.requestId)
  && validImage(request.image)
  && (request.options === undefined || isRecord(request.options))
  && (request.garmentBounds === undefined || validRect(request.garmentBounds))
);

const validProjectRequest = (request: Record<string, unknown>): request is Record<string, unknown> & MarkerWorkerProjectRequest => (
  Object.keys(request).every((key) => ['type', 'requestId', 'image', 'homography', 'markerSidePx', 'maxEdge'].includes(key))
  &&
  request.type === 'project-image'
  && validRequestId(request.requestId)
  && validImage(request.image)
  && validHomography(request.homography)
  && typeof request.markerSidePx === 'number'
  && Number.isFinite(request.markerSidePx)
  && request.markerSidePx > 0
  && (request.maxEdge === undefined || (typeof request.maxEdge === 'number' && Number.isInteger(request.maxEdge) && request.maxEdge >= 64 && request.maxEdge <= 4_096))
);

/**
 * Testable async worker entrypoint. OpenCV initialization and contour work are
 * intentionally below this boundary so the UI thread never imports the WASM
 * runtime during normal page load.
 */
export async function handleMarkerWorkerRequest(request: unknown): Promise<MarkerWorkerResponse> {
  if (!isRecord(request) || !validRequestId(request.requestId)) {
    return errorResponse(request, 'INVALID_REQUEST', 'Marker worker requestId is invalid.');
  }
  const requestId = request.requestId;
  if (request.type === 'cancel') {
    if (Object.keys(request).some((key) => !['type', 'requestId'].includes(key))) {
      return errorResponse(request, 'INVALID_REQUEST', 'Marker worker cancel request is invalid.');
    }
    rememberCancellation(requestId);
    return cancelledResponse(requestId);
  }
  if (request.type === 'project-image') {
    if (!validProjectRequest(request)) {
      return errorResponse(request, 'INVALID_REQUEST', 'Marker worker projection request is invalid.');
    }
    if (hasBeenCancelled(requestId)) return cancelledResponse(requestId);
    try {
      const projected = projectRgbaImage(
        {
          width: request.image.width,
          height: request.image.height,
          data: new Uint8ClampedArray(request.image.data),
        },
        request.homography,
        request.markerSidePx,
        request.maxEdge,
      );
      if (hasBeenCancelled(requestId)) return cancelledResponse(requestId);
      return {
        type: 'image-projected',
        requestId,
        image: {
          width: projected.width,
          height: projected.height,
          data: projected.data.slice().buffer as ArrayBuffer,
          markerSidePx: projected.markerSidePx,
          scale: projected.scale,
        },
      };
    } catch {
      return errorResponse(request, 'INVALID_RESPONSE', 'Marker worker could not correct the image perspective.');
    }
  }
  if (!validDetectRequest(request)) {
    return errorResponse(request, 'INVALID_REQUEST', 'Marker worker image request is invalid.');
  }
  if (hasBeenCancelled(requestId)) return cancelledResponse(requestId);
  try {
    const result = await detectMeasurementMarkerWithOpenCv(
      {
        width: request.image.width,
        height: request.image.height,
        data: new Uint8ClampedArray(request.image.data),
      },
      request.options,
      request.garmentBounds,
    );
    if (hasBeenCancelled(requestId)) return cancelledResponse(requestId);
    return { type: 'marker-detected', requestId, result };
  } catch {
    return errorResponse(request, 'INVALID_RESPONSE', 'Marker worker failed to analyze the image.');
  }
}

export class MarkerWorkerError extends Error {
  public readonly code: MarkerWorkerErrorCode;
  public readonly requestId: string;

  public constructor(code: MarkerWorkerErrorCode, requestId: string, message: string) {
    super(message);
    this.name = 'MarkerWorkerError';
    this.code = code;
    this.requestId = requestId;
  }
}

interface PendingMarkerRequest {
  readonly kind: 'detect' | 'project';
  readonly resolve: (result: MarkerDetectionResult | MarkerWorkerProjectedImage) => void;
  readonly reject: (error: MarkerWorkerError) => void;
  readonly signal?: AbortSignal;
  readonly abortListener?: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const isMarkerDetectionResult = (value: unknown): value is MarkerDetectionResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (!value.ok) return typeof value.code === 'string' && typeof value.message === 'string' && value.message.length > 0;
  return isRecord(value.marker) && isRecord(value.projection);
};

const isProjectedImage = (value: unknown): value is MarkerWorkerProjectedImage => (
  isRecord(value)
  && finitePositiveInteger(value.width)
  && finitePositiveInteger(value.height)
  && value.width * value.height <= 16_777_216
  && value.data instanceof ArrayBuffer
  && value.data.byteLength >= value.width * value.height * 4
  && typeof value.markerSidePx === 'number'
  && Number.isFinite(value.markerSidePx)
  && value.markerSidePx > 0
  && typeof value.scale === 'number'
  && Number.isFinite(value.scale)
  && value.scale > 0
);

/** Main-thread client with timeout, cancellation, and request-id fencing. */
export class MeasurementMarkerWorkerClient {
  private readonly worker: MarkerWorkerRequestPort;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingMarkerRequest>();
  private terminated = false;

  public constructor(worker: MarkerWorkerRequestPort) {
    this.worker = worker;
    this.worker.addEventListener('message', this.handleMessage);
  }

  public detect(
    image: OpenCvMarkerImage,
    options: MarkerDetectionOptions = {},
    garmentBounds?: PixelRect,
    signal?: AbortSignal,
    timeoutMs = 8_000,
  ): Promise<MarkerDetectionResult> {
    const requestId = `marker-${++this.requestSequence}`;
    if (this.terminated) return Promise.reject(new MarkerWorkerError('CANCELLED', requestId, 'Marker worker was terminated.'));
    if (signal?.aborted) return Promise.reject(new MarkerWorkerError('CANCELLED', requestId, 'Marker worker request was cancelled.'));
    if (!finitePositiveInteger(image.width) || !finitePositiveInteger(image.height) || image.data.length < image.width * image.height * 4) {
      return Promise.reject(new MarkerWorkerError('INVALID_REQUEST', requestId, 'Marker worker image is invalid.'));
    }
    const bytes = Uint8Array.from(image.data);
    const timer = setTimeout(() => {
      const pending = this.removePending(requestId);
      if (!pending) return;
      try { this.worker.postMessage({ type: 'cancel', requestId }); } catch { /* worker may already be gone */ }
      pending.reject(new MarkerWorkerError('TIMEOUT', requestId, 'Marker worker timed out.'));
    }, Math.max(1, timeoutMs));
    return new Promise<MarkerDetectionResult>((resolve, reject) => {
      const abortListener = signal ? () => { this.cancel(requestId); } : undefined;
       this.pending.set(requestId, { kind: 'detect', resolve: (result) => resolve(result as MarkerDetectionResult), reject, signal, abortListener, timer });
      if (signal && abortListener) signal.addEventListener('abort', abortListener, { once: true });
      try {
        this.worker.postMessage({ type: 'detect-marker', requestId, image: { width: image.width, height: image.height, data: bytes.buffer }, options, garmentBounds }, [bytes.buffer]);
      } catch (error) {
        this.removePending(requestId);
        reject(new MarkerWorkerError('INVALID_REQUEST', requestId, error instanceof Error ? error.message : 'Unable to post marker request.'));
      }
    });
  }

  /** Project a bounded analysis raster without moving image bytes through the UI state. */
  public project(
    image: OpenCvMarkerImage,
    homography: Homography,
    markerSidePx: number,
    signal?: AbortSignal,
    timeoutMs = 8_000,
  ): Promise<MarkerWorkerProjectedImage> {
    const requestId = `marker-project-${++this.requestSequence}`;
    if (this.terminated) return Promise.reject(new MarkerWorkerError('CANCELLED', requestId, 'Marker worker was terminated.'));
    if (signal?.aborted) return Promise.reject(new MarkerWorkerError('CANCELLED', requestId, 'Marker worker request was cancelled.'));
    if (!finitePositiveInteger(image.width) || !finitePositiveInteger(image.height) || image.data.length < image.width * image.height * 4) {
      return Promise.reject(new MarkerWorkerError('INVALID_REQUEST', requestId, 'Marker worker image is invalid.'));
    }
    if (!validHomography(homography) || !Number.isFinite(markerSidePx) || markerSidePx <= 0) {
      return Promise.reject(new MarkerWorkerError('INVALID_REQUEST', requestId, 'Marker worker projection parameters are invalid.'));
    }
    const bytes = Uint8Array.from(image.data);
    const timer = setTimeout(() => {
      const pending = this.removePending(requestId);
      if (!pending) return;
      try { this.worker.postMessage({ type: 'cancel', requestId }); } catch { /* worker may already be gone */ }
      pending.reject(new MarkerWorkerError('TIMEOUT', requestId, 'Marker worker timed out.'));
    }, Math.max(1, timeoutMs));
    return new Promise<MarkerWorkerProjectedImage>((resolve, reject) => {
      const abortListener = signal ? () => { this.cancel(requestId); } : undefined;
      this.pending.set(requestId, { kind: 'project', resolve: (result) => resolve(result as MarkerWorkerProjectedImage), reject, signal, abortListener, timer });
      if (signal && abortListener) signal.addEventListener('abort', abortListener, { once: true });
      try {
        this.worker.postMessage({ type: 'project-image', requestId, image: { width: image.width, height: image.height, data: bytes.buffer }, homography, markerSidePx }, [bytes.buffer]);
      } catch (error) {
        this.removePending(requestId);
        reject(new MarkerWorkerError('INVALID_REQUEST', requestId, error instanceof Error ? error.message : 'Unable to post marker projection request.'));
      }
    });
  }

  public cancel(requestId: string): boolean {
    const pending = this.removePending(requestId);
    if (!pending) return false;
    try { this.worker.postMessage({ type: 'cancel', requestId }); } catch { /* ignore a dead worker */ }
    pending.reject(new MarkerWorkerError('CANCELLED', requestId, 'Marker worker request was cancelled.'));
    return true;
  }

  public terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    for (const requestId of [...this.pending.keys()]) this.cancel(requestId);
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.terminate?.();
  }

  private removePending(requestId: string): PendingMarkerRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) pending.signal.removeEventListener('abort', pending.abortListener);
    return pending;
  }

  private readonly handleMessage = (event: MessageEvent<MarkerWorkerResponse>): void => {
    const response = event.data;
    if (!isRecord(response) || !validRequestId(response.requestId)) return;
    const pending = this.removePending(response.requestId);
    if (!pending) return;
    if (response.type === 'marker-detected' && pending.kind === 'detect' && isMarkerDetectionResult(response.result)) {
      pending.resolve(response.result);
      return;
    }
    if (response.type === 'image-projected' && pending.kind === 'project' && isProjectedImage(response.image)) {
      pending.resolve(response.image);
      return;
    }
    if (response.type === 'cancelled' && response.code === 'CANCELLED') {
      pending.reject(new MarkerWorkerError('CANCELLED', response.requestId, 'Marker worker request was cancelled.'));
      return;
    }
    if (response.type === 'error' && typeof response.code === 'string' && typeof response.message === 'string' && response.message.length > 0) {
      pending.reject(new MarkerWorkerError(response.code as MarkerWorkerErrorCode, response.requestId, response.message));
      return;
    }
    pending.reject(new MarkerWorkerError('INVALID_RESPONSE', response.requestId, 'Marker worker returned an invalid response.'));
  };
}

const workerScope = globalThis as unknown as {
  document?: unknown;
  postMessage?: (message: MarkerWorkerResponse, transfer?: Transferable[]) => void;
  addEventListener?: (type: 'message', listener: (event: MessageEvent<MarkerWorkerRequest>) => void) => void;
};

if (typeof workerScope.document === 'undefined' && typeof workerScope.postMessage === 'function' && typeof workerScope.addEventListener === 'function') {
  workerScope.addEventListener('message', (event) => {
    void handleMarkerWorkerRequest(event.data).then((response) => {
      const transfer = response.type === 'image-projected' ? [response.image.data] : undefined;
      workerScope.postMessage?.(response, transfer);
    });
  });
}
