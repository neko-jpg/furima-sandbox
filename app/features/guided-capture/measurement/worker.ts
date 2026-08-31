import type { MeasurementEndpoints, NormalizedPoint } from '../../../types/measurement';
import { projectMeasurementEndpoints, type Homography } from './geometry';

export interface MeasurementWorkerRequest {
  readonly type: 'project-endpoints';
  readonly endpoints: MeasurementEndpoints;
  readonly homography: Homography;
}

export interface MeasurementWorkerResponse {
  readonly type: 'projected-endpoints' | 'error';
  readonly endpoints?: MeasurementEndpoints;
  readonly message?: string;
}

export interface MeasurementWorkerPort {
  postMessage(message: MeasurementWorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<MeasurementWorkerResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<MeasurementWorkerResponse>) => void): void;
  terminate?(): void;
}

export function handleMeasurementWorkerRequest(request: MeasurementWorkerRequest): MeasurementWorkerResponse {
  if (request.type !== 'project-endpoints') return { type: 'error', message: 'Unsupported measurement worker request.' };
  try {
    return { type: 'projected-endpoints', endpoints: projectMeasurementEndpoints(request.endpoints, request.homography) };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : 'Measurement projection failed.' };
  }
}

export class MeasurementWorkerClient {
  private readonly worker: MeasurementWorkerPort;
  private requestId = 0;
  private pending = new Map<number, { resolve: (endpoints: MeasurementEndpoints) => void; reject: (error: Error) => void }>();

  public constructor(worker: MeasurementWorkerPort) {
    this.worker = worker;
    this.worker.addEventListener('message', this.handleMessage);
  }

  public project(endpoints: MeasurementEndpoints, homography: Homography): Promise<MeasurementEndpoints> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'project-endpoints', endpoints, homography });
    });
  }

  public terminate(): void {
    this.worker.removeEventListener('message', this.handleMessage);
    for (const pending of this.pending.values()) pending.reject(new Error('Measurement worker was terminated.'));
    this.pending.clear();
    this.worker.terminate?.();
  }

  private readonly handleMessage = (event: MessageEvent<MeasurementWorkerResponse>): void => {
    // The small worker protocol is intentionally single-flight; a caller can
    // still use multiple clients when it needs independent queues.
    const id = this.pending.keys().next().value as number | undefined;
    if (id === undefined) return;
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (!pending) return;
    if (event.data.type === 'projected-endpoints' && event.data.endpoints) pending.resolve(event.data.endpoints);
    else pending.reject(new Error(event.data.message ?? 'Measurement worker failed.'));
  };
}

export type { NormalizedPoint };
