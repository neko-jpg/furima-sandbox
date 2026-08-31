import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const executable = process.platform === 'win32' ? 'uv.exe' : 'uv';
const playwrightCli = resolve(root, 'node_modules/@playwright/test/cli.js');
const vinextCli = resolve(root, 'node_modules/vinext/dist/cli.js');

const fail = (message) => {
  throw new Error(`[qa:e2e:fixture] ${message}`);
};

const parsePort = (value) => {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65_535 ? port : null;
};

const reservePort = (environmentName) => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(parsePort(process.env[environmentName]) ?? 0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('could not reserve a local TCP port'));
      return;
    }
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const waitForHealth = async (url, child) => {
  let lastError = 'health endpoint did not become ready';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) fail(`fixture backend exited before health check (code=${child.exitCode ?? 'null'})`);
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2_000) });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.status === 'ok') return;
      lastError = `health returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  fail(lastError);
};

const waitForHttp = async (url, child) => {
  let lastError = 'UI did not become ready';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) fail(`UI exited before readiness check (code=${child.exitCode ?? 'null'})`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = `UI returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  fail(lastError);
};

const stopProcessTree = (child) => {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
};

const externalNames = [
  'OPENAI_API_KEY',
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'BACKGROUND_GENERATOR_URL',
  'REMBG_URL',
];

const fixtureEnvironment = (apiPort, uiOrigin) => {
  const environment = {
    ...process.env,
    PROVIDER_MODE: 'fixture',
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    ASSISTANT_CORS_ORIGINS: `${uiOrigin},http://localhost:3001`,
    FURIMA_LOCAL_FIXTURE_MODE: 'true',
    FURIMA_STORAGE_MODE: 'memory',
    VITE_LISTING_ASSISTANT_MODE: 'fixture',
    VITE_LISTING_ASSISTANT_API_URL: `http://127.0.0.1:${apiPort}`,
    PLAYWRIGHT_BASE_URL: uiOrigin,
    PLAYWRIGHT_SKIP_WEBSERVER: '1',
    // These are deterministic test-only values consumed by the local sandbox
    // auth gate. They are never printed or sent to the assistant service.
    FURIMA_D1_API_TOKEN: 'playwright-api-token',
    FURIMA_D1_API_ACTOR_ID: 'buyer_01',
    FURIMA_D1_CONTROL_TOKEN: 'playwright-control-token',
  };
  for (const name of externalNames) environment[name] = '';
  return environment;
};

const main = async () => {
  if (!existsSync(playwrightCli) || !existsSync(vinextCli)) fail('UI/Playwright dependencies are not installed; run npm ci first');

  const apiPort = await reservePort('ASSISTANT_FIXTURE_API_PORT');
  const uiPort = await reservePort('ASSISTANT_FIXTURE_UI_PORT');
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const uiOrigin = `http://localhost:${uiPort}`;
  const uiUrl = uiOrigin;
  process.env.ASSISTANT_FIXTURE_UI_PORT = String(uiPort);
  const environment = fixtureEnvironment(apiPort, uiOrigin);
  const backend = spawn(executable, [
    'run', '--frozen', '--no-sync', 'python', '-m', 'services.listing_photo_assistant.server',
  ], {
    cwd: root,
    env: environment,
    stdio: 'ignore',
    windowsHide: true,
  });
  let ui;

  try {
    await waitForHealth(apiUrl, backend);
    ui = spawn(process.execPath, [vinextCli, 'dev', '--host', 'localhost', '--port', String(uiPort)], {
      cwd: root,
      env: environment,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForHttp(`${uiUrl}/`, ui);
    console.log(`[qa:e2e:fixture] backend=fixture ready; api=loopback:${apiPort}; ui=loopback:${uiPort}; external providers=disabled`);
    const result = spawnSync(process.execPath, [playwrightCli,
      'test',
      'tests/e2e/listing-photo-assistant-fixture.spec.mjs',
      '--project=chromium-desktop',
      '--workers=1',
      '--trace=off',
      '--reporter=list',
    ], {
      cwd: root,
      env: environment,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });
    if (result.error) fail(`failed to start Playwright: ${result.error.message}`);
    process.exitCode = result.status ?? 1;
  } finally {
    stopProcessTree(ui);
    stopProcessTree(backend);
  }
};

const handleSignal = (signal) => {
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
};
process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));

try {
  await main();
} catch (error) {
  console.error(`[qa:e2e:fixture] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
