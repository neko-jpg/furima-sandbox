import { dispatchSandboxCommand } from '../../../domain/sandboxCommandDispatcher.ts';
import { SandboxCommandExecutor } from '../../../domain/commandExecutor.ts';
import { compactImagePayload, fingerprint } from '../../../domain/commandBus.ts';
import { MemorySandboxStateStore } from '../../../domain/sandboxStore.ts';
import {
  actionOptionsFor,
  authorizationFailure,
  createSeededEngine,
  engineFromRecord,
  failure,
  MAX_REPLAY_ACTIONS,
  hasJsonContentType,
  principalForRequest,
  readJson,
  sandboxIdFrom,
  SANDBOX_CONTROL_OPTIONS,
  statePayloadFor,
  stateRecordFor,
  storeForRequest,
  SANDBOX_CONTROL_PRINCIPAL,
  isSandboxScenario,
  hasOnlyKeys,
} from '../runtime.ts';

const controlCommands = new Set(['switchActor', 'loadScenario', 'resetScenario', 'advanceClock', 'injectFailure', 'importState']);

type ReplayAction = {
  entry: Record<string, unknown>;
  command: string;
  payload: unknown;
  idempotencyKey?: string;
};

const parseStoredResult = (serialized: string): unknown | null => {
  try {
    const result = JSON.parse(serialized) as unknown;
    return result && typeof result === 'object' ? result : null;
  } catch {
    return null;
  }
};

