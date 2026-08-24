import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import YAML from 'yaml';

process.env.FURIMA_LOCAL_FIXTURE_MODE = 'true';
process.env.FURIMA_STORAGE_MODE = 'memory';
process.env.FURIMA_D1_API_TOKEN = 'api-test-token';
process.env.FURIMA_D1_API_ACTOR_ID = 'buyer_01';
process.env.FURIMA_D1_CONTROL_TOKEN = 'control-test-token';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const execFileAsync = promisify(execFile);

test('Cloudflare docs CD deploys only for API docs source changes', async () => {
  const workflow = await read('.github/workflows/docs-cloudflare-pages.yml');

  assert.match(workflow, /detect_changes:/);
  assert.match(workflow, /fetch-depth:\s*2/);
  for (const sourcePath of [
    'docs/api',
    'docs/scalar-entry.js',
    'docs/site-entry.js',
    'docs/favicon.svg',
    'scripts/build-docs-site.mjs',
    'package.json',
    'package-lock.json',
  ]) {
    assert.match(workflow, new RegExp(sourcePath.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(workflow, /needs:\s*detect_changes/);
  assert.match(workflow, /needs\.detect_changes\.outputs\.deploy == 'true'/);
});

test('catalog HTTP handlers support pagination, item lookup, and ETag revalidation', async () => {
  const catalog = await import(new URL('../app/api/catalog/route.ts', import.meta.url).href);
  const itemRoute = await import(new URL('../app/api/catalog/[itemId]/route.ts', import.meta.url).href);

  const first = catalog.GET(new Request('http://localhost/api/catalog?limit=2&offset=0'));
  assert.equal(first.status, 200);
  const firstItems = await first.json();
  assert.equal(Array.isArray(firstItems), true);
  assert.equal(firstItems.length, 2);
  assert.equal(first.headers.get('x-catalog-limit'), '2');
  assert.equal(catalog.GET(new Request('http://localhost/api/catalog?limit=0')).status, 400);
  assert.equal(catalog.GET(new Request('http://localhost/api/catalog?limit=41')).status, 400);
  assert.equal(catalog.GET(new Request('http://localhost/api/catalog?offset=-1')).status, 400);
  assert.equal(catalog.GET(new Request('http://localhost/api/catalog?offset=not-an-integer')).status, 400);
  assert.equal(catalog.GET(new Request('http://localhost/api/catalog?offset=')).status, 400);
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
  assert.match(seed, /store\.put\(stateRecordFor\(id, engine\), 0, false\)/);
  assert.match(replay, /dispatchSandboxCommand/);
  assert.match(replay, /MAX_REPLAY_ACTIONS/);
  assert.match(runtime, /sandboxIdFrom/);
  assert.match(runtime, /authorizationFailure/);
  assert.match(openapiText, /sandboxId/);
  assert.match(openapiText, /stateVersion/);
  assert.deepEqual(openapi.paths['/api/sandbox/state'].get.security, [{ controlBearerAuth: [] }]);
  assert.deepEqual(openapi.paths['/api/sandbox/state'].put.security, [{ controlBearerAuth: [] }]);
  assert.deepEqual(openapi.paths['/api/sandbox/reset'].post.security, [{ controlBearerAuth: [] }]);
  assert.deepEqual(openapi.paths['/api/sandbox/preview'].post.security, [{ bearerAuth: [] }]);
  assert.equal(openapi.components.schemas.SandboxPreviewInput.properties.actorId, undefined);
  assert.equal(openapi.components.schemas.SandboxState.additionalProperties, false);
  for (const field of openapi.components.schemas.SandboxState.required) {
    assert.ok(openapi.components.schemas.SandboxState.properties[field], `SandboxState property missing: ${field}`);
  }
  assert.equal(openapi.components.schemas.SandboxCommitInput.properties.actorId, undefined);
  assert.ok(openapi.components.securitySchemes.controlBearerAuth);
});

test('Sandbox state GET requires control authorization before resolving an arbitrary sandbox', async () => {
  const route = await read('app/api/sandbox/state/route.ts');
  const runtimeSource = await read('app/api/sandbox/runtime.ts');
  assert.match(runtimeSource, /configuredToken = options\.requireControl \? runtimeEnv\.FURIMA_D1_CONTROL_TOKEN/);
  assert.match(route, /authorizationFailure\(request, \{ requireControl: true \}\)/);

  const moduleUrl = new URL('../app/api/sandbox/runtime.ts', import.meta.url).href;
  const script = `
    import { authorizationFailure } from ${JSON.stringify(moduleUrl)};
    const cases = [
      { name: 'missing', authorization: undefined },
      { name: 'empty', authorization: 'Bearer ' },
      { name: 'api-token', authorization: 'Bearer api-test-token' },
      { name: 'control-token', authorization: 'Bearer control-test-token' },
    ];
    const results = [];
    for (const candidate of cases) {
      const headers = candidate.authorization ? { authorization: candidate.authorization } : {};
      const response = await authorizationFailure(
        new Request('https://api.example.test/api/sandbox/state?id=other-sandbox', { headers }),
        { requireControl: true },
      );
      results.push({ name: candidate.name, status: response?.status ?? null });
    }
    console.log(JSON.stringify(results));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    env: {
      ...process.env,
      FURIMA_LOCAL_FIXTURE_MODE: 'false',
      FURIMA_STORAGE_MODE: 'd1',
      FURIMA_D1_API_TOKEN: 'api-test-token',
      FURIMA_D1_CONTROL_TOKEN: 'control-test-token',
    },
  });
  assert.deepEqual(JSON.parse(stdout.trim()), [
    { name: 'missing', status: 401 },
    { name: 'empty', status: 403 },
    { name: 'api-token', status: 403 },
    { name: 'control-token', status: null },
  ]);
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
    headers: { 'content-type': 'application/json', authorization: 'Bearer control-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', scenarioId: 'catalog_default', seed: 'http-contract-seed', idempotencyKey: 'http-reset-1' }),
  }));
  assert.equal(resetResponse.status, 200);
  const previewResponse = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', command: 'wallet.deposit', payload: { amount: 1000 }, idempotencyKey: 'http-preview-1' }),
  }));
  assert.equal(previewResponse.status, 200);
  const previewResult = await previewResponse.json();
  assert.equal(previewResult.ok, true);
  assert.equal(previewResult.meta.mode, 'preview');
  assert.equal(previewResult.meta.actorId, 'buyer_01');
  const commitBody = { sandboxId: 'http-contract', previewId: previewResult.data.previewId, idempotencyKey: 'http-commit-1' };
  const commitResponse = await commit.POST(new Request('http://localhost/api/sandbox/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify(commitBody),
  }));
  assert.equal(commitResponse.status, 200);
  const commitResult = await commitResponse.json();
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.meta.mode, 'commit');
  const repeatedResponse = await commit.POST(new Request('http://localhost/api/sandbox/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify(commitBody),
  }));
  assert.equal(repeatedResponse.status, 200);
  assert.deepEqual(await repeatedResponse.json(), commitResult);
  const insufficientFunds = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', command: 'wallet.withdraw', payload: { amount: 1000000 }, idempotencyKey: 'http-preview-insufficient-funds' }),
  }));
  assert.equal(insufficientFunds.status, 409);
  const healthResponse = await health.GET(new Request('http://localhost/api/sandbox/health?sandboxId=http-contract', { headers: { authorization: 'Bearer api-test-token' } }));
  assert.equal(healthResponse.status, 200);
  const healthResult = await healthResponse.json();
  assert.equal(healthResult.ok, true);
  assert.equal(healthResult.capabilities.idempotency, true);
  const malformed = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: '{malformed',
  }));
  assert.equal(malformed.status, 400);
  const malformedResult = await malformed.json();
  assert.equal(malformedResult.meta.mode, 'preview');
  const invalidVersion = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', command: 'wallet.deposit', payload: { amount: 1 }, expectedStateVersion: '1' }),
  }));
  assert.equal(invalidVersion.status, 400);
  const invalidPayload = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', command: 'wallet.deposit', payload: [] }),
  }));
  assert.equal(invalidPayload.status, 400);
  const invalidSeed = await reset.POST(new Request('http://localhost/api/sandbox/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer control-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', seed: 123, idempotencyKey: 'http-invalid-seed' }),
  }));
  assert.equal(invalidSeed.status, 400);
  const actorSpoof = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', actorId: 'seller_01', command: 'wallet.deposit', payload: { amount: 1 }, idempotencyKey: 'http-actor-spoof' }),
  }));
  assert.equal(actorSpoof.status, 400);
  assert.equal((await actorSpoof.json()).meta.actorId, 'buyer_01');
  const missingIdempotency = await commit.POST(new Request('http://localhost/api/sandbox/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', previewId: 'missing-preview' }),
  }));
  assert.equal(missingIdempotency.status, 400);
  const controlCharacterPreviewId = await commit.POST(new Request('http://localhost/api/sandbox/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', previewId: '\r', idempotencyKey: 'http-control-character-preview' }),
  }));
  assert.equal(controlCharacterPreviewId.status, 400);
  const controlCharacterKey = await preview.POST(new Request('http://localhost/api/sandbox/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer api-test-token' },
    body: JSON.stringify({ sandboxId: 'http-contract', command: 'wallet.deposit', payload: { amount: 1 }, idempotencyKey: '\u001f' }),
  }));
  assert.equal(controlCharacterKey.status, 400);
});

test('authenticated local fixture control traffic has an isolated test ceiling', async () => {
  const previous = process.env.FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH;
  process.env.FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH = 'true';
  try {
    const { authorizationFailure } = await import(new URL('../app/api/sandbox/runtime.ts', import.meta.url).href);
    for (let index = 0; index < 35; index += 1) {
      const failure = await authorizationFailure(new Request('http://localhost/api/sandbox/rate-limit-contract', {
        headers: { authorization: 'Bearer control-test-token' },
      }), { requireControl: true });
      assert.equal(failure, null);
    }
  } finally {
    if (previous === undefined) delete process.env.FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH;
    else process.env.FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH = previous;
  }
});
