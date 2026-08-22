import { CATALOG_ITEMS } from '../../data/catalogData.ts';
import { INITIAL_NOTIFICATIONS } from '../../data/initialData.ts';
import { SandboxEngine, createTrustedPrincipal, SANDBOX_SCENARIOS } from '../../domain/sandboxEngine.ts';
import { D1SandboxStateStore, MemorySandboxStateStore, type SandboxStateRecord, type SandboxStateStore } from '../../domain/sandboxStore.ts';
import type { AgentActionOptions, ExecutionPrincipal } from '../../types/mercari.ts';

interface RuntimeEnv {
  DB?: unknown;
  FURIMA_D1_API_TOKEN?: string;
  FURIMA_D1_CONTROL_TOKEN?: string;
  FURIMA_LOCAL_FIXTURE_MODE?: string;
  FURIMA_STORAGE_MODE?: string;
  FURIMA_DEPLOYMENT_ENV?: string;
}

export type SandboxStorageMode = 'memory' | 'd1';

export const DEFAULT_SANDBOX_ID = 'furima-demo';
export const MAX_SANDBOX_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_REPLAY_ACTIONS = 200;
export const SANDBOX_CONTROL_PRINCIPAL: ExecutionPrincipal = createTrustedPrincipal({
  subjectId: 'sandbox-control-token',
  actorId: 'platform',
  roles: ['platform'],
  scopes: ['sandbox-control', 'operator'],
});
export const SANDBOX_CONTROL_OPTIONS = { principal: SANDBOX_CONTROL_PRINCIPAL } as const;
export const LOCAL_SANDBOX_CONTROL_PRINCIPAL: ExecutionPrincipal = createTrustedPrincipal({
  subjectId: 'localhost-sandbox-control',
  actorId: 'platform',
  roles: ['platform'],
  scopes: ['sandbox-control', 'operator'],
});

const rateLimitBuckets = new Map<string, { windowStartedAt: number; count: number }>();
const memoryStore = new MemorySandboxStateStore();
const localFixtureRequests = new WeakSet<Request>();

const processRuntimeEnv = (): RuntimeEnv => {
  const environment = typeof process === 'undefined' ? undefined : process.env;
  return {
    FURIMA_D1_API_TOKEN: environment?.FURIMA_D1_API_TOKEN,
    FURIMA_D1_CONTROL_TOKEN: environment?.FURIMA_D1_CONTROL_TOKEN,
    FURIMA_LOCAL_FIXTURE_MODE: environment?.FURIMA_LOCAL_FIXTURE_MODE,
    FURIMA_STORAGE_MODE: environment?.FURIMA_STORAGE_MODE,
    FURIMA_DEPLOYMENT_ENV: environment?.FURIMA_DEPLOYMENT_ENV ?? environment?.NODE_ENV,
  };
};

const runtimeEnvPromise: Promise<RuntimeEnv | null> = import('cloudflare:workers')
  .then((module) => module.env as RuntimeEnv)
  .catch(() => null);

const runtimeEnvForRequest = async (): Promise<RuntimeEnv> => (await runtimeEnvPromise) ?? processRuntimeEnv();

const isLocalFixtureMode = (runtimeEnv: Pick<RuntimeEnv, 'FURIMA_LOCAL_FIXTURE_MODE'>): boolean => runtimeEnv.FURIMA_LOCAL_FIXTURE_MODE === 'true';
const localFixtureHostnames = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const isDeployedEnvironment = (value: string | undefined): boolean => value === 'production' || value === 'staging';

const storageModeFor = (runtimeEnv: Pick<RuntimeEnv, 'FURIMA_STORAGE_MODE'>): SandboxStorageMode => {
  const mode = runtimeEnv.FURIMA_STORAGE_MODE;
  if (mode === 'memory' || mode === 'd1') return mode;
  throw new Error('FURIMA_STORAGE_MODE must be set to memory or d1');
};

const validateRuntimeEnvironment = (runtimeEnv: RuntimeEnv): SandboxStorageMode => {
  const mode = storageModeFor(runtimeEnv);
  if (isDeployedEnvironment(runtimeEnv.FURIMA_DEPLOYMENT_ENV) && isLocalFixtureMode(runtimeEnv)) throw new Error('LOCAL_FIXTURE_FORBIDDEN_IN_DEPLOYED_ENV');
  if (mode === 'memory' && !isLocalFixtureMode(runtimeEnv)) throw new Error('MEMORY_STORAGE_REQUIRES_LOCAL_FIXTURE_MODE');
  return mode;
};

export const isLocalFixtureEnabled = async (): Promise<boolean> => isLocalFixtureMode(await runtimeEnvForRequest());

export const isLocalFixtureRequest = async (request: Request): Promise<boolean> => {
  const runtimeEnv = await runtimeEnvForRequest();
  return isLocalFixtureMode(runtimeEnv) && localFixtureHostnames.has(new URL(request.url).hostname);
};

