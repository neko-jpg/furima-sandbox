import {
  MeasurementEndpointsSchema,
  type MeasurementEndpoints,
  type NormalizedPoint,
} from '../../../types/measurement.ts';
import { projectMeasurementEndpoints, type Homography } from './geometry.ts';

export const MEASUREMENT_WORKER_ERROR_CODES = [
  'INVALID_REQUEST',
  'PROJECTION_FAILED',
  'INVALID_RESPONSE',
  'CANCELLED',
] as const;
export type MeasurementWorkerErrorCode = (typeof MEASUREMENT_WORKER_ERROR_CODES)[number];

export interface MeasurementProjectRequest {
  readonly type: 'project-endpoints';
  readonly requestId: string;
  readonly endpoints: MeasurementEndpoints;
  readonly homography: Homography;
}

export interface MeasurementCancelRequest {
  readonly type: 'cancel';
  readonly requestId: string;
}

export type MeasurementWorkerRequest = MeasurementProjectRequest | MeasurementCancelRequest;

export interface MeasurementProjectedResponse {
  readonly type: 'projected-endpoints';
  readonly requestId: string;
  readonly endpoints: MeasurementEndpoints;
}

export interface MeasurementWorkerErrorResponse {
  readonly type: 'error';
  readonly requestId: string;
  readonly code: Exclude<MeasurementWorkerErrorCode, 'CANCELLED'>;
  readonly message: string;
}

export interface MeasurementCancelledResponse {
  readonly type: 'cancelled';
  readonly requestId: string;
  readonly code: 'CANCELLED';
}

export type MeasurementWorkerResponse =
  | MeasurementProjectedResponse
  | MeasurementWorkerErrorResponse
  | MeasurementCancelledResponse;

export interface MeasurementWorkerPort {
  postMessage(message: MeasurementWorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<MeasurementWorkerResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<MeasurementWorkerResponse>) => void): void;
  terminate?(): void;
}

export interface MeasurementWorkerProjectOptions {
  readonly requestId?: string;
  readonly signal?: AbortSignal;
}

