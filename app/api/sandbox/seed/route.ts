import {
  actionOptionsFor,
  authorizationFailure,
  createSeededEngine,
  engineFromRecord,
  failure,
  hasJsonContentType,
  readJson,
  sandboxIdFrom,
  controlPrincipalForRequest,
  hasOnlyKeys,
  statePayloadFor,
  stateRecordFor,
  storeForRequest,
  isSandboxScenario,
} from '../runtime.ts';
import { SandboxCommandExecutor } from '../../../domain/commandExecutor.ts';

export async function POST(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request, { requireControl: true });
  if (authError) return authError;
  if (!hasJsonContentType(request)) return failure('INVALID_INPUT', 415, { message: 'Content-Typeはapplication/jsonで指定してください' });
  const body = await readJson(request);
  if (!body) return failure('INVALID_INPUT', 400, { message: 'JSON bodyが不正です' });
  if (!hasOnlyKeys(body, ['id', 'sandboxId', 'scenarioId', 'seed', 'expectedStateVersion'])) return failure('INVALID_INPUT', 400, { message: '未対応のbody fieldです' });
  if (typeof body.seed === 'string' && body.seed.length > 160) return failure('INVALID_INPUT', 400, { message: 'seedは160文字以内で指定してください' });
  const id = sandboxIdFrom(request, body);
  if (!id) return failure('INVALID_STATE_ID', 400);
  const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId : 'catalog_default';
  if (!isSandboxScenario(scenarioId)) return failure('UNKNOWN_SCENARIO', 400);
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : `${scenarioId}-seed-v1`;
  try {
    const store = await storeForRequest();
    const existing = await store.get(id);
    const engine = existing ? engineFromRecord(id, existing) : createSeededEngine(id, scenarioId, seed);
    if (!existing) {
      const initialWrite = await store.put(stateRecordFor(id, engine), undefined, true);
      if (!initialWrite.ok) return failure(initialWrite.error === 'UNAVAILABLE' ? 'D1_UNAVAILABLE' : 'STATE_CONFLICT', initialWrite.error === 'UNAVAILABLE' ? 503 : 409, { actualStateVersion: initialWrite.actualStateVersion, retryable: initialWrite.error === 'UNAVAILABLE' });
    }
    const options = { ...actionOptionsFor(body, 'platform', controlPrincipalForRequest(request)), actorId: 'platform', sandboxId: id };
    const executor = new SandboxCommandExecutor({ engine, store });
    const result = await executor.execute('seed', { scenarioId, seed }, options, (working) => working.loadScenario(scenarioId as never, { ...options, seed }));
    if (!result.ok) return failure(result.error, result.error === 'STATE_CONFLICT' || result.error === 'IDEMPOTENCY_CONFLICT' ? 409 : result.error === 'D1_UNAVAILABLE' ? 503 : 400, result);
    const snapshot = engine.getSnapshot();
    return Response.json({ ok: true, operation: 'seed', sandboxId: id, scenarioId: snapshot.scenarioId, seed: snapshot.seed, stateVersion: snapshot.stateVersion, state: statePayloadFor(engine), result }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return failure('D1_UNAVAILABLE', 503, { retryable: true });
  }
}
