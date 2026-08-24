import { SandboxCommandBus, compactImagePayload, fingerprint } from './commandBus.ts';
import { SandboxEngine, createTrustedPrincipal, isTrustedPrincipal } from './sandboxEngine.ts';
import { applyPreviewOperation } from './previewOperations.ts';
import type {
  ActionMetadata,
  ActionPreview,
  ActionResult,
  AgentActionOptions,
  AgentErrorCode,
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
const MAX_DURABLE_RESULT_BYTES = 64 * 1024;
const MAX_ACTION_IDENTIFIER_LENGTH = 200;
const VALID_ACTION_IDENTIFIER = /^[A-Za-z0-9._:-]{1,200}$/u;
let fallbackIdCounter = 0;
const INTERNAL_CONTROL_OPTIONS: AgentActionOptions = {
  principal: createTrustedPrincipal({ subjectId: 'command-executor-control', actorId: 'platform', roles: ['platform'], scopes: ['sandbox-control', 'operator'] }),
};

const uniqueId = (prefix: string): string => {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${(++fallbackIdCounter).toString(36)}`;
  return `${prefix}-${randomUuid}`;
};

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

const durableResult = <T,>(result: ActionResult<T>): string => {
  const serialized = JSON.stringify(result);
  if (new TextEncoder().encode(serialized).byteLength <= MAX_DURABLE_RESULT_BYTES) return serialized;
  const compact = result.ok
    ? { ...result, data: { truncated: true, reason: 'RESULT_TOO_LARGE' } }
    : { ...result, details: undefined };
  return JSON.stringify(compact);
};

const executorErrorCode = (error: unknown): 'D1_UNAVAILABLE' | 'INTERNAL_ERROR' => {
  const message = error instanceof Error ? error.message : String(error);
  return /D1_UNAVAILABLE|REQUEST_ABORT|IndexedDB|QuotaExceeded|timeout/i.test(message) ? 'D1_UNAVAILABLE' : 'INTERNAL_ERROR';
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
  const imported = clone.importState(engine.exportState(), INTERNAL_CONTROL_OPTIONS);
  return imported.ok ? clone : null;
};

const operationKeyFor = (options: AgentActionOptions | undefined, operationId: string): string => options?.idempotencyKey ?? options?.requestId ?? options?.commandId ?? operationId;

export interface SandboxCommandExecutorOptions {
  engine: SandboxEngine;
  store: SandboxStateStore;
  now?: () => Date;
  requirePersistentCommit?: boolean;
}

export class SandboxCommandExecutor {
  private readonly engine: SandboxEngine;
  private readonly store: SandboxStateStore;
  private readonly now: () => Date;
  private readonly requirePersistentCommit: boolean;
  private readonly volatileRejectedKeys = new Set<string>();
  private sequence = 0;

  public constructor(options: SandboxCommandExecutorOptions) {
    this.engine = options.engine;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.requirePersistentCommit = options.requirePersistentCommit ?? false;
  }

  private context(options?: AgentActionOptions): { sandboxId: string; actorId: string; stateVersion: number } {
    return {
      sandboxId: this.engine.getSandboxId(),
      actorId: options?.principal?.actorId ?? this.engine.getCurrentActor().id,
      stateVersion: this.engine.getStateVersion(),
    };
  }

  private metadata(command: string, options: AgentActionOptions | undefined, mode: 'preview' | 'commit', stateVersion: number): ActionMetadata {
    const context = this.context(options);
    const operationId = options?.operationId ?? options?.idempotencyKey ?? options?.requestId ?? options?.commandId ?? `${context.sandboxId}:${command}:${uniqueId('op')}:${++this.sequence}`;
    return {
      sandboxId: context.sandboxId,
      actorId: context.actorId,
      stateVersion,
      operationId,
      ...(options?.commandId ? { commandId: options.commandId } : {}),
      ...(options?.requestId ? { requestId: options.requestId } : {}),
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      mode,
    };
  }

  private validate(command: string, payload: unknown, options: AgentActionOptions | undefined, mode: 'preview' | 'commit'): { metadata: ActionMetadata; payloadHash: string } | ActionResult<never> {
    const context = this.context(options);
    const identifierFields = ['operationId', 'commandId', 'requestId', 'idempotencyKey'] as const;
    const invalidIdentifier = identifierFields.find((field) => {
      const value = options?.[field];
      return value !== undefined && (typeof value !== 'string' || !VALID_ACTION_IDENTIFIER.test(value));
    });
    const safeOptions = invalidIdentifier ? { ...options, [invalidIdentifier]: undefined } : options;
    const metadata = this.metadata(command, safeOptions, mode, context.stateVersion);
    if (invalidIdentifier) return resultWithMeta(failure('INVALID_INPUT', context.stateVersion, `${invalidIdentifier}は1〜${MAX_ACTION_IDENTIFIER_LENGTH}文字で指定してください`), metadata);
    const originalHash = fingerprint({ sandboxId: context.sandboxId, actorId: metadata.actorId, command, mode, payload });
    const compacted = compactImagePayload(payload);
    const payloadHash = fingerprint({ sandboxId: context.sandboxId, actorId: metadata.actorId, command, mode, payload: compacted });
    if (!originalHash || !payloadHash) return resultWithMeta(failure('INVALID_INPUT', context.stateVersion, 'payloadはJSON互換・循環参照なし・128KB以内で指定してください'), metadata);
    if (options?.sandboxId && options.sandboxId !== context.sandboxId) return resultWithMeta(failure('INVALID_INPUT', context.stateVersion, 'sandboxIdが現在のSandboxと一致しません', { expectedSandboxId: context.sandboxId, receivedSandboxId: options.sandboxId }), metadata);
    if (!options?.principal || !isTrustedPrincipal(options.principal)) return resultWithMeta(failure('FORBIDDEN', context.stateVersion, '実行Principalは信頼済みadapterから必ず注入してください'), metadata);
    if (options.actorId && options.actorId !== options.principal.actorId && !options.principal.scopes.includes('sandbox-control')) return resultWithMeta(failure('FORBIDDEN', context.stateVersion, 'actorIdを認証済みPrincipalから上書きできません'), metadata);
    if (options.scope === 'sandbox-control' && !options.principal.scopes.includes('sandbox-control')) return resultWithMeta(failure('FORBIDDEN', context.stateVersion, 'sandbox-control scopeがありません'), metadata);
    if (options?.expectedStateVersion !== undefined && options.expectedStateVersion !== context.stateVersion) return resultWithMeta(failure('STATE_CONFLICT', context.stateVersion, '状態が更新されています。最新スナップショットを取得してください。', { expectedStateVersion: options.expectedStateVersion, actualStateVersion: context.stateVersion }), metadata);
    return { metadata, payloadHash };
  }

  private async existingResult<T>(sandboxId: string, key: string, payloadHash: string, command: string, mode: 'preview' | 'commit', metadata: ActionMetadata): Promise<ActionResult<T> | null> {
    if (this.volatileRejectedKeys.has(`${sandboxId}:${key}`)) return resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), '前回の実行は永続storageへcommitされていません', { retryable: true }), metadata);
    const existing = await this.store.getCommand(sandboxId, key);
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash || existing.command !== command || existing.mode !== mode) return resultWithMeta(failure('IDEMPOTENCY_CONFLICT', this.engine.getStateVersion(), '同じ冪等キーで異なるpayloadを再利用できません'), metadata);
    const result = parseResult<T>(existing.result);
    // A retry can reach a different executor whose cache is still behind the
    // durable record. Refresh that cache from the source of truth before the
    // saved result becomes observable to the caller.
    if (result && existing.stateVersionAfter > this.engine.getStateVersion()) {
      const persisted = await this.store.get(sandboxId);
      if (persisted && persisted.stateVersion >= existing.stateVersionAfter) {
        this.engine.importState(persisted.payload, INTERNAL_CONTROL_OPTIONS);
      }
    }
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
      result: durableResult(result),
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
      await this.store.purgeExpired(this.now().toISOString());
      const existing = await this.existingResult<T>(metadata.sandboxId, key, payloadHash, command, mode, metadata);
      if (existing) return existing;
      const before = this.engine.getStateVersion();
      const working = cloneEngine(this.engine);
      if (!working) return resultWithMeta(failure('INVALID_STATE', before, 'Sandboxの作業コピーを作成できませんでした'), metadata);
      const bus = new SandboxCommandBus({ getContext: () => ({ sandboxId: working.getSandboxId(), actorId: metadata.actorId, stateVersion: working.getStateVersion() }) });
      const result = bus.execute(command, payload, { ...options, mode }, () => operation(working));
      // Failed commands are observational only at the persistence boundary.
      // Some domain failure paths deliberately consume an injected fault on a
      // working copy; that copy must never become the durable source of truth.
      const effectiveResult = result.ok ? result : { ...result, stateVersion: before };
      const createdAt = this.now();
      const record = this.commandRecord(effectiveResult, command, payloadHash, options, metadata, before, createdAt);
      const stateForPersist = result.ok ? working : this.engine;
      const committed = await this.store.commitCommand(record, stateRecordFor(metadata.sandboxId, stateForPersist, createdAt.toISOString()), before, previewId);
      if (!committed.ok) {
        if (committed.error === 'IDEMPOTENCY_CONFLICT') return resultWithMeta(failure('IDEMPOTENCY_CONFLICT', this.engine.getStateVersion(), '同じ冪等キーで異なるpayloadを再利用できません'), metadata);
        return resultWithMeta(failure(committed.error === 'UNAVAILABLE' ? 'D1_UNAVAILABLE' : 'STATE_CONFLICT', committed.actualStateVersion ?? this.engine.getStateVersion(), committed.error === 'UNAVAILABLE' ? 'Sandbox永続化が利用できません' : 'Sandbox状態が競合しています'), metadata);
      }
      if (this.requirePersistentCommit && committed.durability !== 'persistent') {
        this.volatileRejectedKeys.add(`${metadata.sandboxId}:${key}`);
        return resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), '永続storageへcommitできなかったためlive状態を公開しません', { retryable: true }), metadata);
      }
      if (committed.duplicate) {
        const persisted = await this.store.get(metadata.sandboxId);
        if (persisted && persisted.stateVersion > this.engine.getStateVersion()) {
          this.engine.importState(persisted.payload, INTERNAL_CONTROL_OPTIONS);
        }
        const duplicateResult = parseResult<T>(committed.record.result);
        return duplicateResult
          ? resultWithMeta(duplicateResult, { ...metadata, operationId: committed.record.operationId, actorId: committed.record.actorId, stateVersion: duplicateResult.stateVersion })
          : resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), '保存済みcommand結果を読み込めません'), metadata);
      }
      // Publish only after the atomic state/command write succeeds. Readers of
      // the live aggregate therefore cannot observe an uncommitted transition,
      // and a failed CAS never requires a version-decreasing rollback.
      if (result.ok) {
        const imported = this.engine.importState(working.exportState(), INTERNAL_CONTROL_OPTIONS);
        if (!imported.ok) return resultWithMeta(failure('INVALID_STATE', this.engine.getStateVersion(), '永続化済みSandbox状態をlive cacheへ反映できませんでした'), metadata);
      }
      return resultWithMeta(effectiveResult, { ...metadata, stateVersion: effectiveResult.stateVersion });
    } catch (error) {
      const code = executorErrorCode(error);
      return resultWithMeta(failure(code, this.engine.getStateVersion(), code === 'D1_UNAVAILABLE' ? 'Sandbox永続化が利用できません' : 'Sandbox commandの実行に失敗しました', { retryable: code === 'D1_UNAVAILABLE' }), metadata);
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
      await this.store.purgeExpired(this.now().toISOString());
      const existing = await this.existingResult<ActionPreview>(metadata.sandboxId, key, payloadHash, command, 'preview', metadata);
      if (existing) return existing;
      const working = cloneEngine(this.engine);
      if (!working) return resultWithMeta(failure('INVALID_STATE', this.engine.getStateVersion(), 'Sandboxのpreviewコピーを作成できませんでした'), metadata);
      const result = operation(working);
      if (!result.ok) return resultWithMeta(result as ActionResult<ActionPreview>, metadata);
      const now = this.now();
      const virtualNow = working.getNow();
      const virtualExpiresAt = new Date(Date.parse(virtualNow) + PREVIEW_VIRTUAL_TTL_MS).toISOString();
      const previewId = uniqueId(`preview-${metadata.sandboxId}`);
      const preview: ActionPreview = {
        previewId,
        command,
        payload: compactImagePayload(payload),
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
        payload: JSON.stringify(compactImagePayload(payload)),
        payloadHash,
        baseStateVersion: this.engine.getStateVersion(),
        summary: JSON.stringify(preview.summary),
        status: 'PENDING',
        createdAt: now.toISOString(),
        virtualExpiresAt,
        retentionExpiresAt: new Date(now.getTime() + COMMAND_RETENTION_MS).toISOString(),
      };
      const commandResult = resultWithMeta({ ok: true, data: preview, stateVersion: this.engine.getStateVersion() }, metadata);
      const record = this.commandRecord(commandResult, command, payloadHash, previewOptions, metadata, this.engine.getStateVersion(), now);
      // A preview records an immutable command candidate, not a state change.
      // Preserve the durable state's timestamp as well so an HTTP ETag does
      // not change merely because a read-only preview was created.
      const persistedState = await this.store.get(metadata.sandboxId);
      const commandWrite = await this.store.putPreviewAndCommand(storedPreview, record, stateRecordFor(metadata.sandboxId, this.engine, persistedState?.updatedAt ?? now.toISOString()), this.engine.getStateVersion());
      if (!commandWrite.ok) return resultWithMeta(failure(commandWrite.error === 'UNAVAILABLE' ? 'D1_UNAVAILABLE' : commandWrite.error === 'IDEMPOTENCY_CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'STATE_CONFLICT', this.engine.getStateVersion(), 'preview commandを記録できませんでした'), metadata);
      if (this.requirePersistentCommit && commandWrite.durability !== 'persistent') {
        this.volatileRejectedKeys.add(`${metadata.sandboxId}:${key}`);
        return resultWithMeta(failure('D1_UNAVAILABLE', this.engine.getStateVersion(), 'previewを永続storageへ保存できませんでした', { retryable: true }), metadata);
      }
      return commandResult;
    } catch (error) {
      const code = executorErrorCode(error);
      return resultWithMeta(failure(code, this.engine.getStateVersion(), code === 'D1_UNAVAILABLE' ? 'preview永続化が利用できません' : 'previewの作成に失敗しました', { retryable: code === 'D1_UNAVAILABLE' }), metadata);
    }
  }

  public async commitPreview(previewId: string, options: AgentActionOptions | undefined, operation: (engine: SandboxEngine, command: string, payload: unknown) => ActionResult<unknown>): Promise<ActionResult<unknown>> {
    const metadata = this.metadata('commitPreview', options, 'commit', this.engine.getStateVersion());
    if (!options?.principal || !isTrustedPrincipal(options.principal)) return resultWithMeta(failure('FORBIDDEN', this.engine.getStateVersion(), '実行Principalは信頼済みadapterから必ず注入してください'), metadata);
    try {
      await this.store.purgeExpired(this.now().toISOString());
      const preview = await this.store.getPreview(this.engine.getSandboxId(), previewId);
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
      const validated = this.validate(preview.command, payload, { ...options, actorId: preview.actorId, mode: 'commit' }, 'commit');
      if ('ok' in validated) return validated as ActionResult<unknown>;
      const previewPayloadHash = fingerprint({ sandboxId: preview.sandboxId, actorId: preview.actorId, command: preview.command, mode: 'preview', payload: compactImagePayload(payload) });
      if (!previewPayloadHash || previewPayloadHash !== preview.payloadHash) return resultWithMeta(failure('INVALID_STATE', this.engine.getStateVersion(), 'preview payloadのハッシュが一致しません'), metadata);
      return await this.executeInternal(preview.command, payload, { ...options, mode: 'commit', actorId: preview.actorId }, (engine) => operation(engine, preview.command, payload), previewId);
    } catch (error) {
      const code = executorErrorCode(error);
      return resultWithMeta(failure(code, this.engine.getStateVersion(), code === 'D1_UNAVAILABLE' ? 'previewの確定に必要な永続化が利用できません' : 'previewの確定に失敗しました', { retryable: code === 'D1_UNAVAILABLE' }), metadata);
    }
  }
}

export const previewOperationFor = (command: PreviewCommand, payload: unknown, actorId: string, engine: SandboxEngine): ActionResult<unknown> => {
  return applyPreviewOperation(engine, command, payload, { actorId });
};
