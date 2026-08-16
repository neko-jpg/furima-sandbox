import { INITIAL_ITEMS, INITIAL_NOTIFICATIONS } from '../../data/initialData.ts';
import { SandboxEngine, SANDBOX_SCENARIOS } from '../../domain/sandboxEngine.ts';
import { D1SandboxStateStore, MemorySandboxStateStore, type SandboxStateRecord, type SandboxStateStore } from '../../domain/sandboxStore.ts';
import type { AgentActionOptions } from '../../types/mercari.ts';

interface RuntimeEnv {
  DB?: unknown;
  FURIMA_D1_API_TOKEN?: string;
}

export const DEFAULT_SANDBOX_ID = 'furima-demo';
export const MAX_SANDBOX_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_REPLAY_ACTIONS = 200;
export const SANDBOX_CONTROL_OPTIONS = { actorId: 'platform', scope: 'sandbox-control' } as const;

const localFixtureHostnames = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const memoryStore = new MemorySandboxStateStore();
const runtimeEnvPromise: Promise<RuntimeEnv> = import('cloudflare:workers')
  .then((module) => module.env as RuntimeEnv)
  .catch(() => ({}));

export const storeForRequest = async (): Promise<SandboxStateStore> => {
  const database = (await runtimeEnvPromise).DB;
  return database ? new D1SandboxStateStore(database as never) : memoryStore;
};

export const authorizationFailure = async (request: Request): Promise<Response | null> => {
  const hostname = new URL(request.url).hostname;
  if (localFixtureHostnames.has(hostname)) return null;
  const configuredToken = (await runtimeEnvPromise).FURIMA_D1_API_TOKEN;
  if (!configuredToken) return Response.json({ ok: false, error: 'AUTH_NOT_CONFIGURED', details: { retryable: false } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  const authorization = request.headers.get('authorization');
  if (!authorization) return Response.json({ ok: false, error: 'AUTH_REQUIRED', details: { retryable: true } }, { status: 401, headers: { 'cache-control': 'no-store' } });
  if (authorization !== `Bearer ${configuredToken}`) return Response.json({ ok: false, error: 'FORBIDDEN', details: { retryable: false } }, { status: 403, headers: { 'cache-control': 'no-store' } });
  return null;
};

export const failure = (message: string, status: number, details?: unknown): Response => Response.json({ ok: false, error: message, ...(details === undefined ? {} : { details }) }, { status, headers: { 'cache-control': 'no-store' } });

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
  return Response.json({
    ok: false,
    error,
    stateVersion,
    meta: { sandboxId, actorId, stateVersion, operationId, mode, ...(requestId ? { requestId } : {}), ...(idempotencyKey ? { idempotencyKey } : {}), ...(commandId ? { commandId } : {}) },
    ...(details === undefined ? {} : { details }),
  }, { status, headers: { 'cache-control': 'no-store' } });
};

export const readJson = async (request: Request): Promise<Record<string, unknown> | null> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_SANDBOX_REQUEST_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_SANDBOX_REQUEST_BYTES) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

export const scenarioFrom = (value: unknown): string => typeof value === 'string' && SANDBOX_SCENARIOS.includes(value as never) ? value : 'catalog_default';

export const createSeededEngine = (sandboxId: string, scenarioId = 'catalog_default', seed = `${scenarioId}-seed-v1`): SandboxEngine => {
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId, seed, notifications: INITIAL_NOTIFICATIONS });
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

export const actionOptionsFor = (input: Record<string, unknown>, actorId?: string): AgentActionOptions => ({
  actorId: typeof input.actorId === 'string' ? input.actorId : actorId,
  idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined,
  requestId: typeof input.requestId === 'string' ? input.requestId : undefined,
  commandId: typeof input.commandId === 'string' ? input.commandId : undefined,
  // `stateVersion` is the public Agent contract. Keep accepting the older
  // explicit name so existing callers can migrate without changing behavior.
  expectedStateVersion: Number.isInteger(input.expectedStateVersion)
    ? Number(input.expectedStateVersion)
    : Number.isInteger(input.stateVersion) ? Number(input.stateVersion) : undefined,
  sandboxId: typeof input.sandboxId === 'string' ? input.sandboxId : undefined,
  scope: input.scope === 'sandbox-control' || input.scope === 'operator' ? input.scope : 'user',
});
