import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleMarkerWorkerRequest,
  MarkerWorkerError,
  MeasurementMarkerWorkerClient,
  type MarkerWorkerRequest,
  type MarkerWorkerResponse,
} from './markerWorker.ts';

class FakeMarkerWorker {
  private listener: ((event: MessageEvent<MarkerWorkerResponse>) => void) | null = null;
  public readonly requests: MarkerWorkerRequest[] = [];
  public terminated = false;

  public postMessage(request: MarkerWorkerRequest): void {
    this.requests.push(request);
  }

  public addEventListener(_type: 'message', listener: (event: MessageEvent<MarkerWorkerResponse>) => void): void {
    this.listener = listener;
  }

  public removeEventListener(): void {
    this.listener = null;
  }

  public terminate(): void {
    this.terminated = true;
  }

  public emit(response: MarkerWorkerResponse): void {
    this.listener?.({ data: response } as MessageEvent<MarkerWorkerResponse>);
  }
}

test('marker worker rejects malformed input and records cancellation', async () => {
  const invalid = await handleMarkerWorkerRequest({ type: 'detect-marker', requestId: 'x', image: {} });
  assert.equal(invalid.type, 'error');
  if (invalid.type === 'error') assert.equal(invalid.code, 'INVALID_REQUEST');

  const cancelled = await handleMarkerWorkerRequest({ type: 'cancel', requestId: 'marker-cancel' });
  assert.deepEqual(cancelled, { type: 'cancelled', requestId: 'marker-cancel', code: 'CANCELLED' });
});

test('marker worker client fences cancelled and late responses', async () => {
  const worker = new FakeMarkerWorker();
  const client = new MeasurementMarkerWorkerClient(worker);
  const promise = client.detect({ width: 2, height: 2, data: new Uint8Array(16) });
  assert.equal(worker.requests[0]?.type, 'detect-marker');
  assert.equal(client.cancel('marker-1'), true);
  await assert.rejects(promise, (error: unknown) => error instanceof MarkerWorkerError && error.code === 'CANCELLED');

  worker.emit({
    type: 'marker-detected',
    requestId: 'marker-1',
    result: { ok: false, code: 'MARKER_MISSING', message: 'missing' },
  });
  client.terminate();
  assert.equal(worker.terminated, true);
});

test('marker worker projects a bounded RGBA analysis image', async () => {
  const response = await handleMarkerWorkerRequest({
    type: 'project-image',
    requestId: 'marker-project',
    image: { width: 2, height: 2, data: new ArrayBuffer(16) },
    homography: { values: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    markerSidePx: 32,
  });
  assert.equal(response.type, 'image-projected');
  if (response.type === 'image-projected') {
    assert.equal(response.image.width, 33);
    assert.equal(response.image.height, 33);
    assert.equal(response.image.data.byteLength, 33 * 33 * 4);
  }
});
