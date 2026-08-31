import assert from 'node:assert/strict';
import test from 'node:test';
import { BackgroundEditProviderError, HttpBackgroundEditProvider } from './provider.ts';

test('sends only the allow-listed style id to background generation', async () => {
  let requestBody: Record<string, unknown> | null = null;
  const provider = new HttpBackgroundEditProvider({
    baseUrl: 'https://assistant.invalid/',
    fetchImpl: async (_input, init) => {
      if (!init?.body) throw new Error('request body missing');
      requestBody = JSON.parse(await new Response(init.body).text()) as Record<string, unknown>;
      return new Response(new Blob(['png']), { status: 200, headers: { 'content-type': 'image/png' } });
    },
    backgroundTimeoutMs: 100,
  });

  await provider.generateBackground('warm_neutral');

  assert.deepEqual(requestBody, { styleId: 'warm_neutral' });
});

test('maps a hanging mask request to a retryable timeout', async () => {
  let aborted = false;
  const provider = new HttpBackgroundEditProvider({
    baseUrl: 'https://assistant.invalid',
    fetchImpl: async (_input, init) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
      return await new Promise<Response>(() => undefined);
    },
    maskTimeoutMs: 5,
  });

  await assert.rejects(
    provider.removeBackground(new Blob(['front'], { type: 'image/jpeg' })),
    (error: unknown) => error instanceof BackgroundEditProviderError && error.retryable && error.message.includes('タイムアウト'),
  );
  assert.equal(aborted, true);
});

test('keeps provider error messages safe and marks server failures retryable', async () => {
  const provider = new HttpBackgroundEditProvider({
    baseUrl: 'https://assistant.invalid',
    fetchImpl: async () => new Response(JSON.stringify({ detail: { message: 'temporary outage' } }), { status: 503 }),
    backgroundTimeoutMs: 100,
  });

  await assert.rejects(
    provider.generateBackground('studio_white'),
    (error: unknown) => error instanceof BackgroundEditProviderError && error.retryable && error.message === 'temporary outage',
  );
});