export const storageModeForRuntime = async (): Promise<SandboxStorageMode> => storageModeFor(await runtimeEnvForRequest());

export const storeForEnvironment = (runtimeEnv: RuntimeEnv): SandboxStateStore => {
  const mode = validateRuntimeEnvironment(runtimeEnv);
  if (mode === 'memory') {
    return memoryStore;
  }
  if (!runtimeEnv.DB) throw new Error('D1_UNAVAILABLE');
  return new D1SandboxStateStore(runtimeEnv.DB as never);
};

export const storeForRequest = async (): Promise<SandboxStateStore> => {
  return storeForEnvironment(await runtimeEnvForRequest());
};

const requestIdFor = (request?: Request): string => {
  const supplied = request?.headers.get('x-request-id');
  if (supplied && /^[A-Za-z0-9._:-]{1,100}$/u.test(supplied)) return supplied;
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `req-${Date.now().toString(36)}`;
};

export const authConfiguration = async (): Promise<{ apiConfigured: boolean; controlConfigured: boolean }> => {
  const runtimeEnv = await runtimeEnvForRequest();
  return { apiConfigured: Boolean(runtimeEnv.FURIMA_D1_API_TOKEN), controlConfigured: Boolean(runtimeEnv.FURIMA_D1_CONTROL_TOKEN) };
};

const rateLimitFailure = (request: Request, limit: number): Response | null => {
  const now = Date.now();
  const source = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? new URL(request.url).hostname;
  const key = `${new URL(request.url).pathname}:${source}`;
  const previous = rateLimitBuckets.get(key);
  const bucket = !previous || now - previous.windowStartedAt >= 60_000 ? { windowStartedAt: now, count: 0 } : previous;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (rateLimitBuckets.size > 10_000) {
    for (const [candidate, value] of rateLimitBuckets) if (now - value.windowStartedAt >= 60_000) rateLimitBuckets.delete(candidate);
  }
  if (bucket.count <= limit) return null;
  const requestId = requestIdFor(request);
  return Response.json({ ok: false, error: 'RATE_LIMITED', requestId, details: { retryable: true, limit, windowSeconds: 60 } }, {
    status: 429,
    headers: { 'cache-control': 'no-store', 'retry-after': '60', 'x-request-id': requestId },
  });
};