const MAX_REQUEST_ID_LENGTH = 200;
const MAX_CANCELLED_REQUEST_IDS = 128;
const cancelledRequestIds = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRequestId(value: unknown): value is string {
  const requestId = typeof value === 'string' ? value : '';
  return (
    typeof value === 'string' &&
    requestId.trim().length > 0 &&
    requestId.length <= MAX_REQUEST_ID_LENGTH &&
    !Array.from(requestId).some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isWorkerErrorCode(value: unknown): value is Exclude<MeasurementWorkerErrorCode, 'CANCELLED'> {
  return value === 'INVALID_REQUEST' || value === 'PROJECTION_FAILED' || value === 'INVALID_RESPONSE';
}

function isHomography(value: unknown): value is Homography {
  if (!isRecord(value) || !hasOnlyKeys(value, ['values']) || !Array.isArray(value.values)) return false;
  return value.values.length === 9 && value.values.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function rememberCancelledRequest(requestId: string): void {
  if (cancelledRequestIds.has(requestId)) return;
  if (cancelledRequestIds.size >= MAX_CANCELLED_REQUEST_IDS) {
    const oldest = cancelledRequestIds.values().next().value;
    if (typeof oldest === 'string') cancelledRequestIds.delete(oldest);
  }
  cancelledRequestIds.add(requestId);
}

function requestIdForError(request: unknown): string {
  if (isRecord(request) && validRequestId(request.requestId)) return request.requestId;
  return 'invalid-request';
}

function errorResponse(
  request: unknown,
  code: Exclude<MeasurementWorkerErrorCode, 'CANCELLED'>,
  message: string,
): MeasurementWorkerErrorResponse {
  return { type: 'error', requestId: requestIdForError(request), code, message };
}

function cancelledResponse(requestId: string): MeasurementCancelledResponse {
  return { type: 'cancelled', requestId, code: 'CANCELLED' };
}

/**
 * Pure worker entrypoint. A host can call this from its message listener.
 * Cancellation is represented explicitly and a cancelled request can never
 * produce a projected result on a later invocation.
 */
export function handleMeasurementWorkerRequest(request: unknown): MeasurementWorkerResponse {
  if (!isRecord(request) || !validRequestId(request.requestId)) {
    return errorResponse(request, 'INVALID_REQUEST', 'Measurement worker requestId is invalid.');
  }

  const requestId = request.requestId;
  if (request.type === 'cancel') {
    if (!hasOnlyKeys(request, ['type', 'requestId'])) {
      return errorResponse(request, 'INVALID_REQUEST', 'Measurement worker request is invalid.');
    }
    rememberCancelledRequest(requestId);
    return cancelledResponse(requestId);
  }
  if (request.type !== 'project-endpoints') {
    return errorResponse(request, 'INVALID_REQUEST', 'Unsupported measurement worker request.');
  }
  if (!hasOnlyKeys(request, ['type', 'requestId', 'endpoints', 'homography'])) {
    return errorResponse(request, 'INVALID_REQUEST', 'Measurement worker request is invalid.');
  }
  if (!isHomography(request.homography)) {
    return errorResponse(request, 'INVALID_REQUEST', 'Measurement homography is invalid.');
  }
  if (cancelledRequestIds.delete(requestId)) return cancelledResponse(requestId);

  try {
    const parsed = MeasurementEndpointsSchema.safeParse(request.endpoints);
    if (!parsed.success) {
      return errorResponse(request, 'INVALID_REQUEST', 'Measurement endpoints are invalid.');
    }
    const endpoints = projectMeasurementEndpoints(parsed.data, request.homography as Homography);
    if (cancelledRequestIds.delete(requestId)) return cancelledResponse(requestId);
    return { type: 'projected-endpoints', requestId, endpoints };
  } catch (error) {
    return errorResponse(
      request,
      'PROJECTION_FAILED',
      error instanceof Error ? error.message : 'Measurement projection failed.',
    );
  }
}

export class MeasurementWorkerError extends Error {
  public readonly code: MeasurementWorkerErrorCode;
  public readonly requestId: string;

  public constructor(code: MeasurementWorkerErrorCode, requestId: string, message: string) {
    super(message);
    this.name = 'MeasurementWorkerError';
    this.code = code;
    this.requestId = requestId;
  }
}

interface PendingMeasurementRequest {
  readonly resolve: (endpoints: MeasurementEndpoints) => void;
  readonly reject: (error: MeasurementWorkerError) => void;
  readonly signal?: AbortSignal;
  readonly abortListener?: () => void;
}

export class MeasurementWorkerClient {
  private readonly worker: MeasurementWorkerPort;
  private requestSequence = 0;
  private pending = new Map<string, PendingMeasurementRequest>();
  private terminated = false;

  public constructor(worker: MeasurementWorkerPort) {
    this.worker = worker;
    this.worker.addEventListener('message', this.handleMessage);
  }

  public project(
    endpoints: MeasurementEndpoints,
    homography: Homography,
    options: MeasurementWorkerProjectOptions | string = {},
  ): Promise<MeasurementEndpoints> {
    if (this.terminated) {
      return Promise.reject(new MeasurementWorkerError('CANCELLED', 'terminated', 'Measurement worker was terminated.'));
    }
    const normalizedOptions = typeof options === 'string' ? { requestId: options } : options;
    const requestId = normalizedOptions.requestId ?? this.nextRequestId();
    if (!validRequestId(requestId)) {
      return Promise.reject(new MeasurementWorkerError('INVALID_REQUEST', requestId, 'Measurement worker requestId is invalid.'));
    }
    if (this.pending.has(requestId)) {
      return Promise.reject(new MeasurementWorkerError('INVALID_REQUEST', requestId, 'Measurement worker requestId is already pending.'));
    }
    if (!MeasurementEndpointsSchema.safeParse(endpoints).success) {
      return Promise.reject(new MeasurementWorkerError('INVALID_REQUEST', requestId, 'Measurement endpoints are invalid.'));
    }
    if (!isHomography(homography)) {
      return Promise.reject(new MeasurementWorkerError('INVALID_REQUEST', requestId, 'Measurement homography is invalid.'));
    }
    if (normalizedOptions.signal?.aborted) {
      return Promise.reject(new MeasurementWorkerError('CANCELLED', requestId, 'Measurement worker request was cancelled.'));
    }

    return new Promise<MeasurementEndpoints>((resolve, reject) => {
      const abortListener = normalizedOptions.signal
        ? () => {
            this.cancel(requestId);
          }
        : undefined;
      this.pending.set(requestId, { resolve, reject, signal: normalizedOptions.signal, abortListener });
      if (normalizedOptions.signal && abortListener) normalizedOptions.signal.addEventListener('abort', abortListener, { once: true });
      try {
        this.worker.postMessage({ type: 'project-endpoints', requestId, endpoints, homography });
      } catch (error) {
        this.removePending(requestId);
        reject(new MeasurementWorkerError('INVALID_REQUEST', requestId, error instanceof Error ? error.message : 'Unable to post measurement request.'));
      }
    });
  }

  /** Cancel one request and make all later responses for it stale. */
  public cancel(requestId: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.removePending(requestId);
    try {
      this.worker.postMessage({ type: 'cancel', requestId });
    } catch {
      // The promise has already been rejected locally; a dead worker cannot
      // receive the cancellation, but its late response is still ignored.
    }
    pending.reject(new MeasurementWorkerError('CANCELLED', requestId, 'Measurement worker request was cancelled.'));
    return true;
  }

  public cancelAll(): void {
    for (const requestId of [...this.pending.keys()]) this.cancel(requestId);
  }

  public terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.cancelAll();
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.terminate?.();
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `measurement-${this.requestSequence}`;
  }

  private removePending(requestId: string): PendingMeasurementRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    if (pending.signal && pending.abortListener) pending.signal.removeEventListener('abort', pending.abortListener);
    return pending;
  }

  private readonly handleMessage = (event: MessageEvent<MeasurementWorkerResponse>): void => {
    const response = event.data;
    if (!isRecord(response) || !validRequestId(response.requestId)) return;
    const requestId = response.requestId;
    const pending = this.removePending(requestId);
    // A response from another run, a cancelled request, or a terminated
    // worker is intentionally ignored rather than applied to the next job.
    if (!pending) return;
    if (response.type === 'projected-endpoints') {
      if (!hasOnlyKeys(response, ['type', 'requestId', 'endpoints'])) {
        pending.reject(new MeasurementWorkerError('INVALID_RESPONSE', requestId, 'Measurement worker returned an invalid response.'));
        return;
      }
      const parsed = MeasurementEndpointsSchema.safeParse(response.endpoints);
      if (parsed.success) {
        pending.resolve(parsed.data);
        return;
      }
      pending.reject(new MeasurementWorkerError('INVALID_RESPONSE', requestId, 'Measurement worker returned invalid endpoints.'));
      return;
    }
    if (response.type === 'cancelled') {
      if (!hasOnlyKeys(response, ['type', 'requestId', 'code']) || response.code !== 'CANCELLED') {
        pending.reject(new MeasurementWorkerError('INVALID_RESPONSE', requestId, 'Measurement worker returned an invalid response.'));
        return;
      }
      pending.reject(new MeasurementWorkerError('CANCELLED', requestId, 'Measurement worker request was cancelled.'));
      return;
    }
    if (
      response.type !== 'error' ||
      !hasOnlyKeys(response, ['type', 'requestId', 'code', 'message']) ||
      !isWorkerErrorCode(response.code) ||
      typeof response.message !== 'string' ||
      response.message.length === 0
    ) {
      pending.reject(new MeasurementWorkerError('INVALID_RESPONSE', requestId, 'Measurement worker returned an invalid response.'));
      return;
    }
    const code: MeasurementWorkerErrorCode = response.code;
    pending.reject(new MeasurementWorkerError(code, requestId, response.message));
  };
}

export type { NormalizedPoint };
