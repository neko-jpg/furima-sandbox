import { expect } from '@playwright/test';

export const TEST_API_HEADERS = { authorization: 'Bearer playwright-api-token' };
export const TEST_CONTROL_HEADERS = { authorization: 'Bearer playwright-control-token' };
const BROWSER_SANDBOX_ID = 'furima-demo-catalog-50';
const BROWSER_DATABASE_NAME = 'furima-sandbox-state-v1';
const controlSessions = new WeakMap();
let controlSessionSequence = 0;

export async function installPageGuards(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`http-${response.status()}: ${response.url()}`);
  });
  return errors;
}

export async function waitForBridge(page) {
  await page.waitForFunction(() => Boolean(window.__SHOP_API__ && window.__MERCARI_API__), undefined, { timeout: 30_000 });
  await page.evaluate(async () => {
    const api = window.__SHOP_API__;
    if (!api) throw new Error('BRIDGE_NOT_READY');
    const ready = await api.waitForReady();
    if (!ready.ok) throw new Error(ready.error);
  });
}

const endpointFor = (page, path) => new URL(path, page.url()).toString();

const sessionFor = (page, label = 'sandbox') => {
  const existing = controlSessions.get(page);
  if (existing) return existing;
  controlSessionSequence += 1;
  const normalized = label.replace(/[^A-Za-z0-9_-]/gu, '-').slice(0, 24) || 'sandbox';
  const session = { id: `e2e-${normalized}-${Date.now().toString(36)}-${controlSessionSequence.toString(36)}`, serverVersion: 0 };
  controlSessions.set(page, session);
  return session;
};

const responseJson = async (response, operation) => {
  const body = await response.json().catch(() => null);
  if (!response.ok()) throw new Error(`${operation} failed (${response.status()}): ${JSON.stringify(body)}`);
  return body;
};

const injectControlState = async (page, controlState, clearHistory = false) => {
  const browserState = structuredClone(controlState);
  browserState.sandboxId = BROWSER_SANDBOX_ID;
  await page.evaluate(async ({ databaseName, sandboxId, state, clear }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    try {
      const stores = clear ? ['states', 'commands', 'previews'] : ['states'];
      const transaction = database.transaction(stores, 'readwrite');
      transaction.objectStore('states').put({
        id: sandboxId,
        scenarioId: state.scenarioId,
        seed: state.seed,
        stateVersion: state.stateVersion,
        virtualNow: state.now,
        payload: JSON.stringify(state),
        updatedAt: new Date().toISOString(),
      });
      if (clear) {
        transaction.objectStore('commands').clear();
        transaction.objectStore('previews').clear();
      }
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      });
    } finally {
      database.close();
    }
  }, { databaseName: BROWSER_DATABASE_NAME, sandboxId: BROWSER_SANDBOX_ID, state: browserState, clear: clearHistory });
  await page.reload();
  await waitForBridge(page);
};

const readBrowserState = (page) => page.evaluate(async ({ databaseName, sandboxId }) => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  try {
    const transaction = database.transaction('states', 'readonly');
    const record = await new Promise((resolve, reject) => {
      const request = transaction.objectStore('states').get(sandboxId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
    return record?.payload ? JSON.parse(record.payload) : null;
  } finally {
    database.close();
  }
}, { databaseName: BROWSER_DATABASE_NAME, sandboxId: BROWSER_SANDBOX_ID });

const syncBrowserStateToControl = async (page, session) => {
  const browserState = await readBrowserState(page);
  if (!browserState) throw new Error('Browser sandbox state is missing');
  const controlState = structuredClone(browserState);
  controlState.sandboxId = session.id;
  const response = await page.context().request.put(endpointFor(page, `/api/sandbox/state?id=${encodeURIComponent(session.id)}`), {
    headers: { ...TEST_CONTROL_HEADERS, 'content-type': 'application/json', 'if-match-state-version': String(session.serverVersion) },
    data: controlState,
  });
  const body = await responseJson(response, 'control state sync');
  session.serverVersion = body.stateVersion;
};

const replayControlAction = async (page, session, command, payload) => {
  const response = await page.context().request.post(endpointFor(page, '/api/sandbox/replay'), {
    headers: TEST_CONTROL_HEADERS,
    data: {
      sandboxId: session.id,
      fromStored: true,
      actions: [{ command, payload, idempotencyKey: `harness-${command}-${Date.now()}-${Math.random().toString(36).slice(2)}` }],
    },
  });
  const body = await responseJson(response, `control ${command}`);
  session.serverVersion = body.stateVersion;
  return body.state;
};

export async function setSandboxActor(page, actorId) {
  const session = sessionFor(page);
  await syncBrowserStateToControl(page, session);
  const state = await replayControlAction(page, session, 'switchActor', { actorId });
  await injectControlState(page, state);
}

export async function loadSandboxScenario(page, scenarioId) {
  const session = sessionFor(page, scenarioId);
  const response = await page.context().request.post(endpointFor(page, '/api/sandbox/reset'), {
    headers: TEST_CONTROL_HEADERS,
    data: { sandboxId: session.id, scenarioId, seed: `${session.id}-${scenarioId}`, idempotencyKey: `harness-reset-${session.id}-${scenarioId}` },
  });
  const body = await responseJson(response, 'control scenario reset');
  session.serverVersion = body.stateVersion;
  await injectControlState(page, body.state, true);
}

export async function advanceSandboxClock(page, milliseconds) {
  if (!Number.isInteger(milliseconds) || milliseconds < 0) throw new Error('CLOCK_STEP_MUST_BE_NON_NEGATIVE_INTEGER');
  const session = sessionFor(page);
  await syncBrowserStateToControl(page, session);
  const state = await replayControlAction(page, session, 'advanceClock', { milliseconds });
  await injectControlState(page, state);
}

export async function resetSandbox(page, label = 'reset') {
  await waitForBridge(page);
  const session = sessionFor(page, label);
  const response = await page.context().request.post(endpointFor(page, '/api/sandbox/reset'), {
    headers: TEST_CONTROL_HEADERS,
    data: { sandboxId: session.id, scenarioId: 'catalog_default', seed: `${session.id}-catalog`, idempotencyKey: `harness-reset-${session.id}-catalog` },
  });
  const body = await responseJson(response, 'control reset');
  session.serverVersion = body.stateVersion;
  const sellerState = await replayControlAction(page, session, 'switchActor', { actorId: 'seller_01' });
  await injectControlState(page, sellerState, true);
}

export async function assertNoPageErrors(errors) {
  expect(errors, `browser errors:\n${errors.join('\n')}`).toEqual([]);
}