export const authorizationFailure = async (request: Request, options: { requireControl?: boolean } = {}): Promise<Response | null> => {
  const runtimeEnv = await runtimeEnvForRequest();
  try {
    validateRuntimeEnvironment(runtimeEnv);
  } catch {
    return Response.json({ ok: false, error: 'RUNTIME_MISCONFIGURED', details: { retryable: false } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (isLocalFixtureMode(runtimeEnv) && localFixtureHostnames.has(new URL(request.url).hostname)) {
    localFixtureRequests.add(request);
    return rateLimitFailure(request, options.requireControl ? 30 : 120);
  }
  const configuredToken = options.requireControl ? runtimeEnv.FURIMA_D1_CONTROL_TOKEN : runtimeEnv.FURIMA_D1_API_TOKEN;
  if (!configuredToken) return Response.json({ ok: false, error: 'AUTH_NOT_CONFIGURED', details: { retryable: false } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  const authorization = request.headers.get('authorization');
  const requestId = requestIdFor(request);
  if (!authorization) return Response.json({ ok: false, error: 'AUTH_REQUIRED', requestId, details: { retryable: true } }, { status: 401, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  const expected = `Bearer ${configuredToken}`;
  let difference = authorization.length ^ expected.length;
  const length = Math.max(authorization.length, expected.length);
  for (let index = 0; index < length; index += 1) difference |= (authorization.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  if (difference !== 0) return Response.json({ ok: false, error: 'FORBIDDEN', requestId, details: { retryable: false } }, { status: 403, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  return rateLimitFailure(request, options.requireControl ? 30 : 120);
};

export const failure = (message: string, status: number, details?: unknown): Response => {
  const requestId = requestIdFor();
  return Response.json({ ok: false, error: message, requestId, ...(details === undefined ? {} : { details }) }, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
};

export const hasJsonContentType = (request: Request): boolean => {
  const contentType = request.headers.get('content-type');
  return Boolean(contentType && /^application\/json(?:\s*;|$)/iu.test(contentType));
};

export const sandboxIdFrom = (request: Request, body?: Record<string, unknown>): string | null => {
  const value = body?.sandboxId ?? body?.id ?? new URL(request.url).searchParams.get('sandboxId') ?? new URL(request.url).searchParams.get('id') ?? DEFAULT_SANDBOX_ID;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value) ? value : null;
};

export const actionFailure = (request: Request, body: Record<string, unknown> | undefined, mode: 'preview' | 'commit', error: string, status: number, stateVersion = 0, details?: unknown): Response => {
  const sandboxId = sandboxIdFrom(request, body) ?? DEFAULT_SANDBOX_ID;
  const actorId = typeof body?.actorId === 'string' && body.actorId ? body.actorId : 'unknown';
  const requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
  const commandId = typeof body?.commandId === 'string' ? body.commandId : undefined;
  const operationId = typeof body?.operationId === 'string' && body.operationId
    ? body.operationId
    : idempotencyKey ?? requestId ?? commandId ?? `${mode}:${sandboxId}:${requestId ?? 'request'}`;
  const correlationId = requestIdFor(request);
  return Response.json({
    ok: false,
    error,
    requestId: correlationId,
    stateVersion,
    meta: { sandboxId, actorId, stateVersion, operationId, mode, ...(requestId ? { requestId } : {}), ...(idempotencyKey ? { idempotencyKey } : {}), ...(commandId ? { commandId } : {}) },
    ...(details === undefined ? {} : { details }),
  }, { status, headers: { 'cache-control': 'no-store', 'x-request-id': correlationId } });
};

export const readJson = async (request: Request): Promise<Record<string, unknown> | null> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_SANDBOX_REQUEST_BYTES) return null;
  let raw = '';
  if (!request.body) {
    raw = await request.text();
  } else {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          raw += decoder.decode();
          break;
        }
        bytes += chunk.value.byteLength;
        if (bytes > MAX_SANDBOX_REQUEST_BYTES) {
          await reader.cancel();
          return null;
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_SANDBOX_REQUEST_BYTES) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

export const scenarioFrom = (value: unknown): string => typeof value === 'string' && SANDBOX_SCENARIOS.includes(value as never) ? value : 'catalog_default';

export const createSeededEngine = (sandboxId: string, scenarioId = 'catalog_default', seed = `${scenarioId}-seed-v1`): SandboxEngine => {
  const engine = new SandboxEngine(CATALOG_ITEMS, { sandboxId, seed, notifications: INITIAL_NOTIFICATIONS });
  if (scenarioId !== 'catalog_default' || seed !== 'catalog_default-seed-v1') {
    const result = engine.loadScenario(scenarioId as never, { ...SANDBOX_CONTROL_OPTIONS, seed });
    if (!result.ok) throw new Error(result.error);
  }
  return engine;
};

export const engineFromRecord = (sandboxId: string, record: SandboxStateRecord | null): SandboxEngine => {
  const engine = createSeededEngine(sandboxId);
  if (record) {
    const imported = engine.importState(record.payload, SANDBOX_CONTROL_OPTIONS);
    if (!imported.ok) throw new Error('INVALID_STATE');
  }
  return engine;
};

export const stateRecordFor = (sandboxId: string, engine: SandboxEngine, updatedAt = new Date().toISOString()): SandboxStateRecord => {
  const snapshot = engine.getSnapshot();
  return {
    id: sandboxId,
    scenarioId: snapshot.scenarioId,
    seed: snapshot.seed,
    stateVersion: snapshot.stateVersion,
    virtualNow: snapshot.now,
    payload: engine.exportState(),
    updatedAt,
  };
};

export const statePayloadFor = (engine: SandboxEngine): Record<string, unknown> => JSON.parse(engine.exportState()) as Record<string, unknown>;

export const principalForRequest = (request: Request): ExecutionPrincipal | undefined => localFixtureRequests.has(request) ? undefined : SANDBOX_CONTROL_PRINCIPAL;

export const controlPrincipalForRequest = (request: Request): ExecutionPrincipal => localFixtureRequests.has(request)
  ? LOCAL_SANDBOX_CONTROL_PRINCIPAL
  : SANDBOX_CONTROL_PRINCIPAL;

export const actionOptionsFor = (input: Record<string, unknown>, actorId?: string, principal?: ExecutionPrincipal): AgentActionOptions => ({
  // actorId in a remote JSON body is untrusted. A local fixture may retain the
  // legacy selector for tests and development, while production is bound to
  // the principal established by authorizationFailure.
  actorId: principal?.actorId ?? (typeof input.actorId === 'string' ? input.actorId : actorId),
  principal,
  idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined,
  requestId: typeof input.requestId === 'string' ? input.requestId : undefined,
  commandId: typeof input.commandId === 'string' ? input.commandId : undefined,
  // `stateVersion` is the public Agent contract. Keep accepting the older
  // explicit name so existing callers can migrate without changing behavior.
  expectedStateVersion: Number.isInteger(input.expectedStateVersion)
    ? Number(input.expectedStateVersion)
    : Number.isInteger(input.stateVersion) ? Number(input.stateVersion) : undefined,
  sandboxId: typeof input.sandboxId === 'string' ? input.sandboxId : undefined,
  scope: principal ? 'sandbox-control' : input.scope === 'sandbox-control' || input.scope === 'operator' ? input.scope : 'user',
});
