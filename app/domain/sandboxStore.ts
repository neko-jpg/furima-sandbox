export interface SandboxStateRecord {
  id: string;
  scenarioId: string;
  seed: string;
  stateVersion: number;
  virtualNow: string;
  payload: string;
  updatedAt: string;
}

export type SandboxCommandStatus = 'SUCCEEDED' | 'FAILED';

export type SandboxFaultPoint =
  | 'indexeddb-unavailable'
  | 'indexeddb-quota-exceeded'
  | 'corrupted-state'
  | 'd1-unavailable'
  | 'd1-timeout'
  | 'cas-conflict'
  | 'request-abort'
  | 'worker-restart'
  | 'command-before-record'
  | 'command-after-record-before-state'
  | 'state-after-response-before-client'
  | 'notification-failure'
  | 'payment-failure'
  | 'delivery-failure';

export interface SandboxCommandRecord {
  operationId: string;
  sandboxId: string;
  actorId: string;
  command: string;
  mode: 'preview' | 'commit';
  idempotencyKey?: string;
  requestId?: string;
  commandId?: string;
  payloadHash: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  status: SandboxCommandStatus;
  result: string;
  createdAt: string;
  expiresAt: string;
}

export type SandboxPreviewStatus = 'PENDING' | 'COMMITTED' | 'EXPIRED';

export interface SandboxPreviewRecord {
  previewId: string;
  sandboxId: string;
  actorId: string;
  command: string;
  payload: string;
  payloadHash: string;
  baseStateVersion: number;
  summary: string;
  status: SandboxPreviewStatus;
  createdAt: string;
  virtualExpiresAt: string;
  retentionExpiresAt: string;
  committedOperationId?: string;
}

export type SandboxStoreWriteResult =
  | { ok: true; record: SandboxStateRecord; durability?: 'persistent' | 'volatile' }
  | { ok: false; error: 'CONFLICT' | 'UNAVAILABLE'; actualStateVersion?: number };

export type SandboxCommandWriteResult =
  | { ok: true; record: SandboxCommandRecord; duplicate?: boolean; durability?: 'persistent' | 'volatile' }
  | { ok: false; error: 'CONFLICT' | 'UNAVAILABLE' | 'IDEMPOTENCY_CONFLICT'; actualStateVersion?: number; existing?: SandboxCommandRecord };

export interface SandboxStateStore {
  get(id: string): Promise<SandboxStateRecord | null>;
  put(record: SandboxStateRecord, expectedStateVersion?: number, force?: boolean): Promise<SandboxStoreWriteResult>;
  getCommand(sandboxId: string, key: string): Promise<SandboxCommandRecord | null>;
  listCommands(sandboxId: string): Promise<SandboxCommandRecord[]>;
  getPreview(sandboxId: string, previewId: string): Promise<SandboxPreviewRecord | null>;
  listPreviews(sandboxId: string): Promise<SandboxPreviewRecord[]>;
  purgeExpired(now: string): Promise<void>;
  putPreview(record: SandboxPreviewRecord): Promise<{ ok: true; durability?: 'persistent' | 'volatile' } | { ok: false; error: 'UNAVAILABLE' | 'CONFLICT' }>;
  putPreviewAndCommand(
    preview: SandboxPreviewRecord,
    command: SandboxCommandRecord,
    state: SandboxStateRecord,
    expectedStateVersion: number,
  ): Promise<SandboxCommandWriteResult>;
  commitReplay(
    commands: SandboxCommandRecord[],
    state: SandboxStateRecord,
    expectedStateVersion: number,
  ): Promise<SandboxCommandWriteResult>;
  commitCommand(
    command: SandboxCommandRecord,
    state: SandboxStateRecord,
    expectedStateVersion: number,
    previewId?: string,
  ): Promise<SandboxCommandWriteResult>;
}

export class MemorySandboxStateStore implements SandboxStateStore {
  protected readonly records = new Map<string, SandboxStateRecord>();
  protected readonly commands = new Map<string, SandboxCommandRecord>();
  protected readonly previews = new Map<string, SandboxPreviewRecord>();

  public async get(id: string): Promise<SandboxStateRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  public async put(record: SandboxStateRecord, expectedStateVersion?: number, force = false): Promise<SandboxStoreWriteResult> {
    const existing = this.records.get(record.id);
    const actualStateVersion = existing?.stateVersion ?? 0;
    if (!force && expectedStateVersion !== undefined && expectedStateVersion !== actualStateVersion) {
      return { ok: false, error: 'CONFLICT', actualStateVersion };
    }
    if (!force && expectedStateVersion === undefined && existing && record.stateVersion < existing.stateVersion) {
      return { ok: false, error: 'CONFLICT', actualStateVersion };
    }
    this.records.set(record.id, { ...record });
    return { ok: true, record: { ...record } };
  }

