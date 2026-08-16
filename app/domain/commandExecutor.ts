import { SandboxCommandBus, compactImagePayload, fingerprint } from './commandBus.ts';
import { SandboxEngine } from './sandboxEngine.ts';
import type {
  ActionMetadata,
  ActionPreview,
  ActionResult,
  AgentActionOptions,
  AgentErrorCode,
  MercariItem,
  PreviewCommand,
} from '../types/mercari.ts';
import type {
  SandboxCommandRecord,
  SandboxPreviewRecord,
  SandboxStateRecord,
  SandboxStateStore,
} from './sandboxStore.ts';

const COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000;
const PREVIEW_VIRTUAL_TTL_MS = 10 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 128 * 1024;

const failure = <T,>(error: AgentErrorCode, stateVersion: number, message: string, details?: unknown): ActionResult<T> => ({
  ok: false,
  error,
  stateVersion,
  message,
  ...(details === undefined ? {} : { details }),
});

const resultWithMeta = <T,>(result: ActionResult<T>, metadata: ActionMetadata): ActionResult<T> => ({
  ...result,
  meta: {
    ...metadata,
    stateVersion: result.stateVersion,
  },
});

const parseResult = <T,>(serialized: string): ActionResult<T> | null => {
  try {
    const parsed = JSON.parse(serialized) as ActionResult<T>;
    return parsed && typeof parsed === 'object' && typeof parsed.stateVersion === 'number' ? parsed : null;
  } catch {
    return null;
  }
};