export async function POST(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request, { requireControl: true });
  if (authError) return authError;
  if (!hasJsonContentType(request)) return failure('INVALID_INPUT', 415, { message: 'Content-Typeはapplication/jsonで指定してください' });
  const body = await readJson(request);
  if (!body || !Array.isArray(body.actions) || body.actions.length === 0 || body.actions.length > MAX_REPLAY_ACTIONS) return failure('INVALID_INPUT', 400, { message: `actionsは1リクエスト${MAX_REPLAY_ACTIONS}件以内の配列で指定してください` });
  if (!hasOnlyKeys(body, ['id', 'sandboxId', 'scenarioId', 'seed', 'baseState', 'fromStored', 'expectedStateVersion', 'actions'])) return failure('INVALID_INPUT', 400, { message: '未対応のbody fieldです' });
  const id = sandboxIdFrom(request, body);
  if (!id) return failure('INVALID_STATE_ID', 400);
  const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId : 'catalog_default';
  if (!isSandboxScenario(scenarioId)) return failure('UNKNOWN_SCENARIO', 400);
  const store = await storeForRequest();
  try {
    const actions: ReplayAction[] = [];
    for (let index = 0; index < body.actions.length; index += 1) {
      const action = body.actions[index];
      if (!action || typeof action !== 'object' || Array.isArray(action) || typeof (action as { command?: unknown }).command !== 'string' || !(action as { command: string }).command.trim()) return failure('INVALID_INPUT', 400, { actionIndex: index, message: '各actionには空でないcommandが必要です' });
      const entry = action as Record<string, unknown>;
      if (!hasOnlyKeys(entry, ['command', 'payload', 'idempotencyKey'])) return failure('INVALID_INPUT', 400, { actionIndex: index, message: '未対応のaction fieldです' });
      actions.push({
        entry,
        command: String(entry.command),
        payload: entry.payload ?? {},
        ...(typeof entry.idempotencyKey === 'string' ? { idempotencyKey: entry.idempotencyKey } : {}),
      });
    }

    const storedRecord = await store.get(id);
    const storedCommands = await Promise.all(actions.map((action) => action.idempotencyKey === undefined ? null : store.getCommand(id, action.idempotencyKey)));
    const duplicateCount = storedCommands.filter(Boolean).length;
    if (duplicateCount > 0) {
      const principal = principalForRequest(request) ?? SANDBOX_CONTROL_PRINCIPAL;
      for (let index = 0; index < actions.length; index += 1) {
        const existingCommand = storedCommands[index];
        if (!existingCommand) continue;
        const action = actions[index];
        const payloadHash = fingerprint({
          sandboxId: id,
          actorId: principal.actorId,
          command: action.command,
          mode: 'commit',
          payload: compactImagePayload(action.payload),
        });
        if (existingCommand.payloadHash !== payloadHash || existingCommand.command !== action.command || existingCommand.mode !== 'commit') return failure('IDEMPOTENCY_CONFLICT', 409, { actionIndex: index, message: '同じ冪等キーで異なるreplay actionを再利用できません' });
      }
      if (duplicateCount !== actions.length) return failure('IDEMPOTENCY_CONFLICT', 409, { message: 'replay batchの一部だけが保存済みです。全actionを同じ内容で再送してください' });
      if (!storedRecord) return failure('D1_UNAVAILABLE', 503, { retryable: true });
      const results = storedCommands.map((command) => command ? parseStoredResult(command.result) : null);
      if (results.some((result) => result === null)) return failure('D1_UNAVAILABLE', 503, { retryable: true });
      const durableEngine = engineFromRecord(id, storedRecord);
      return Response.json({ ok: true, operation: 'replay', sandboxId: id, stateVersion: durableEngine.getStateVersion(), results, trace: await store.listCommands(id), state: statePayloadFor(durableEngine) }, { headers: { 'cache-control': 'no-store' } });
    }

    const existing = body.fromStored === true ? storedRecord : null;
    const expectedStateVersion = Number.isInteger(body.expectedStateVersion) ? Number(body.expectedStateVersion) : undefined;
    if (existing && expectedStateVersion !== undefined && existing.stateVersion !== expectedStateVersion) return failure('STATE_CONFLICT', 409, { expectedStateVersion, actualStateVersion: existing.stateVersion });
    const baseState = typeof body.baseState === 'string' ? body.baseState : null;
    const engine = existing
      ? engineFromRecord(id, existing)
      : createSeededEngine(id, scenarioId, typeof body.seed === 'string' && body.seed.trim() ? body.seed : undefined);
    if (baseState) {
      const imported = engine.importState(baseState, SANDBOX_CONTROL_OPTIONS);
      if (!imported.ok) return failure('INVALID_STATE', 400, imported);
    }
    // Execute the whole replay against a private aggregate/store first. The
    // external store is touched only once every action succeeds, so a later
    // invalid action cannot leave the first half of the replay committed.
    const baseRecord = stateRecordFor(id, engine);
    const replayStore = new MemorySandboxStateStore();
    await replayStore.put(baseRecord, undefined, true);
    const commandExecutor = new SandboxCommandExecutor({ engine, store: replayStore });
    const results: unknown[] = [];
    for (let index = 0; index < actions.length; index += 1) {
      const { entry, command, payload } = actions[index];
      const baseOptions = actionOptionsFor(entry, engine.getCurrentActor().id, principalForRequest(request));
      const options = controlCommands.has(command)
        ? { ...SANDBOX_CONTROL_OPTIONS, sandboxId: id, idempotencyKey: baseOptions.idempotencyKey, requestId: baseOptions.requestId, commandId: baseOptions.commandId, expectedStateVersion: baseOptions.expectedStateVersion }
        : { ...baseOptions, sandboxId: id };
      const result = await commandExecutor.execute(command, payload, options, (working) => dispatchSandboxCommand(working, command, payload, options));
      results.push(result);
      if (!result.ok) return failure('REPLAY_FAILED', 422, { actionIndex: index, command, result, results, state: statePayloadFor(engine) });
    }
    const commands = await replayStore.listCommands(id);
    if (!existing) {
      if (storedRecord && storedRecord.stateVersion !== baseRecord.stateVersion) return failure('STATE_CONFLICT', 409, { actualStateVersion: storedRecord.stateVersion, message: '保存済みSandboxのstateVersionがreplayの基準状態と一致しません' });
      const initialWrite = await store.put(baseRecord, storedRecord?.stateVersion, false);
      if (!initialWrite.ok) return failure(initialWrite.error === 'CONFLICT' ? 'STATE_CONFLICT' : 'D1_UNAVAILABLE', initialWrite.error === 'CONFLICT' ? 409 : 503, { actualStateVersion: initialWrite.actualStateVersion, retryable: initialWrite.error === 'UNAVAILABLE' });
    } else if (!commands.length) {
      // An empty replay may still carry baseState. Persist it with CAS against
      // the version observed above instead of force-writing over a concurrent
      // command that landed while this request was preparing the replay.
      const guardedWrite = await store.put(baseRecord, existing.stateVersion);
      if (!guardedWrite.ok) return failure(guardedWrite.error === 'CONFLICT' ? 'STATE_CONFLICT' : 'D1_UNAVAILABLE', guardedWrite.error === 'CONFLICT' ? 409 : 503, { actualStateVersion: guardedWrite.actualStateVersion, retryable: guardedWrite.error === 'UNAVAILABLE' });
    }
    if (commands.length) {
      const committed = await store.commitReplay(commands, stateRecordFor(id, engine), baseRecord.stateVersion);
      if (!committed.ok) return failure(committed.error === 'CONFLICT' ? 'STATE_CONFLICT' : committed.error === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'D1_UNAVAILABLE', committed.error === 'CONFLICT' ? 409 : committed.error === 'IDEMPOTENCY_CONFLICT' ? 409 : 503, { actualStateVersion: committed.actualStateVersion, retryable: committed.error === 'UNAVAILABLE' });
    }
    return Response.json({ ok: true, operation: 'replay', sandboxId: id, stateVersion: engine.getStateVersion(), results, trace: await store.listCommands(id), state: statePayloadFor(engine) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return failure(error instanceof Error && error.message === 'INVALID_STATE' ? 'INVALID_STATE' : 'D1_UNAVAILABLE', error instanceof Error && error.message === 'INVALID_STATE' ? 400 : 503, { retryable: true });
  }
}
