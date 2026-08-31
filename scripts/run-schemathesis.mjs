import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const port = Number(process.env.SCHEMATHESES_PORT ?? 3010);
const baseUrl = `http://127.0.0.1:${port}`;
const upstreamPort = port + 1;
const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
const apiToken = process.env.FURIMA_D1_API_TOKEN ?? 'schemathesis-api-token';
const controlToken = process.env.FURIMA_D1_CONTROL_TOKEN ?? 'schemathesis-control-token';
const outputDirectory = resolve('output/security');
const schemathesisEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); process.stdout.write(chunk); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
  child.once('error', reject);
  child.once('close', (code, signal) => resolvePromise({ code: code ?? 1, signal, stdout, stderr }));
});

const waitForServer = async (server) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`vinext start exited before readiness (code ${server.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/api/sandbox/health?sandboxId=schemathesis`);
      if (response.status < 500) return;
    } catch {
      // The dev server may need several seconds to load the Worker runtime.
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for the Schemathesis target server');
};

const schemathesisArguments = ({ token, include, exclude, excludeOperationId, excludeChecks, mode = 'all', phases, reportPath }) => [
  'run',
  'docs/api/openapi.yaml',
  '--url', baseUrl,
  '-H', `authorization: Bearer ${token}`,
  ...(include ? ['--include-path-regex', include] : []),
  ...(exclude ? ['--exclude-path-regex', exclude] : []),
  ...(excludeOperationId ? ['--exclude-operation-id', excludeOperationId] : []),
  '--mode', mode,
  '--phases', phases ?? (include ? 'examples,coverage,fuzzing' : 'examples,coverage,fuzzing,stateful'),
  '--max-examples', '10',
  '--generation-deterministic',
  // Schemathesis v4's ignored_auth check currently reuses the global -H
  // header for generated cases. The same auth contract is asserted below
  // with explicit missing/invalid-token requests.
  '--exclude-checks', ['ignored_auth', ...(excludeChecks ? excludeChecks.split(',') : [])].join(','),
  '--report', 'junit',
  '--report-junit-path', reportPath,
  '--no-color',
];

const schemathesisCommand = async () => {
  const configured = process.env.SCHEMATHESES_BIN;
  const candidates = configured
    ? [{ command: configured, prefix: [] }]
    : process.platform === 'win32'
      ? [{ command: 'schemathesis.exe', prefix: [] }, { command: 'schemathesis', prefix: [] }, { command: 'uvx.exe', prefix: ['schemathesis==4.25.0'] }, { command: 'uvx', prefix: ['schemathesis==4.25.0'] }]
      : [{ command: 'schemathesis', prefix: [] }, { command: 'uvx', prefix: ['schemathesis==4.25.0'] }];
  for (const candidate of candidates) {
    try {
      const probe = await run(candidate.command, [...candidate.prefix, '--version'], { env: schemathesisEnv });
      if (probe.code === 0) return candidate;
    } catch {
      // Try the next installed CLI/provider.
    }
  }
  throw new Error('Schemathesis is not installed. Install `schemathesis==4.25.0` or provide SCHEMATHESES_BIN.');
};

const runSuite = async (command, args) => {
  const result = await run(command, args, { env: schemathesisEnv });
  if (result.code !== 0) throw new Error(`Schemathesis failed with exit code ${result.code}${result.signal ? ` (${result.signal})` : ''}`);
};