  public clear(sandboxId?: string): void {
    if (!sandboxId) {
      this.records.clear();
      this.commands.clear();
      this.previews.clear();
      return;
    }
    this.records.delete(sandboxId);
    for (const key of [...this.commands.keys()]) if (key.startsWith(`${sandboxId}:`)) this.commands.delete(key);
    for (const key of [...this.previews.keys()]) if (key.startsWith(`${sandboxId}:`)) this.previews.delete(key);
  }

  protected commandKey(sandboxId: string, key: string): string {
    return `${sandboxId}:${key}`;
  }

  public async getCommand(sandboxId: string, key: string): Promise<SandboxCommandRecord | null> {
    const record = this.commands.get(this.commandKey(sandboxId, key))
      ?? [...this.commands.values()].find((candidate) => candidate.sandboxId === sandboxId && candidate.operationId === key);
    return record ? { ...record } : null;
  }

  public async listCommands(sandboxId: string): Promise<SandboxCommandRecord[]> {
    return [...this.commands.entries()]
      .filter(([key]) => key.startsWith(`${sandboxId}:`))
      .map(([, record]) => ({ ...record }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async getPreview(sandboxId: string, previewId: string): Promise<SandboxPreviewRecord | null> {
    const record = this.previews.get(this.commandKey(sandboxId, previewId));
    return record ? { ...record } : null;
  }

  public async listPreviews(sandboxId: string): Promise<SandboxPreviewRecord[]> {
    return [...this.previews.entries()]
      .filter(([key]) => key.startsWith(`${sandboxId}:`))
      .map(([, record]) => ({ ...record }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async putPreview(record: SandboxPreviewRecord): Promise<{ ok: true } | { ok: false; error: 'UNAVAILABLE' | 'CONFLICT' }> {
    const key = this.commandKey(record.sandboxId, record.previewId);
    const existing = this.previews.get(key);
    if (existing && existing.payloadHash !== record.payloadHash) return { ok: false, error: 'CONFLICT' };
    if (!existing) this.previews.set(key, { ...record });
    return { ok: true };
  }

  public async commitCommand(command: SandboxCommandRecord, state: SandboxStateRecord, expectedStateVersion: number, previewId?: string): Promise<SandboxCommandWriteResult> {
    const idempotencyKey = command.idempotencyKey ?? command.operationId;
    const key = this.commandKey(command.sandboxId, idempotencyKey);
    const existingCommand = this.commands.get(key)
      ?? [...this.commands.values()].find((candidate) => candidate.sandboxId === command.sandboxId && candidate.operationId === command.operationId);
    if (existingCommand) {
      if (existingCommand.payloadHash !== command.payloadHash || existingCommand.command !== command.command || existingCommand.mode !== command.mode) {
        return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: { ...existingCommand } };
      }
      return { ok: true, record: { ...existingCommand }, duplicate: true };
    }
    const existingState = this.records.get(state.id);
    const actualStateVersion = existingState?.stateVersion ?? 0;
    if (actualStateVersion !== expectedStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
    const preview = previewId ? this.previews.get(this.commandKey(command.sandboxId, previewId)) : undefined;
    if (previewId && (!preview || preview.status !== 'PENDING')) return { ok: false, error: 'CONFLICT', actualStateVersion };
    this.records.set(state.id, { ...state });
    this.commands.set(key, { ...command });
    if (preview) this.previews.set(this.commandKey(command.sandboxId, preview.previewId), { ...preview, status: 'COMMITTED', committedOperationId: command.operationId });
    return { ok: true, record: { ...command } };
  }

  public async purgeExpired(now: string): Promise<void> {
    for (const [key, record] of this.commands) {
      if (record.expiresAt <= now) this.commands.delete(key);
    }
    for (const [key, record] of this.previews) {
      if (record.retentionExpiresAt <= now) this.previews.delete(key);
    }
  }

  public async putPreviewAndCommand(preview: SandboxPreviewRecord, command: SandboxCommandRecord, state: SandboxStateRecord, expectedStateVersion: number): Promise<SandboxCommandWriteResult> {
    const idempotencyKey = command.idempotencyKey ?? command.operationId;
    const existingCommand = await this.getCommand(command.sandboxId, idempotencyKey);
    if (existingCommand) {
      if (existingCommand.payloadHash !== command.payloadHash || existingCommand.command !== command.command || existingCommand.mode !== command.mode) return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: existingCommand };
      return { ok: true, record: existingCommand, duplicate: true };
    }
    const existingPreview = await this.getPreview(preview.sandboxId, preview.previewId);
    if (existingPreview && existingPreview.payloadHash !== preview.payloadHash) return { ok: false, error: 'IDEMPOTENCY_CONFLICT' };
    const existingState = this.records.get(state.id);
    const actualStateVersion = existingState?.stateVersion ?? 0;
    if (actualStateVersion !== expectedStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
    if (!existingPreview) this.previews.set(this.commandKey(preview.sandboxId, preview.previewId), { ...preview });
    this.records.set(state.id, { ...state });
    this.commands.set(this.commandKey(command.sandboxId, idempotencyKey), { ...command });
    return { ok: true, record: { ...command } };
  }

  public async commitReplay(commands: SandboxCommandRecord[], state: SandboxStateRecord, expectedStateVersion: number): Promise<SandboxCommandWriteResult> {
    if (!commands.length) return { ok: false, error: 'UNAVAILABLE' };
    const existingState = this.records.get(state.id);
    const actualStateVersion = existingState?.stateVersion ?? 0;
    if (actualStateVersion !== expectedStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
    let duplicate = true;
    for (const command of commands) {
      const key = this.commandKey(command.sandboxId, command.idempotencyKey ?? command.operationId);
      const existing = this.commands.get(key) ?? [...this.commands.values()].find((candidate) => candidate.sandboxId === command.sandboxId && candidate.operationId === command.operationId);
      if (!existing) {
        duplicate = false;
        continue;
      }
      if (existing.payloadHash !== command.payloadHash || existing.command !== command.command || existing.mode !== command.mode) {
        return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: { ...existing } };
      }
    }
    if (duplicate) return { ok: true, record: { ...commands.at(-1)! }, duplicate: true };
    if (state.stateVersion < expectedStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
    for (const command of commands) {
      this.commands.set(this.commandKey(command.sandboxId, command.idempotencyKey ?? command.operationId), { ...command });
    }
    this.records.set(state.id, { ...state });
    return { ok: true, record: { ...commands.at(-1)! } };
  }
}

export class FakeD1SandboxStateStore extends MemorySandboxStateStore {
  public unavailable = false;
  public failNext = false;
  public faultPoint: SandboxFaultPoint | null = null;

  public injectFailure(point: SandboxFaultPoint): void {
    this.faultPoint = point;
  }

  public clearFailure(): void {
    this.faultPoint = null;
  }

  private consumeFailure(...points: SandboxFaultPoint[]): boolean {
    if (!this.faultPoint || !points.includes(this.faultPoint)) return false;
    this.faultPoint = null;
    return true;
  }

  public override async get(id: string): Promise<SandboxStateRecord | null> {
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart', 'request-abort', 'corrupted-state')) {
      this.failNext = false;
      throw new Error('D1_UNAVAILABLE');
    }
    return super.get(id);
  }

  public override async put(record: SandboxStateRecord, expectedStateVersion?: number, force = false): Promise<SandboxStoreWriteResult> {
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart', 'command-after-record-before-state')) {
      this.failNext = false;
      return { ok: false, error: 'UNAVAILABLE' };
    }
    return super.put(record, expectedStateVersion, force);
  }

  public override async getCommand(sandboxId: string, key: string): Promise<SandboxCommandRecord | null> {
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart', 'request-abort', 'corrupted-state')) {
      this.failNext = false;
      throw new Error('D1_UNAVAILABLE');
    }
    return super.getCommand(sandboxId, key);
  }

  public override async listCommands(sandboxId: string): Promise<SandboxCommandRecord[]> {
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart')) {
      this.failNext = false;
      throw new Error('D1_UNAVAILABLE');
    }
    return super.listCommands(sandboxId);
  }

  public override async getPreview(sandboxId: string, previewId: string): Promise<SandboxPreviewRecord | null> {
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart', 'request-abort', 'corrupted-state')) {
      this.failNext = false;
      throw new Error('D1_UNAVAILABLE');
    }
    return super.getPreview(sandboxId, previewId);
  }

  public override async listPreviews(sandboxId: string): Promise<SandboxPreviewRecord[]> {
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart')) {
      this.failNext = false;
      throw new Error('D1_UNAVAILABLE');
    }
    return super.listPreviews(sandboxId);
  }

  public override async putPreview(record: SandboxPreviewRecord): Promise<{ ok: true } | { ok: false; error: 'UNAVAILABLE' | 'CONFLICT' }> {
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart', 'command-before-record')) {
      this.failNext = false;
      return { ok: false, error: 'UNAVAILABLE' };
    }
    return super.putPreview(record);
  }