const stateRecordFor = (sandboxId: string, engine: SandboxEngine, updatedAt: string): SandboxStateRecord => {
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

const cloneEngine = (engine: SandboxEngine): SandboxEngine | null => {
  const snapshot = engine.getSnapshot();
  const clone = new SandboxEngine(engine.getItems(), {
    sandboxId: engine.getSandboxId(),
    seed: snapshot.seed,
    now: snapshot.now,
    notifications: engine.getNotifications(),
  });
  const imported = clone.importState(engine.exportState(), { actorId: 'platform', scope: 'sandbox-control' });
  return imported.ok ? clone : null;
};

const operationKeyFor = (options: AgentActionOptions | undefined, operationId: string): string => options?.idempotencyKey ?? options?.requestId ?? options?.commandId ?? operationId;

export interface SandboxCommandExecutorOptions {
  engine: SandboxEngine;
  store: SandboxStateStore;
  now?: () => Date;
}

export class SandboxCommandExecutor {
  private readonly engine: SandboxEngine;
  private readonly store: SandboxStateStore;
  private readonly now: () => Date;
  private sequence = 0;

  public constructor(options: SandboxCommandExecutorOptions) {
    this.engine = options.engine;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  private context(): { sandboxId: string; actorId: string; stateVersion: number } {
    return {
      sandboxId: this.engine.getSandboxId(),
      actorId: this.engine.getCurrentActor().id,
      stateVersion: this.engine.getStateVersion(),
    };
  }

  private metadata(command: string, options: AgentActionOptions | undefined, mode: 'preview' | 'commit', stateVersion: number): ActionMetadata {
    const context = this.context();
    const operationId = options?.operationId ?? options?.idempotencyKey ?? options?.requestId ?? options?.commandId ?? `${context.sandboxId}:${command}:${++this.sequence}`;
    return {
      sandboxId: context.sandboxId,
      actorId: options?.actorId ?? context.actorId,
      stateVersion,
      operationId,
      ...(options?.commandId ? { commandId: options.commandId } : {}),
      ...(options?.requestId ? { requestId: options.requestId } : {}),
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      mode,
    };
  }

  private validate(command: string, payload: unknown, options: AgentActionOptions | undefined, mode: 'preview' | 'commit'): { metadata: ActionMetadata; payloadHash: string } | ActionResult<never> {
    const context = this.context();
    const metadata = this.metadata(command, options, mode, context.stateVersion);
    const compacted = compactImagePayload(payload);
    const payloadHash = fingerprint({ sandboxId: context.sandboxId, actorId: metadata.actorId, command, mode, payload: compacted });
    if (!payloadHash || payloadHash.length > MAX_PAYLOAD_BYTES) return resultWithMeta(failure('INVALID_INPUT', context.stateVersion, 'payloadはJSON互換・循環参照なし・128KB以内で指定してください'), metadata);
    if (options?.sandboxId && options.sandboxId !== context.sandboxId) return resultWithMeta(failure('INVALID_INPUT', context.stateVersion, 'sandboxIdが現在のSandboxと一致しません', { expectedSandboxId: context.sandboxId, receivedSandboxId: options.sandboxId }), metadata);
    if (options?.actorId && options.scope !== 'sandbox-control' && options.actorId !== context.actorId) return resultWithMeta(failure('FORBIDDEN', context.stateVersion, 'actorIdは現在のSandbox actorと一致している必要があります'), metadata);
    if (options?.expectedStateVersion !== undefined && options.expectedStateVersion !== context.stateVersion) return resultWithMeta(failure('STATE_CONFLICT', context.stateVersion, '状態が更新されています。最新スナップショットを取得してください。', { expectedStateVersion: options.expectedStateVersion, actualStateVersion: context.stateVersion }), metadata);
    return { metadata, payloadHash };
  }

  private async existingResult<T>(sandboxId: string, key: string, payloadHash: string, command: string, mode: 'preview' | 'commit', metadata: ActionMetadata): Promise<ActionResult<T> | null> {
    const existing = await this.store.getCommand(sandboxId, key);
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash || existing.command !== command || existing.mode !== mode) return resultWithMeta(failure('IDEMPOTENCY_CONFLICT', this.engine.getStateVersion(), '同じ冪等キーで異なるpayloadを再利用できません'), metadata);
    const result = parseResult<T>(existing.result);
    return result ? resultWithMeta(result, { ...metadata, operationId: existing.operationId, actorId: existing.actorId, stateVersion: result.stateVersion }) : resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), '保存済みcommand結果を読み込めません'), metadata);
  }

  private commandRecord<T>(result: ActionResult<T>, command: string, payloadHash: string, options: AgentActionOptions | undefined, metadata: ActionMetadata, before: number, createdAt: Date): SandboxCommandRecord {
    const operationId = metadata.operationId;
    const expiresAt = new Date(createdAt.getTime() + COMMAND_RETENTION_MS).toISOString();
    return {
      operationId,
      sandboxId: metadata.sandboxId,
      actorId: metadata.actorId,
      command,
      mode: metadata.mode,
      idempotencyKey: operationKeyFor(options, operationId),
      ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
      ...(metadata.commandId ? { commandId: metadata.commandId } : {}),
      payloadHash,
      stateVersionBefore: before,
      stateVersionAfter: result.stateVersion,
      status: result.ok ? 'SUCCEEDED' : 'FAILED',
      result: JSON.stringify(result),
      createdAt: createdAt.toISOString(),
      expiresAt,
    };
  }

  private async executeInternal<T>(command: string, payload: unknown, options: AgentActionOptions | undefined, operation: (engine: SandboxEngine) => ActionResult<T>, previewId?: string): Promise<ActionResult<T>> {
    const mode = options?.mode ?? 'commit';
    const validated = this.validate(command, payload, options, mode);
    if ('ok' in validated) return validated as ActionResult<T>;
    const { metadata, payloadHash } = validated;
    const key = operationKeyFor(options, metadata.operationId);
    try {
      const existing = await this.existingResult<T>(metadata.sandboxId, key, payloadHash, command, mode, metadata);
      if (existing) return existing;
      const before = this.engine.getStateVersion();
      const working = cloneEngine(this.engine);
      if (!working) return resultWithMeta(failure('INVALID_STATE', before, 'Sandboxの作業コピーを作成できませんでした'), metadata);
      const bus = new SandboxCommandBus({ getContext: () => ({ sandboxId: working.getSandboxId(), actorId: working.getCurrentActor().id, stateVersion: working.getStateVersion() }) });
      const result = bus.execute(command, payload, { ...options, mode }, () => operation(working));
      const createdAt = this.now();
      const record = this.commandRecord(result, command, payloadHash, options, metadata, before, createdAt);
      const committed = await this.store.commitCommand(record, stateRecordFor(metadata.sandboxId, working, createdAt.toISOString()), before, previewId);
      if (!committed.ok) {
        if (committed.error === 'IDEMPOTENCY_CONFLICT') return resultWithMeta(failure('IDEMPOTENCY_CONFLICT', this.engine.getStateVersion(), '同じ冪等キーで異なるpayloadを再利用できません'), metadata);
        return resultWithMeta(failure(committed.error === 'UNAVAILABLE' ? 'D1_UNAVAILABLE' : 'STATE_CONFLICT', committed.actualStateVersion ?? this.engine.getStateVersion(), committed.error === 'UNAVAILABLE' ? 'Sandbox永続化が利用できません' : 'Sandbox状態が競合しています'), metadata);
      }
      if (committed.duplicate) return parseResult<T>(committed.record.result) ?? resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), '保存済みcommand結果を読み込めません'), metadata);
      const imported = this.engine.importState(working.exportState(), { actorId: 'platform', scope: 'sandbox-control' });
      if (!imported.ok) return resultWithMeta(failure('INVALID_STATE', this.engine.getStateVersion(), 'Sandbox状態を反映できませんでした'), metadata);
      return resultWithMeta(result, { ...metadata, stateVersion: result.stateVersion });
    } catch {
      return resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), 'Sandbox永続化が利用できません', { retryable: true }), metadata);
    }
  }

  public execute<T>(command: string, payload: unknown, options: AgentActionOptions | undefined, operation: (engine: SandboxEngine) => ActionResult<T>): Promise<ActionResult<T>> {
    return this.executeInternal(command, payload, options, operation);
  }

  public async preview(command: PreviewCommand, payload: unknown, options: AgentActionOptions | undefined, operation: (engine: SandboxEngine) => ActionResult<unknown>): Promise<ActionResult<ActionPreview>> {
    const previewOptions = { ...options, mode: 'preview' as const };
    const validated = this.validate(command, payload, previewOptions, 'preview');
    if ('ok' in validated) return validated as ActionResult<ActionPreview>;
    const { metadata, payloadHash } = validated;
    const key = operationKeyFor(previewOptions, metadata.operationId);
    try {
      const existing = await this.existingResult<ActionPreview>(metadata.sandboxId, key, payloadHash, command, 'preview', metadata);
      if (existing) return existing;
      const working = cloneEngine(this.engine);
      if (!working) return resultWithMeta(failure('INVALID_STATE', this.engine.getStateVersion(), 'Sandboxのpreviewコピーを作成できませんでした'), metadata);
      const result = operation(working);
      if (!result.ok) return resultWithMeta(result as ActionResult<ActionPreview>, metadata);
      const now = new Date();
      const virtualNow = working.getNow();
      const virtualExpiresAt = new Date(Date.parse(virtualNow) + PREVIEW_VIRTUAL_TTL_MS).toISOString();
      const previewId = `preview-${metadata.sandboxId}-${++this.sequence}`;
      const preview: ActionPreview = {
        previewId,
        command,
        payload,
        createdAt: virtualNow,
        expiresAt: virtualExpiresAt,
        stateVersion: this.engine.getStateVersion(),
        sandboxId: metadata.sandboxId,
        actorId: metadata.actorId,
        summary: result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : { result: result.data },
      };
      const storedPreview: SandboxPreviewRecord = {
        previewId,
        sandboxId: metadata.sandboxId,
        actorId: metadata.actorId,
        command,
        payload: JSON.stringify(payload),
        payloadHash,
        baseStateVersion: this.engine.getStateVersion(),
        summary: JSON.stringify(preview.summary),
        status: 'PENDING',
        createdAt: now.toISOString(),
        virtualExpiresAt,
        retentionExpiresAt: new Date(now.getTime() + COMMAND_RETENTION_MS).toISOString(),
      };
      const previewWrite = await this.store.putPreview(storedPreview);
      if (!previewWrite.ok) return resultWithMeta(failure(previewWrite.error === 'UNAVAILABLE' ? 'D1_UNAVAILABLE' : 'IDEMPOTENCY_CONFLICT', this.engine.getStateVersion(), 'previewを永続化できませんでした'), metadata);
      const commandResult = resultWithMeta({ ok: true, data: preview, stateVersion: this.engine.getStateVersion() }, metadata);
      const record = this.commandRecord(commandResult, command, payloadHash, previewOptions, metadata, this.engine.getStateVersion(), now);
      const commandWrite = await this.store.commitCommand(record, stateRecordFor(metadata.sandboxId, this.engine, now.toISOString()), this.engine.getStateVersion());
      if (!commandWrite.ok) return resultWithMeta(failure(commandWrite.error === 'UNAVAILABLE' ? 'D1_UNAVAILABLE' : commandWrite.error === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'STATE_CONFLICT', this.engine.getStateVersion(), 'preview commandを記録できませんでした'), metadata);
      return commandResult;
    } catch {
      return resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), 'preview永続化が利用できません', { retryable: true }), metadata);
    }
  }

  public async commitPreview(previewId: string, options: AgentActionOptions | undefined, operation: (engine: SandboxEngine, command: string, payload: unknown) => ActionResult<unknown>): Promise<ActionResult<unknown>> {
    const preview = await this.store.getPreview(this.engine.getSandboxId(), previewId);
    const metadata = this.metadata('commitPreview', options, 'commit', this.engine.getStateVersion());
    if (!preview) return resultWithMeta(failure('PREVIEW_NOT_FOUND', this.engine.getStateVersion(), 'previewが見つかりません'), metadata);
    if (preview.actorId !== metadata.actorId || preview.sandboxId !== metadata.sandboxId) return resultWithMeta(failure('FORBIDDEN', this.engine.getStateVersion(), 'previewを作成したactorとSandboxだけが確定できます'), metadata);
    const key = operationKeyFor(options, metadata.operationId);
    const existingCommit = await this.store.getCommand(this.engine.getSandboxId(), key);
    if (existingCommit && existingCommit.mode === 'commit' && existingCommit.command === preview.command) {
      let payload: unknown;
      try { payload = JSON.parse(preview.payload) as unknown; } catch { payload = undefined; }
      const expectedHash = fingerprint({ sandboxId: metadata.sandboxId, actorId: metadata.actorId, command: preview.command, mode: 'commit', payload: compactImagePayload(payload) });
      if (existingCommit.payloadHash !== expectedHash) return resultWithMeta(failure('IDEMPOTENCY_CONFLICT', this.engine.getStateVersion(), '同じ冪等キーで異なるpayloadを再利用できません'), metadata);
      const saved = parseResult<unknown>(existingCommit.result);
      if (saved) return resultWithMeta(saved, { ...metadata, operationId: existingCommit.operationId, actorId: existingCommit.actorId, stateVersion: saved.stateVersion });
    }
    if (preview.status !== 'PENDING') return resultWithMeta(failure('PREVIEW_EXPIRED', this.engine.getStateVersion(), 'previewはすでに確定または期限切れです'), metadata);
    if (preview.baseStateVersion !== this.engine.getStateVersion()) return resultWithMeta(failure('STATE_CONFLICT', this.engine.getStateVersion(), 'preview作成後にSandbox状態が変化しています', { previewStateVersion: preview.baseStateVersion, actualStateVersion: this.engine.getStateVersion() }), metadata);
    if (Date.parse(preview.virtualExpiresAt) <= Date.parse(this.engine.getNow()) || Date.parse(preview.retentionExpiresAt) <= this.now().getTime()) return resultWithMeta(failure('PREVIEW_EXPIRED', this.engine.getStateVersion(), 'previewの有効期限が切れています'), metadata);
    let payload: unknown;
    try { payload = JSON.parse(preview.payload) as unknown; } catch { return resultWithMeta(failure('INVALID_STATE', this.engine.getStateVersion(), 'preview payloadが壊れています'), metadata); }
    const previewPayloadHash = fingerprint({ sandboxId: preview.sandboxId, actorId: preview.actorId, command: preview.command, mode: 'preview', payload: compactImagePayload(payload) });
    if (!previewPayloadHash || previewPayloadHash !== preview.payloadHash) return resultWithMeta(failure('INVALID_STATE', this.engine.getStateVersion(), 'preview payloadのハッシュが一致しません'), metadata);
    return this.executeInternal(preview.command, payload, { ...options, mode: 'commit', actorId: preview.actorId }, (engine) => operation(engine, preview.command, payload), previewId);
  }
}