await mkdir(outputDirectory, { recursive: true });
const serverEnv = {
  ...process.env,
  NODE_ENV: 'production',
  FURIMA_LOCAL_FIXTURE_MODE: 'true',
  FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH: 'true',
  FURIMA_STORAGE_MODE: 'memory',
  FURIMA_DEPLOYMENT_ENV: 'development',
  FURIMA_D1_API_TOKEN: apiToken,
  FURIMA_D1_API_ACTOR_ID: 'buyer_01',
  FURIMA_D1_CONTROL_TOKEN: controlToken,
};
const proxy = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400, { 'cache-control': 'no-store' });
    response.end();
    return;
  }
  // vinext's Node Request adapter rejects unsupported methods before route
  // dispatch. A real HTTP server should still return 405, so keep this
  // harness-level compatibility shim in front of the generated app.
  const supportedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
  const pathname = new URL(request.url, baseUrl).pathname;
  const routeMethods = pathname === '/api/catalog' || /^\/api\/catalog\/.+/u.test(pathname)
    ? ['GET']
    : pathname === '/api/sandbox/health'
      ? ['GET']
      : pathname === '/api/sandbox/preview' || pathname === '/api/sandbox/commit'
        ? ['POST']
        : pathname === '/api/sandbox/state'
          ? ['GET', 'PUT']
          : pathname === '/api/sandbox/reset' || pathname === '/api/sandbox/seed' || pathname === '/api/sandbox/replay'
            ? ['POST']
        : null;
  if (!supportedMethods.has(request.method ?? '') || (routeMethods && !routeMethods.includes(request.method ?? ''))) {
    response.writeHead(405, { Allow: routeMethods?.join(', ') ?? 'GET, POST, PUT, OPTIONS', 'cache-control': 'no-store' });
    response.end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  try {
    const upstreamResponse = await fetch(`${upstreamUrl}${request.url}`, {
      method: request.method,
      headers,
      body: chunks.length && request.method !== 'GET' && request.method !== 'HEAD' ? Buffer.concat(chunks) : undefined,
      duplex: 'half',
    });
    const body = Buffer.from(await upstreamResponse.arrayBuffer());
    const responseHeaders = new Headers(upstreamResponse.headers);
    // Node fetch transparently decodes compressed upstream responses while
    // preserving the encoding header. Do not advertise a stale encoding from
    // the proxy, or Schemathesis will attempt to decode the body a second time.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');
    responseHeaders.set('content-length', String(body.byteLength));
    response.writeHead(upstreamResponse.status, Object.fromEntries(responseHeaders.entries()));
    response.end(body);
  } catch (error) {
    response.writeHead(502, { 'cache-control': 'no-store', 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'TARGET_UNAVAILABLE', message: String(error) }));
  }
});