  public override async commitCommand(command: SandboxCommandRecord, state: SandboxStateRecord, expectedStateVersion: number, previewId?: string): Promise<SandboxCommandWriteResult> {
    const injectedFault = this.faultPoint;
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart', 'command-before-record', 'command-after-record-before-state', 'cas-conflict')) {
      this.failNext = false;
      return { ok: false, error: injectedFault === 'cas-conflict' ? 'CONFLICT' : 'UNAVAILABLE' };
    }
    const result = await super.commitCommand(command, state, expectedStateVersion, previewId);
    if (this.consumeFailure('state-after-response-before-client')) throw new Error('REQUEST_ABORT');
    return result;
  }

  public override async commitReplay(commands: SandboxCommandRecord[], state: SandboxStateRecord, expectedStateVersion: number): Promise<SandboxCommandWriteResult> {
    const injectedFault = this.faultPoint;
    if (this.unavailable || this.failNext || this.consumeFailure('d1-unavailable', 'd1-timeout', 'worker-restart', 'command-before-record', 'command-after-record-before-state', 'cas-conflict')) {
      this.failNext = false;
      return { ok: false, error: injectedFault === 'cas-conflict' ? 'CONFLICT' : 'UNAVAILABLE' };
    }
    const result = await super.commitReplay(commands, state, expectedStateVersion);
    if (this.consumeFailure('state-after-response-before-client')) throw new Error('REQUEST_ABORT');
    return result;
  }
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all?<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch?(statements: D1PreparedStatementLike[]): Promise<Array<{ success?: boolean; meta?: { changes?: number } }>>;
}

