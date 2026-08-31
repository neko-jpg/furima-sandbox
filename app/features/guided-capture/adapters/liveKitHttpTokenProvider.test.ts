import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { LiveKitHttpTokenProvider, LiveKitTokenProviderError } from './liveKitHttpTokenProvider.ts';

const response = (body: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
  ...init,
});
test('LiveKitHttpTokenProvider sends only the session id and validates token metadata', async () => {
  let request: RequestInit | undefined;
  const provider = new LiveKitHttpTokenProvider({
    baseUrl: 'http://127.0.0.1:3001/',
    fetchImpl: async (_input, init) => {
      request = init;
      return response({ token: 'short-token', participantIdentity: 'browser-1', roomName: 'guided-1', expiresAt: 1_900_000_000, livekitUrl: 'wss://livekit.example' });
    },
  });

  const token = await provider.getToken('guided-1');
  assert.equal(token.expiresAt, 1_900_000_000);
  assert.equal(request?.method, 'POST');
  assert.equal(request?.credentials, 'omit');
  assert.deepEqual(JSON.parse(String(request?.body)), { sessionId: 'guided-1' });
});

test('LiveKitHttpTokenProvider rejects malformed or non-secure responses', async () => {
  const provider = new LiveKitHttpTokenProvider({
    baseUrl: 'http://assistant.test',
    fetchImpl: async () => response({ token: 'token', participantIdentity: 'browser', roomName: 'room', expiresAt: 'tomorrow', livekitUrl: 'http://not-secure' }),
  });
  await assert.rejects(() => provider.getToken('guided-1'), (error: unknown) => error instanceof LiveKitTokenProviderError && !error.retryable);
});

test('LiveKitHttpTokenProvider maps provider failures without exposing credentials', async () => {
  const provider = new LiveKitHttpTokenProvider({
    baseUrl: 'http://assistant.test',
    fetchImpl: async () => response({ detail: { message: 'LiveKit接続情報を取得できません。' } }, { status: 503 }),
  });
  await assert.rejects(() => provider.getToken('guided-1'), (error: unknown) => error instanceof LiveKitTokenProviderError && error.message === 'LiveKit接続情報を取得できません。');
});