export const previewOperationFor = (command: PreviewCommand, payload: unknown, actorId: string, engine: SandboxEngine): ActionResult<unknown> => {
  if (command === 'purchase') {
    const itemId = payload && typeof payload === 'object' && typeof (payload as { itemId?: unknown }).itemId === 'string' ? String((payload as { itemId: string }).itemId) : '';
    const started = engine.startPurchase(itemId, { actorId });
    if (!started.ok) return started;
    return engine.purchaseItemWithPricing(itemId, payload && typeof payload === 'object' ? (payload as { pricing?: unknown }).pricing as never : undefined, { actorId });
  }
  if (command === 'listing.create') return engine.listItem(payload as Partial<MercariItem>, { actorId });
  if (command === 'wallet.deposit') return payload && typeof payload === 'object' && typeof (payload as { amount?: unknown }).amount === 'number' ? engine.depositWallet(Number((payload as { amount: number }).amount), { actorId }) : failure('INVALID_AMOUNT', engine.getStateVersion(), 'amountが必要です');
  if (command === 'wallet.withdraw') return payload && typeof payload === 'object' && typeof (payload as { amount?: unknown }).amount === 'number' ? engine.withdrawWallet(Number((payload as { amount: number }).amount), { actorId }) : failure('INVALID_AMOUNT', engine.getStateVersion(), 'amountが必要です');
  return failure('INVALID_INPUT', engine.getStateVersion(), '未対応のpreview commandです');
};