/** Production adapter kept behind the same contract as the memory/fake stores. */
export class D1SandboxStateStore implements SandboxStateStore {
  private readonly database: D1DatabaseLike;

  public constructor(database: D1DatabaseLike) {
    this.database = database;
  }

  public async get(id: string): Promise<SandboxStateRecord | null> {
    const row = await this.database.prepare(`SELECT id, scenario_id AS scenarioId, seed, state_version AS stateVersion, virtual_now AS virtualNow, payload, updated_at AS updatedAt FROM sandbox_states WHERE id = ?1 LIMIT 1`).bind(id).first<SandboxStateRecord>();
    return row ? { ...row } : null;
  }

  public async put(record: SandboxStateRecord, expectedStateVersion?: number, force = false): Promise<SandboxStoreWriteResult> {
    // The read below is only an early, friendly conflict response. The write
    // itself is always guarded by the state_version predicate, so a racing
    // worker cannot overwrite a newer state after this read.
    if (!force) {
      const existing = await this.get(record.id);
      const actualStateVersion = existing?.stateVersion ?? 0;
      if (expectedStateVersion !== undefined && expectedStateVersion !== actualStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
      if (expectedStateVersion === undefined && existing && record.stateVersion < existing.stateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
    }
    const statement = force
      ? `INSERT INTO sandbox_states (id, scenario_id, seed, state_version, virtual_now, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET scenario_id = excluded.scenario_id, seed = excluded.seed, state_version = excluded.state_version, virtual_now = excluded.virtual_now, payload = excluded.payload, updated_at = excluded.updated_at`
      : expectedStateVersion === undefined
        ? `INSERT INTO sandbox_states (id, scenario_id, seed, state_version, virtual_now, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET scenario_id = excluded.scenario_id, seed = excluded.seed, state_version = excluded.state_version, virtual_now = excluded.virtual_now, payload = excluded.payload, updated_at = excluded.updated_at WHERE sandbox_states.state_version <= excluded.state_version`
        : `INSERT INTO sandbox_states (id, scenario_id, seed, state_version, virtual_now, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET scenario_id = excluded.scenario_id, seed = excluded.seed, state_version = excluded.state_version, virtual_now = excluded.virtual_now, payload = excluded.payload, updated_at = excluded.updated_at WHERE sandbox_states.state_version = ?8`;
    const values = expectedStateVersion === undefined || force
      ? [record.id, record.scenarioId, record.seed, record.stateVersion, record.virtualNow, record.payload, record.updatedAt]
      : [record.id, record.scenarioId, record.seed, record.stateVersion, record.virtualNow, record.payload, record.updatedAt, expectedStateVersion];
    const result = await this.database.prepare(statement).bind(...values).run();
    if (result.meta?.changes === 0 && !force) {
      const actualStateVersion = (await this.get(record.id))?.stateVersion ?? 0;
      return { ok: false, error: 'CONFLICT', actualStateVersion };
    }
    return { ok: true, record: { ...record } };
  }

  public async getCommand(sandboxId: string, key: string): Promise<SandboxCommandRecord | null> {
    const row = await this.database.prepare(`SELECT operation_id AS operationId, sandbox_id AS sandboxId, actor_id AS actorId, command, mode, idempotency_key AS idempotencyKey, request_id AS requestId, command_id AS commandId, payload_hash AS payloadHash, state_version_before AS stateVersionBefore, state_version_after AS stateVersionAfter, status, result_json AS result, created_at AS createdAt, expires_at AS expiresAt FROM sandbox_command_records WHERE sandbox_id = ?1 AND (idempotency_key = ?2 OR operation_id = ?2) LIMIT 1`).bind(sandboxId, key).first<SandboxCommandRecord>();
    return row ? { ...row } : null;
  }

  public async listCommands(sandboxId: string): Promise<SandboxCommandRecord[]> {
    const statement = this.database.prepare(`SELECT operation_id AS operationId, sandbox_id AS sandboxId, actor_id AS actorId, command, mode, idempotency_key AS idempotencyKey, request_id AS requestId, command_id AS commandId, payload_hash AS payloadHash, state_version_before AS stateVersionBefore, state_version_after AS stateVersionAfter, status, result_json AS result, created_at AS createdAt, expires_at AS expiresAt FROM sandbox_command_records WHERE sandbox_id = ?1 ORDER BY created_at ASC`).bind(sandboxId);
    if (!statement.all) return [];
    const result = await statement.all<SandboxCommandRecord>();
    return Array.isArray(result.results) ? result.results.map((row) => ({ ...row })) : [];
  }

  public async getPreview(sandboxId: string, previewId: string): Promise<SandboxPreviewRecord | null> {
    const row = await this.database.prepare(`SELECT preview_id AS previewId, sandbox_id AS sandboxId, actor_id AS actorId, command, payload_json AS payload, payload_hash AS payloadHash, base_state_version AS baseStateVersion, summary_json AS summary, status, created_at AS createdAt, virtual_expires_at AS virtualExpiresAt, retention_expires_at AS retentionExpiresAt, committed_operation_id AS committedOperationId FROM sandbox_preview_records WHERE sandbox_id = ?1 AND preview_id = ?2 LIMIT 1`).bind(sandboxId, previewId).first<SandboxPreviewRecord>();
    return row ? { ...row } : null;
  }

  public async listPreviews(sandboxId: string): Promise<SandboxPreviewRecord[]> {
    const statement = this.database.prepare(`SELECT preview_id AS previewId, sandbox_id AS sandboxId, actor_id AS actorId, command, payload_json AS payload, payload_hash AS payloadHash, base_state_version AS baseStateVersion, summary_json AS summary, status, created_at AS createdAt, virtual_expires_at AS virtualExpiresAt, retention_expires_at AS retentionExpiresAt, committed_operation_id AS committedOperationId FROM sandbox_preview_records WHERE sandbox_id = ?1 ORDER BY created_at ASC`).bind(sandboxId);
    if (!statement.all) return [];
    const rows = await statement.all<SandboxPreviewRecord>();
    return Array.isArray(rows.results) ? rows.results.map((row) => ({ ...row })) : [];
  }

  public async putPreview(record: SandboxPreviewRecord): Promise<{ ok: true; durability?: 'persistent' | 'volatile' } | { ok: false; error: 'UNAVAILABLE' | 'CONFLICT' }> {
    try {
      const existing = await this.getPreview(record.sandboxId, record.previewId);
      if (existing) return existing.payloadHash === record.payloadHash ? { ok: true } : { ok: false, error: 'CONFLICT' };
      const result = await this.database.prepare(`INSERT INTO sandbox_preview_records (preview_id, sandbox_id, actor_id, command, payload_json, payload_hash, base_state_version, summary_json, status, created_at, virtual_expires_at, retention_expires_at, committed_operation_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`).bind(record.previewId, record.sandboxId, record.actorId, record.command, record.payload, record.payloadHash, record.baseStateVersion, record.summary, record.status, record.createdAt, record.virtualExpiresAt, record.retentionExpiresAt, record.committedOperationId ?? null).run();
      if (result.meta?.changes === 0) {
        const existing = await this.getPreview(record.sandboxId, record.previewId);
        return existing?.payloadHash === record.payloadHash ? { ok: true } : { ok: false, error: 'CONFLICT' };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  public async purgeExpired(now: string): Promise<void> {
    await this.database.prepare(`DELETE FROM sandbox_command_records WHERE expires_at <= ?1`).bind(now).run();
    await this.database.prepare(`DELETE FROM sandbox_preview_records WHERE retention_expires_at <= ?1`).bind(now).run();
  }

  public async putPreviewAndCommand(preview: SandboxPreviewRecord, command: SandboxCommandRecord, state: SandboxStateRecord, expectedStateVersion: number): Promise<SandboxCommandWriteResult> {
    const idempotencyKey = command.idempotencyKey ?? command.operationId;
    try {
      const existingCommand = await this.getCommand(command.sandboxId, idempotencyKey);
      if (existingCommand) {
        if (existingCommand.payloadHash !== command.payloadHash || existingCommand.command !== command.command || existingCommand.mode !== command.mode) return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: existingCommand };
        return { ok: true, record: existingCommand, duplicate: true };
      }
      const existingPreview = await this.getPreview(preview.sandboxId, preview.previewId);
      if (existingPreview && existingPreview.payloadHash !== preview.payloadHash) return { ok: false, error: 'IDEMPOTENCY_CONFLICT' };
      const existingState = await this.get(state.id);
      const actualStateVersion = existingState?.stateVersion ?? 0;
      if (actualStateVersion !== expectedStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
      const statements: D1PreparedStatementLike[] = [];
      if (!existingPreview) {
        statements.push(this.database.prepare(`INSERT INTO sandbox_preview_records (preview_id, sandbox_id, actor_id, command, payload_json, payload_hash, base_state_version, summary_json, status, created_at, virtual_expires_at, retention_expires_at, committed_operation_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`).bind(preview.previewId, preview.sandboxId, preview.actorId, preview.command, preview.payload, preview.payloadHash, preview.baseStateVersion, preview.summary, preview.status, preview.createdAt, preview.virtualExpiresAt, preview.retentionExpiresAt, preview.committedOperationId ?? null));
      }
      const commandInsert = this.database.prepare(`INSERT INTO sandbox_command_records (operation_id, sandbox_id, actor_id, command, mode, idempotency_key, request_id, command_id, payload_hash, state_version_before, state_version_after, status, result_json, created_at, expires_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15 WHERE EXISTS (SELECT 1 FROM sandbox_states WHERE id = ?16 AND state_version = ?17) AND NOT EXISTS (SELECT 1 FROM sandbox_command_records WHERE sandbox_id = ?18 AND idempotency_key = ?19)`).bind(command.operationId, command.sandboxId, command.actorId, command.command, command.mode, idempotencyKey, command.requestId ?? null, command.commandId ?? null, command.payloadHash, command.stateVersionBefore, command.stateVersionAfter, command.status, command.result, command.createdAt, command.expiresAt, state.id, expectedStateVersion, command.sandboxId, idempotencyKey);
      statements.push(commandInsert);
      const commandIndex = statements.length - 1;
      statements.push(this.database.prepare(`INSERT INTO sandbox_states (id, scenario_id, seed, state_version, virtual_now, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET scenario_id = excluded.scenario_id, seed = excluded.seed, state_version = excluded.state_version, virtual_now = excluded.virtual_now, payload = excluded.payload, updated_at = excluded.updated_at WHERE sandbox_states.state_version = ?8 AND EXISTS (SELECT 1 FROM sandbox_command_records WHERE operation_id = ?9 AND sandbox_id = ?10 AND idempotency_key = ?11)`).bind(state.id, state.scenarioId, state.seed, state.stateVersion, state.virtualNow, state.payload, state.updatedAt, expectedStateVersion, command.operationId, command.sandboxId, idempotencyKey));
      if (!this.database.batch) return { ok: false, error: 'UNAVAILABLE' };
      const results = await this.database.batch(statements);
      if (results[commandIndex]?.meta?.changes === 0) {
        const duplicate = await this.getCommand(command.sandboxId, idempotencyKey);
        if (duplicate && duplicate.payloadHash === command.payloadHash && duplicate.command === command.command && duplicate.mode === command.mode) return { ok: true, record: duplicate, duplicate: true };
        return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: duplicate ?? undefined };
      }
      const stateChanges = results.at(-1)?.meta?.changes;
      if (stateChanges === 0) return { ok: false, error: 'CONFLICT', actualStateVersion: (await this.get(state.id))?.stateVersion };
      return { ok: true, record: { ...command } };
    } catch {
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  public async commitReplay(commands: SandboxCommandRecord[], state: SandboxStateRecord, expectedStateVersion: number): Promise<SandboxCommandWriteResult> {
    if (!commands.length) return { ok: false, error: 'UNAVAILABLE' };
    try {
      const existing = await this.get(state.id);
      const actualStateVersion = existing?.stateVersion ?? 0;
      if (actualStateVersion !== expectedStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
      const idempotencyKeys = commands.map((command) => command.idempotencyKey ?? command.operationId);
      const existingCommands = await Promise.all(commands.map((command, index) => this.getCommand(command.sandboxId, idempotencyKeys[index])));
      const existingCount = existingCommands.filter(Boolean).length;
      for (let index = 0; index < commands.length; index += 1) {
        const existingCommand = existingCommands[index];
        if (!existingCommand) continue;
        const command = commands[index];
        if (existingCommand.payloadHash !== command.payloadHash || existingCommand.command !== command.command || existingCommand.mode !== command.mode) {
          return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: existingCommand };
        }
      }
      if (existingCount === commands.length) return { ok: true, record: { ...commands.at(-1)! }, duplicate: true };
      if (existingCount > 0) return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: existingCommands.find(Boolean) ?? undefined };
      if (!this.database.batch) return { ok: false, error: 'UNAVAILABLE' };
      const commandStatements = commands.map((command, index) => this.database.prepare(`INSERT INTO sandbox_command_records (operation_id, sandbox_id, actor_id, command, mode, idempotency_key, request_id, command_id, payload_hash, state_version_before, state_version_after, status, result_json, created_at, expires_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15 WHERE EXISTS (SELECT 1 FROM sandbox_states WHERE id = ?16 AND state_version = ?17) AND NOT EXISTS (SELECT 1 FROM sandbox_command_records WHERE sandbox_id = ?18 AND idempotency_key = ?19)`).bind(command.operationId, command.sandboxId, command.actorId, command.command, command.mode, idempotencyKeys[index], command.requestId ?? null, command.commandId ?? null, command.payloadHash, command.stateVersionBefore, command.stateVersionAfter, command.status, command.result, command.createdAt, command.expiresAt, state.id, expectedStateVersion, command.sandboxId, idempotencyKeys[index]));
      const keyPlaceholders = idempotencyKeys.map((_, index) => `?${11 + index}`).join(', ');
      const stateStatement = this.database.prepare(`INSERT INTO sandbox_states (id, scenario_id, seed, state_version, virtual_now, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET scenario_id = excluded.scenario_id, seed = excluded.seed, state_version = excluded.state_version, virtual_now = excluded.virtual_now, payload = excluded.payload, updated_at = excluded.updated_at WHERE sandbox_states.state_version = ?8 AND (SELECT COUNT(*) FROM sandbox_command_records WHERE sandbox_id = ?9 AND idempotency_key IN (${keyPlaceholders})) = ?10`).bind(state.id, state.scenarioId, state.seed, state.stateVersion, state.virtualNow, state.payload, state.updatedAt, expectedStateVersion, state.id, commands.length, ...idempotencyKeys);
      const results = await this.database.batch([...commandStatements, stateStatement]);
      if (results.slice(0, commands.length).some((result) => result.meta?.changes === 0)) return { ok: false, error: 'IDEMPOTENCY_CONFLICT' };
      if (results.at(-1)?.meta?.changes === 0) return { ok: false, error: 'CONFLICT', actualStateVersion: (await this.get(state.id))?.stateVersion };
      return { ok: true, record: { ...commands.at(-1)! } };
    } catch {
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  public async commitCommand(command: SandboxCommandRecord, state: SandboxStateRecord, expectedStateVersion: number, previewId?: string): Promise<SandboxCommandWriteResult> {
    const idempotencyKey = command.idempotencyKey ?? command.operationId;
    const existingCommand = await this.getCommand(command.sandboxId, idempotencyKey);
    if (existingCommand) {
      if (existingCommand.payloadHash !== command.payloadHash || existingCommand.command !== command.command || existingCommand.mode !== command.mode) return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: existingCommand };
      return { ok: true, record: existingCommand, duplicate: true };
    }
    const existingState = await this.get(state.id);
    const actualStateVersion = existingState?.stateVersion ?? 0;
    if (actualStateVersion !== expectedStateVersion) return { ok: false, error: 'CONFLICT', actualStateVersion };
    if (previewId) {
      const preview = await this.getPreview(command.sandboxId, previewId);
      if (!preview || preview.status !== 'PENDING') return { ok: false, error: 'CONFLICT', actualStateVersion };
    }
    // Both statements are run in one D1 batch transaction. The command row is
    // inserted only while the expected state version exists; the state update
    // is applied only when that exact command row was inserted by this call.
    // This prevents a stale worker from leaving a command record without its
    // corresponding state transition.
    const commandInsert = this.database.prepare(`INSERT INTO sandbox_command_records (operation_id, sandbox_id, actor_id, command, mode, idempotency_key, request_id, command_id, payload_hash, state_version_before, state_version_after, status, result_json, created_at, expires_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15 WHERE EXISTS (SELECT 1 FROM sandbox_states WHERE id = ?16 AND state_version = ?17) AND NOT EXISTS (SELECT 1 FROM sandbox_command_records WHERE sandbox_id = ?18 AND idempotency_key = ?19) AND (?20 IS NULL OR EXISTS (SELECT 1 FROM sandbox_preview_records WHERE sandbox_id = ?18 AND preview_id = ?20 AND status = 'PENDING'))`).bind(command.operationId, command.sandboxId, command.actorId, command.command, command.mode, idempotencyKey, command.requestId ?? null, command.commandId ?? null, command.payloadHash, command.stateVersionBefore, command.stateVersionAfter, command.status, command.result, command.createdAt, command.expiresAt, state.id, expectedStateVersion, command.sandboxId, idempotencyKey, previewId ?? null);
    const stateUpsert = this.database.prepare(`INSERT INTO sandbox_states (id, scenario_id, seed, state_version, virtual_now, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET scenario_id = excluded.scenario_id, seed = excluded.seed, state_version = excluded.state_version, virtual_now = excluded.virtual_now, payload = excluded.payload, updated_at = excluded.updated_at WHERE sandbox_states.state_version = ?8 AND EXISTS (SELECT 1 FROM sandbox_command_records WHERE operation_id = ?9 AND sandbox_id = ?10 AND idempotency_key = ?11)`).bind(state.id, state.scenarioId, state.seed, state.stateVersion, state.virtualNow, state.payload, state.updatedAt, expectedStateVersion, command.operationId, command.sandboxId, idempotencyKey);
    const previewUpdate = previewId ? this.database.prepare(`UPDATE sandbox_preview_records SET status = 'COMMITTED', committed_operation_id = ?1 WHERE sandbox_id = ?2 AND preview_id = ?3 AND status = 'PENDING' AND EXISTS (SELECT 1 FROM sandbox_command_records WHERE operation_id = ?1 AND sandbox_id = ?2 AND idempotency_key = ?4)`).bind(command.operationId, command.sandboxId, previewId, idempotencyKey) : null;
    try {
      if (this.database.batch) {
        const statements = previewUpdate ? [commandInsert, stateUpsert, previewUpdate] : [commandInsert, stateUpsert];
        const results = await this.database.batch(statements);
        const commandChanges = results[0]?.meta?.changes;
        if (commandChanges === 0) {
          const duplicate = await this.getCommand(command.sandboxId, idempotencyKey);
          if (duplicate && duplicate.payloadHash === command.payloadHash && duplicate.command === command.command && duplicate.mode === command.mode) return { ok: true, record: duplicate, duplicate: true };
          return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: duplicate ?? undefined };
        }
        const stateChanges = results[1]?.meta?.changes;
        if (stateChanges === 0) return { ok: false, error: 'CONFLICT', actualStateVersion: (await this.get(state.id))?.stateVersion };
      } else {
        // D1's production adapter always exposes batch(). Refusing a
        // non-transactional fallback is safer than leaving a state-only or
        // command-only write when a test/dummy adapter omits it.
        return { ok: false, error: 'UNAVAILABLE' };
      }
      return { ok: true, record: { ...command } };
    } catch {
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }
}