const server = spawn(process.execPath, [resolve('node_modules/vinext/dist/cli.js'), 'start', '--host', '127.0.0.1', '--port', String(upstreamPort)], {
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
server.stdout?.on('data', (chunk) => process.stdout.write(`[target] ${chunk}`));
server.stderr?.on('data', (chunk) => process.stderr.write(`[target] ${chunk}`));

try {
  await new Promise((resolvePromise, reject) => {
    proxy.once('error', reject);
    proxy.listen(port, '127.0.0.1', resolvePromise);
  });
  await waitForServer(server);
  const unauthenticatedHealth = await fetch(`${baseUrl}/api/sandbox/health?sandboxId=schemathesis`);
  if (unauthenticatedHealth.status !== 401) throw new Error(`Schemathesis target accepted an unauthenticated health request: ${unauthenticatedHealth.status}`);
  const seedResponse = await fetch(`${baseUrl}/api/sandbox/seed`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sandboxId: 'schemathesis', scenarioId: 'catalog_default', seed: 'schemathesis-seed-v1', idempotencyKey: 'schemathesis-seed-1' }),
  });
  if (!seedResponse.ok) throw new Error(`Schemathesis seed failed: ${seedResponse.status} ${await seedResponse.text()}`);
  const seeded = await seedResponse.json();
  const seededWallet = seeded.state?.wallets?.find((wallet) => wallet.actorId === 'buyer_01');
  if (!seededWallet || typeof seededWallet.availableBalance !== 'number') throw new Error('Schemathesis seed did not return the buyer wallet');

  const resetId = 'schemathesis-reset';
  const resetResponse = await fetch(`${baseUrl}/api/sandbox/reset`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sandboxId: resetId, scenarioId: 'catalog_default', seed: 'schemathesis-reset-seed-v1', idempotencyKey: 'schemathesis-reset-1' }),
  });
  const resetResult = await resetResponse.json();
  if (!resetResponse.ok || !resetResult.ok || resetResult.operation !== 'reset' || resetResult.state?.sandboxId !== resetId) {
    throw new Error(`Schemathesis reset smoke failed: ${resetResponse.status}`);
  }

  const replayId = 'schemathesis-replay';
  const replayInput = {
    sandboxId: replayId,
    scenarioId: 'catalog_default',
    seed: 'schemathesis-replay-seed-v1',
    actions: [{ command: 'depositWallet', payload: { amount: 1 }, idempotencyKey: 'schemathesis-replay-deposit-1' }],
  };
  const replayResponse = await fetch(`${baseUrl}/api/sandbox/replay`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(replayInput),
  });
  const replayResult = await replayResponse.json();
  const replayActionResult = replayResult.results?.[0];
  const replayWallet = replayResult.state?.wallets?.find((wallet) => wallet.actorId === replayActionResult?.data?.actorId);
  if (!replayResponse.ok || !replayResult.ok || replayResult.operation !== 'replay' || !replayActionResult?.ok || replayWallet?.availableBalance !== replayActionResult.data?.availableBalance) {
    throw new Error(`Schemathesis replay smoke failed: ${replayResponse.status}`);
  }
  const replayRetryResponse = await fetch(`${baseUrl}/api/sandbox/replay`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(replayInput),
  });
  const replayRetryResult = await replayRetryResponse.json();
  if (!replayRetryResponse.ok || JSON.stringify(replayRetryResult) !== JSON.stringify(replayResult)) {
    throw new Error(`Schemathesis replay retry was not idempotent: ${replayRetryResponse.status}`);
  }

  // Exercise the cross-request link explicitly. Generated commit cases cannot
  // guess a live previewId, so a green fuzz run alone does not prove that the
  // persistence-before-publish path works end to end.
  const previewResponse = await fetch(`${baseUrl}/api/sandbox/preview`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      sandboxId: 'schemathesis',
      command: 'wallet.deposit',
      payload: { amount: 1 },
      expectedStateVersion: seeded.stateVersion,
      idempotencyKey: 'schemathesis-linked-preview-1',
    }),
  });
  const previewResult = await previewResponse.json();
  if (!previewResponse.ok || !previewResult.ok || typeof previewResult.data?.previewId !== 'string') {
    throw new Error(`Schemathesis linked preview failed: ${previewResponse.status}`);
  }
  const commitInput = {
    sandboxId: 'schemathesis',
    previewId: previewResult.data.previewId,
    expectedStateVersion: previewResult.stateVersion,
    idempotencyKey: 'schemathesis-linked-commit-1',
  };
  const commitResponse = await fetch(`${baseUrl}/api/sandbox/commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(commitInput),
  });
  const commitResult = await commitResponse.json();
  if (!commitResponse.ok || !commitResult.ok || commitResult.stateVersion !== seeded.stateVersion + 1) {
    throw new Error(`Schemathesis linked commit failed: ${commitResponse.status}`);
  }
  const retryResponse = await fetch(`${baseUrl}/api/sandbox/commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(commitInput),
  });
  const retryResult = await retryResponse.json();
  if (!retryResponse.ok || JSON.stringify(retryResult) !== JSON.stringify(commitResult)) {
    throw new Error(`Schemathesis linked commit retry was not idempotent: ${retryResponse.status}`);
  }
  const persistedResponse = await fetch(`${baseUrl}/api/sandbox/state?id=schemathesis`, {
    headers: { authorization: `Bearer ${controlToken}` },
  });
  const persisted = await persistedResponse.json();
  const persistedWallet = persisted.wallets?.find((wallet) => wallet.actorId === 'buyer_01');
  if (!persistedResponse.ok || persisted.stateVersion !== commitResult.stateVersion || persistedWallet?.availableBalance !== seededWallet.availableBalance + 1) {
    throw new Error(`Schemathesis linked commit was not durable: ${persistedResponse.status}`);
  }
  const statePutResponse = await fetch(`${baseUrl}/api/sandbox/state?id=schemathesis`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${controlToken}`,
      'content-type': 'application/json',
      'if-match-state-version': String(persisted.stateVersion),
    },
    body: JSON.stringify(persisted),
  });
  const statePutResult = await statePutResponse.json();
  if (!statePutResponse.ok || !statePutResult.ok || statePutResult.sandboxId !== 'schemathesis' || statePutResult.stateVersion !== persisted.stateVersion) {
    throw new Error(`Schemathesis state PUT smoke failed: ${statePutResponse.status}`);
  }
  const unauthenticatedHealthAfterSeed = await fetch(`${baseUrl}/api/sandbox/health?sandboxId=schemathesis`);
  if (unauthenticatedHealthAfterSeed.status !== 401) throw new Error(`Schemathesis target lost auth after seed: ${unauthenticatedHealthAfterSeed.status}`);
  const protectedRequests = [
    ['GET', '/api/sandbox/health?sandboxId=schemathesis'],
    ['POST', '/api/sandbox/preview', { command: 'wallet.deposit', payload: { amount: 1000 }, idempotencyKey: 'auth-smoke-preview' }],
    ['POST', '/api/sandbox/commit', { previewId: 'missing-preview', idempotencyKey: 'auth-smoke-commit' }],
    ['GET', '/api/sandbox/state?id=schemathesis'],
    ['POST', '/api/sandbox/reset', { id: 'schemathesis', idempotencyKey: 'auth-smoke-reset' }],
    ['POST', '/api/sandbox/seed', { id: 'schemathesis', scenarioId: 'catalog_default', seed: 'auth-smoke-seed', idempotencyKey: 'auth-smoke-seed' }],
    ['POST', '/api/sandbox/replay', { id: 'schemathesis', actions: [{ command: 'depositWallet', idempotencyKey: 'auth-smoke-replay', payload: { amount: 1 } }] }],
  ];
  for (const [method, path, body] of protectedRequests) {
    const headers = body ? { 'content-type': 'application/json' } : undefined;
    const missing = await fetch(`${baseUrl}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (missing.status !== 401) throw new Error(`Missing auth was accepted for ${method} ${path}: ${missing.status}`);
    const invalidHeaders = { ...(headers ?? {}), authorization: 'Bearer definitely-invalid' };
    const invalid = await fetch(`${baseUrl}${path}`, { method, headers: invalidHeaders, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (invalid.status !== 403) throw new Error(`Invalid auth was not rejected for ${method} ${path}: ${invalid.status}`);
  }

  const command = await schemathesisCommand();
  const plannedPaths = '^/api/(listings|wallet|profile|follows)';
  const pythonServicePaths = '^/api/(livekit-token|analyze-shot|suggest-measurement-points|remove-background|generate-background)$';
  await runSuite(command.command, [...command.prefix, ...schemathesisArguments({
    token: apiToken,
    exclude: `^/api/sandbox/(state|reset|seed|replay|preview|commit)$|${plannedPaths}|${pythonServicePaths}`,
    phases: 'examples,coverage,fuzzing',
    reportPath: resolve(outputDirectory, 'schemathesis-data.xml'),
  })]);
  await runSuite(command.command, [...command.prefix, ...schemathesisArguments({
    token: apiToken,
    include: '^/api/sandbox/(preview|commit)$',
    mode: 'negative',
    phases: 'coverage,fuzzing',
    reportPath: resolve(outputDirectory, 'schemathesis-actions.xml'),
  })]);
  await runSuite(command.command, [...command.prefix, ...schemathesisArguments({
    token: controlToken,
    include: '^/api/sandbox/(state|reset|seed|replay)$',
    excludeOperationId: 'putSandboxState',
    // Control operations are stateful: a stateless generator cannot invent a
    // valid aggregate envelope or command payload chain. Their positive paths
    // are exercised explicitly above; generated cases focus on rejecting
    // malformed inputs without weakening response/schema checks.
    mode: 'negative',
    phases: 'coverage,fuzzing',
    // SandboxState is a domain envelope whose fields are validated together.
    // Schemathesis filters almost every stateless PUT candidate on Linux and
    // fails its health check before exercising responses. The positive PUT is
    // exercised explicitly above; malformed imports remain covered by the
    // unit/API contract suites.
    reportPath: resolve(outputDirectory, 'schemathesis-control.xml'),
  })]);
  await writeFile(resolve(outputDirectory, 'schemathesis-summary.json'), JSON.stringify({
    ok: true,
    baseUrl,
    checked: [
      'data-plane-generated',
      'action-plane-negative-generated',
      'control-plane-negative-generated',
      'control-positive-seed-reset-replay-state-put',
      'stateful-preview-commit-retry-get',
    ],
  }, null, 2));
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server), sleep(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (proxy.listening) {
    proxy.close();
    await Promise.race([once(proxy, 'close'), sleep(1000)]);
  }
}
