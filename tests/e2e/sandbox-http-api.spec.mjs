import { expect, test } from '@playwright/test';
import { TEST_CONTROL_HEADERS } from './_sandbox.mjs';

test('sandbox reset, seed, replay, and state APIs preserve deterministic contracts', async ({ request }) => {
  const id = `e2e-http-${Date.now()}`;
  const reset = await request.post('/api/sandbox/reset', { headers: TEST_CONTROL_HEADERS, data: { id, scenarioId: 'catalog_default', seed: 'http-contract-seed-v1' } });
  expect(reset.status()).toBe(200);
  const resetBody = await reset.json();
  expect(resetBody.ok).toBe(true);
  expect(resetBody.sandboxId).toBe(id);
  expect(resetBody.state.sandboxId).toBe(id);

  const seed = await request.post('/api/sandbox/seed', { headers: TEST_CONTROL_HEADERS, data: { id, scenarioId: 'catalog_default', seed: 'http-contract-seed-v2' } });
  expect(seed.status()).toBe(200);
  const seedBody = await seed.json();
  expect(seedBody.seed).toBe('http-contract-seed-v2');

  const replay = await request.post('/api/sandbox/replay', {
    data: {
      id,
      scenarioId: 'catalog_default',
      seed: 'http-contract-seed-v2',
      fromStored: true,
      actions: [
        { command: 'depositWallet', idempotencyKey: 'http-deposit-1', payload: { amount: 1 } },
        { command: 'depositWallet', idempotencyKey: 'http-deposit-1', payload: { amount: 1 } },
      ],
    },
    headers: TEST_CONTROL_HEADERS,
  });
  expect(replay.status()).toBe(200);
  const replayBody = await replay.json();
  expect(replayBody.ok).toBe(true);
  expect(replayBody.results).toHaveLength(2);
  expect(replayBody.results[0]).toEqual(replayBody.results[1]);
  expect(replayBody.results[0].meta.sandboxId).toBe(id);
  expect(replayBody.results[0].meta.actorId).toBe('platform');

  const state = await request.get(`/api/sandbox/state?id=${id}`, { headers: TEST_CONTROL_HEADERS });
  expect(state.status()).toBe(200);
  const stateBody = await state.json();
  expect(stateBody.sandboxId).toBe(id);
  expect(state.headers()['etag']).toBeTruthy();
  const notModified = await request.get(`/api/sandbox/state?id=${id}`, { headers: { ...TEST_CONTROL_HEADERS, 'if-none-match': state.headers()['etag'] } });
  expect(notModified.status()).toBe(304);

  const stalePut = await request.put(`/api/sandbox/state?id=${id}`, {
    headers: { ...TEST_CONTROL_HEADERS, 'if-match-state-version': String(Math.max(0, Number(stateBody.stateVersion) - 1)) },
    data: stateBody,
  });
  expect(stalePut.status()).toBe(409);
});
