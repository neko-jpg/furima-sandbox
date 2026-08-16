import { dispatchSandboxCommand } from '../../../domain/sandboxCommandDispatcher.ts';
import { SandboxCommandExecutor } from '../../../domain/commandExecutor.ts';
import {
  actionOptionsFor,
  authorizationFailure,
  createSeededEngine,
  engineFromRecord,
  failure,
  MAX_REPLAY_ACTIONS,
  readJson,
  sandboxIdFrom,
  SANDBOX_CONTROL_OPTIONS,
  statePayloadFor,
  stateRecordFor,
  storeForRequest,
} from '../runtime.ts';

const controlCommands = new Set(['switchActor', 'loadScenario', 'resetScenario', 'advanceClock', 'injectFailure', 'importState']);

export async function POST(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request);
  if (authError) return authError;
  const body = await readJson(request);
  if (!body || !Array.isArray(body.actions) || body.actions.length > MAX_REPLAY_ACTIONS) return failure('INVALID_INPUT', 400, { message: `actionsは1リクエスト${MAX_REPLAY_ACTIONS}件以内の配列で指定してください` });
  const id = sandboxIdFrom(request, body);
  if (!id) return failure('INVALID_STATE_ID', 400);
  const store = await storeForRequest();
  try {
    const existing = body.fromStored === true ? await store.get(id) : null;
    const expectedStateVersion = Number.isInteger(body.expectedStateVersion) ? Number(body.expectedStateVersion) : undefined;
    if (existing && expectedStateVersion !== undefined && existing.stateVersion !== expectedStateVersion) return failure('STATE_CONFLICT', 409, { expectedStateVersion, actualStateVersion: existing.stateVersion });
    const baseState = typeof body.baseState === 'string' ? body.baseState : null;
    const engine = existing
      ? engineFromRecord(id, existing)
      : createSeededEngine(id, typeof body.scenarioId === 'string' ? body.scenarioId : 'catalog_default', typeof body.seed === 'string' && body.seed.trim() ? body.seed : undefined);
    if (baseState) {
      const imported = engine.importState(baseState, SANDBOX_CONTROL_OPTIONS);
      if (!imported.ok) return failure('INVALID_STATE', 400, imported);
    }
    if (!existing) {
      const initialWrite = await store.put(stateRecordFor(id, engine), undefined, true);
      if (!initialWrite.ok) return failure(initialWrite.error === 'CONFLICT' ? 'STATE_CONFLICT' : 'D1_UNAVAILABLE', initialWrite.error === 'CONFLICT' ? 409 : 503, { actualStateVersion: initialWrite.actualStateVersion, retryable: initialWrite.error === 'UNAVAILABLE' });
    }
    const commandExecutor = new SandboxCommandExecutor({ engine, store });
    const results: unknown[] = [];
    for (let index = 0; index < body.actions.length; index += 1) {
      const action = body.actions[index];
      if (!action || typeof action !== 'object' || Array.isArray(action) || typeof (action as { command?: unknown }).command !== 'string') return failure('INVALID_INPUT', 400, { actionIndex: index, message: '各actionにはcommandが必要です' });
      const entry = action as Record<string, unknown>;
      const command = String(entry.command);
      const baseOptions = actionOptionsFor(entry, engine.getCurrentActor().id);
      const options = controlCommands.has(command)
        ? { ...SANDBOX_CONTROL_OPTIONS, sandboxId: id, idempotencyKey: baseOptions.idempotencyKey, requestId: baseOptions.requestId, commandId: baseOptions.commandId, expectedStateVersion: baseOptions.expectedStateVersion }
        : { ...baseOptions, sandboxId: id, scope: 'sandbox-control' as const };
      const result = await commandExecutor.execute(command, entry.payload ?? {}, options, (working) => dispatchSandboxCommand(working, command, entry.payload ?? {}, options));
      results.push(result);
      if (!result.ok) return failure('REPLAY_FAILED', 422, { actionIndex: index, command, result, results, state: statePayloadFor(engine) });
    }
    return Response.json({ ok: true, operation: 'replay', sandboxId: id, stateVersion: engine.getStateVersion(), results, trace: await store.listCommands(id), state: statePayloadFor(engine) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return failure(error instanceof Error && error.message === 'INVALID_STATE' ? 'INVALID_STATE' : 'D1_UNAVAILABLE', error instanceof Error && error.message === 'INVALID_STATE' ? 400 : 503, { retryable: true });
  }
}
