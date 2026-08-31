import assert from 'node:assert/strict';
import test from 'node:test';
import { GuidedCaptureHttpAdapter, GuidedCaptureHttpError } from './httpAdapter.ts';

const endpointResponse = {
  lengthStart: { x: 0.5, y: 0.1 },
  lengthEnd: { x: 0.5, y: 0.9 },
  widthStart: { x: 0.2, y: 0.5 },
  widthEnd: { x: 0.8, y: 0.5 },
};

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const image = new Blob(['image'], { type: 'image/jpeg' });

test('HTTP adapter accepts the four-endpoint measurement response without confidence', async () => {
  const requests: Array<{ url: string; body?: BodyInit }> = [];
  const adapter = new GuidedCaptureHttpAdapter({
    baseUrl: 'http://127.0.0.1:3001/',
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), body: init?.body ?? undefined });
      if (String(input).endsWith('/api/health')) return jsonResponse({ status: 'ok' });
      return jsonResponse(endpointResponse);
    },
  });

  const connection = await adapter.connect('guided-session');
  assert.deepEqual(connection, { connectionState: 'connected', transport: 'fixture' });
  const draft = await adapter.suggestMeasurement({ sessionId: 'guided-session', blob: image });

  assert.deepEqual(draft.endpoints, endpointResponse);
  assert.equal(draft.lengthCm, null);
  assert.equal(draft.widthCm, null);
  assert.equal('confidence' in draft, false);
  assert.equal(requests.filter((request) => request.url.endsWith('/api/health')).length, 1);
  assert.equal(requests.filter((request) => request.url.endsWith('/api/suggest-measurement-points')).length, 1);
});

test('HTTP adapter rejects a measurement response that adds confidence to the strict wire object', async () => {
  const adapter = new GuidedCaptureHttpAdapter({
    baseUrl: 'http://127.0.0.1:3001',
    fetchImpl: async (input) => String(input).endsWith('/api/health')
      ? jsonResponse({ status: 'ok' })
      : jsonResponse({ ...endpointResponse, confidence: 0.9 }),
  });

  await adapter.connect('guided-session');
  await assert.rejects(
    adapter.suggestMeasurement({ sessionId: 'guided-session', blob: image }),
    (error: unknown) => error instanceof GuidedCaptureHttpError
      && error.status === 502
      && error.retryable,
  );
});

test('HTTP adapter maps a sidecar network failure to a retryable provider error', async () => {
  const adapter = new GuidedCaptureHttpAdapter({
    baseUrl: 'http://127.0.0.1:3001',
    fetchImpl: async () => { throw new TypeError('socket details must stay internal'); },
  });

  await assert.rejects(
    adapter.connect('guided-session'),
    (error: unknown) => error instanceof GuidedCaptureHttpError
      && error.status === 503
      && error.retryable
      && !error.message.includes('socket details'),
  );
});
