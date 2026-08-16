import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('catalog HTTP handlers support pagination, item lookup, and ETag revalidation', async () => {
  const catalog = await import(new URL('../app/api/catalog/route.ts', import.meta.url).href);
  const itemRoute = await import(new URL('../app/api/catalog/[itemId]/route.ts', import.meta.url).href);

  const first = catalog.GET(new Request('http://localhost/api/catalog?limit=2&offset=0'));
  assert.equal(first.status, 200);
  const firstItems = await first.json();
  assert.equal(Array.isArray(firstItems), true);
  assert.equal(firstItems.length, 2);
  assert.equal(first.headers.get('x-catalog-limit'), '2');
  const etag = first.headers.get('etag');
  assert.ok(etag);

  const notModified = catalog.GET(new Request('http://localhost/api/catalog?limit=2&offset=0', { headers: { 'if-none-match': etag } }));
  assert.equal(notModified.status, 304);

  const item = itemRoute.GET(new Request(`http://localhost/api/catalog/${encodeURIComponent(firstItems[0].id)}`));
  assert.equal(item.status, 200);
  assert.equal((await item.json()).id, firstItems[0].id);
  const itemNotModified = itemRoute.GET(new Request(`http://localhost/api/catalog/${encodeURIComponent(firstItems[0].id)}`, { headers: { 'if-none-match': item.headers.get('etag') } }));
  assert.equal(itemNotModified.status, 304);
  assert.equal(itemRoute.GET(new Request('http://localhost/api/catalog/not-found')).status, 404);
});

test('HTTP sandbox routes and OpenAPI stay in one-to-one contract', async () => {
  const [openapiText, state, reset, seed, replay, runtime] = await Promise.all([
    read('docs/api/openapi.yaml'),
    read('app/api/sandbox/state/route.ts'),
    read('app/api/sandbox/reset/route.ts'),
    read('app/api/sandbox/seed/route.ts'),
    read('app/api/sandbox/replay/route.ts'),
    read('app/api/sandbox/runtime.ts'),
  ]);
  const openapi = YAML.parse(openapiText);
  for (const path of ['/api/catalog', '/api/catalog/{itemId}', '/api/sandbox/state', '/api/sandbox/reset', '/api/sandbox/seed', '/api/sandbox/replay']) {
    assert.ok(openapi.paths[path], `OpenAPI path missing: ${path}`);
  }
  assert.match(state, /storeForRequest/);
  assert.match(state, /if-match-state-version/);
  assert.match(state, /candidate\.sandboxId === sandboxId/);
  assert.match(reset, /createSeededEngine/);
  assert.match(seed, /store\.put\(stateRecordFor\(id, engine\), undefined, true\)/);
  assert.match(replay, /dispatchSandboxCommand/);
  assert.match(replay, /MAX_REPLAY_ACTIONS/);
  assert.match(runtime, /sandboxIdFrom/);
  assert.match(runtime, /authorizationFailure/);
  assert.match(openapiText, /sandboxId/);
  assert.match(openapiText, /stateVersion/);
});

test('D1 schema, state adapter, and API size/auth error contracts are present', async () => {
  const [schema, adapter, state, openapi, errors] = await Promise.all([
    read('db/schema.ts'),
    read('app/domain/sandboxStore.ts'),
    read('app/api/sandbox/state/route.ts'),
    read('docs/api/openapi.yaml'),
    read('docs/api/error-codes.md'),
  ]);
  for (const column of ['scenario_id', 'seed', 'state_version', 'virtual_now', 'payload', 'updated_at']) assert.match(schema, new RegExp(column));
  assert.match(adapter, /sandbox_states/);
  assert.match(adapter, /expectedStateVersion/);
  assert.match(state, /MAX_SANDBOX_REQUEST_BYTES/);
  assert.match(state, /AUTH_REQUIRED|authorizationFailure/);
  assert.match(openapi, /8MiB/);
  assert.match(errors, /D1利用不能は503/);
});

test('HTTP preview/commit/health share the durable command contract', async () => {
  const [reset, preview, commit, health] = await Promise.all([
    import(new URL('../app/api/sandbox/reset/route.ts', import.meta.url).href),
    import(new URL('../app/api/sandbox/preview/route.ts', import.meta.url).href),
    import(new URL('../app/api/sandbox/commit/route.ts', import.meta.url).href),
    import(new URL('../app/api/sandbox/health/route.ts', import.meta.url).href),
  ]);
  const resetResponse = await reset.POST(new Request('http://localhost/api/sandbox/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sandboxId: 'http-contract', scenarioId: 'catalog_default', seed: 'http-contract-seed' }),
  }));
  assert.equal(resetResponse.status, 200);
  const previewResponse = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sandboxId: 'http-contract', actorId: 'buyer_01', command: 'wallet.deposit', payload: { amount: 1000 }, idempotencyKey: 'http-preview-1' }),
  }));
  assert.equal(previewResponse.status, 200);
  const previewResult = await previewResponse.json();
  assert.equal(previewResult.ok, true);
  assert.equal(previewResult.meta.mode, 'preview');
  const commitBody = { sandboxId: 'http-contract', actorId: 'buyer_01', previewId: previewResult.data.previewId, idempotencyKey: 'http-commit-1' };
  const commitResponse = await commit.POST(new Request('http://localhost/api/sandbox/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(commitBody),
  }));
  assert.equal(commitResponse.status, 200);
  const commitResult = await commitResponse.json();
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.meta.mode, 'commit');
  const repeatedResponse = await commit.POST(new Request('http://localhost/api/sandbox/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(commitBody),
  }));
  assert.equal(repeatedResponse.status, 200);
  assert.deepEqual(await repeatedResponse.json(), commitResult);
  const healthResponse = await health.GET(new Request('http://localhost/api/sandbox/health?sandboxId=http-contract'));
  assert.equal(healthResponse.status, 200);
  const healthResult = await healthResponse.json();
  assert.equal(healthResult.ok, true);
  assert.equal(healthResult.capabilities.idempotency, true);
  const malformed = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{malformed',
  }));
  assert.equal(malformed.status, 400);
  const malformedResult = await malformed.json();
  assert.equal(malformedResult.meta.mode, 'preview');
});
