import type {
  SandboxCommandRecord,
  SandboxCommandWriteResult,
  SandboxPreviewRecord,
  SandboxFaultPoint,
  SandboxStateRecord,
  SandboxStateStore,
  SandboxStoreWriteResult,
} from './sandboxStore.ts';
import { MemorySandboxStateStore } from './sandboxStore.ts';

const DATABASE_NAME = 'furima-sandbox-state-v1';
const DATABASE_VERSION = 2;
const STATES_STORE = 'states';
const COMMANDS_STORE = 'commands';
const PREVIEWS_STORE = 'previews';
const COMMAND_SANDBOX_INDEX = 'sandbox_created_at';
const PREVIEW_SANDBOX_INDEX = 'sandbox_created_at';

type StoredCommand = SandboxCommandRecord & { key: string };
type StoredPreview = SandboxPreviewRecord & { key: string };

const commandRecordFromStored = (stored: StoredCommand): SandboxCommandRecord => {
  const record = { ...stored } as Partial<StoredCommand>;
  delete record.key;
  return record as SandboxCommandRecord;
};

const previewRecordFromStored = (stored: StoredPreview): SandboxPreviewRecord => {
  const record = { ...stored } as Partial<StoredPreview>;
  delete record.key;
  return record as SandboxPreviewRecord;
};

export interface SandboxStorageDiagnostics {
  backend: 'indexeddb' | 'memory';
  ready: boolean;
  fallbackReason?: 'UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'CORRUPTED' | 'VERSION_MISMATCH';
  migratedLegacyLocalStorage: boolean;
}

const keyFor = (sandboxId: string, value: string): string => `${sandboxId}::${value}`;

const requestResult = <T,>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
});

const transactionResult = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
});

const isQuotaError = (error: unknown): boolean => {
  const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
};

/**
 * Browser persistence for the sandbox aggregate and its command records.
 *
 * The fallback is deliberately the same Memory store used by tests. Every
 * operation catches IndexedDB failures and records a diagnostic so the UI can
 * expose why a clean in-memory sandbox was selected instead of silently
 * pretending that state survived a reload.
 */
export class IndexedDbSandboxStateStore implements SandboxStateStore {
  private readonly fallback = new MemorySandboxStateStore();
  private databasePromise: Promise<IDBDatabase | null> | null = null;
  private faultPoint: SandboxFaultPoint | null = null;
  private diagnostic: SandboxStorageDiagnostics = {
    backend: 'memory',
    ready: false,
    migratedLegacyLocalStorage: false,
  };

  public getDiagnostics(): SandboxStorageDiagnostics {
    return { ...this.diagnostic };
  }

  public markLegacyMigration(): void {
    this.diagnostic.migratedLegacyLocalStorage = true;
  }

  public recordFailure(reason: SandboxStorageDiagnostics['fallbackReason']): void {
    this.diagnostic = { ...this.diagnostic, backend: 'memory', ready: true, fallbackReason: reason };
  }

  public injectFailure(point: SandboxFaultPoint): void {
    this.faultPoint = point;
  }

  public clearFailure(): void {
    this.faultPoint = null;
  }

  public async ready(): Promise<SandboxStorageDiagnostics> {
    await this.database();
    return this.getDiagnostics();
  }

  public async get(id: string): Promise<SandboxStateRecord | null> {
    const injected = this.consumeIndexedDbFailure('indexeddb-quota-exceeded', 'corrupted-state');
    if (injected) return this.fallback.get(id);
    const database = await this.database();
    if (!database) return this.fallback.get(id);
    try {
      const transaction = database.transaction(STATES_STORE, 'readonly');
      const result = await requestResult(transaction.objectStore(STATES_STORE).get(id));
      return result ? { ...(result as SandboxStateRecord) } : null;
    } catch (error) {
      this.fallbackFrom(error);
      return this.fallback.get(id);
    }
  }

  public async put(record: SandboxStateRecord, expectedStateVersion?: number, force = false): Promise<SandboxStoreWriteResult> {
    const injected = this.consumeIndexedDbFailure('indexeddb-quota-exceeded', 'corrupted-state');
    if (injected) return this.volatileStateResult(await this.fallback.put(record, expectedStateVersion, force));
    const database = await this.database();
    if (!database) return this.volatileStateResult(await this.fallback.put(record, expectedStateVersion, force));
    try {
      const transaction = database.transaction(STATES_STORE, 'readwrite');
      const store = transaction.objectStore(STATES_STORE);
      const existing = await requestResult(store.get(record.id)) as SandboxStateRecord | undefined;
      const actualStateVersion = existing?.stateVersion ?? 0;
      if (!force && expectedStateVersion !== undefined && expectedStateVersion !== actualStateVersion) {
        transaction.abort();
        return { ok: false, error: 'CONFLICT', actualStateVersion };
      }
      if (!force && expectedStateVersion === undefined && existing && record.stateVersion < existing.stateVersion) {
        transaction.abort();
        return { ok: false, error: 'CONFLICT', actualStateVersion };
      }
      store.put({ ...record });
      await transactionResult(transaction);
      return { ok: true, record: { ...record }, durability: 'persistent' };
    } catch (error) {
      this.fallbackFrom(error);
      return this.volatileStateResult(await this.fallback.put(record, expectedStateVersion, force));
    }
  }

  public async getCommand(sandboxId: string, key: string): Promise<SandboxCommandRecord | null> {
    const database = await this.database();
    if (!database) return this.fallback.getCommand(sandboxId, key);
    try {
      const transaction = database.transaction(COMMANDS_STORE, 'readonly');
      const result = await requestResult(transaction.objectStore(COMMANDS_STORE).get(keyFor(sandboxId, key))) as StoredCommand | undefined;
      if (!result) return null;
      return commandRecordFromStored(result);
    } catch (error) {
      this.fallbackFrom(error);
      return this.fallback.getCommand(sandboxId, key);
    }
  }

  public async listCommands(sandboxId: string): Promise<SandboxCommandRecord[]> {
    const database = await this.database();
    if (!database) return this.fallback.listCommands(sandboxId);
    try {
      const transaction = database.transaction(COMMANDS_STORE, 'readonly');
      const store = transaction.objectStore(COMMANDS_STORE);
      const source = store.indexNames.contains(COMMAND_SANDBOX_INDEX)
        ? store.index(COMMAND_SANDBOX_INDEX).getAll(IDBKeyRange.bound([sandboxId, ''], [sandboxId, '\uffff']))
        : store.getAll();
      const rows = await requestResult(source) as StoredCommand[];
      return rows.filter((row) => row.sandboxId === sandboxId).map(commandRecordFromStored);
    } catch (error) {
      this.fallbackFrom(error);
      return this.fallback.listCommands(sandboxId);
    }
  }

  public async getPreview(sandboxId: string, previewId: string): Promise<SandboxPreviewRecord | null> {
    const database = await this.database();
    if (!database) return this.fallback.getPreview(sandboxId, previewId);
    try {
      const transaction = database.transaction(PREVIEWS_STORE, 'readonly');
      const result = await requestResult(transaction.objectStore(PREVIEWS_STORE).get(keyFor(sandboxId, previewId))) as StoredPreview | undefined;
      if (!result) return null;
      return previewRecordFromStored(result);
    } catch (error) {
      this.fallbackFrom(error);
      return this.fallback.getPreview(sandboxId, previewId);
    }
  }

  public async listPreviews(sandboxId: string): Promise<SandboxPreviewRecord[]> {
    const database = await this.database();
    if (!database) return this.fallback.listPreviews(sandboxId);
    try {
      const transaction = database.transaction(PREVIEWS_STORE, 'readonly');
      const store = transaction.objectStore(PREVIEWS_STORE);
      const source = store.indexNames.contains(PREVIEW_SANDBOX_INDEX)
        ? store.index(PREVIEW_SANDBOX_INDEX).getAll(IDBKeyRange.bound([sandboxId, ''], [sandboxId, '\uffff']))
        : store.getAll();
      const rows = await requestResult(source) as StoredPreview[];
      return rows.filter((row) => row.sandboxId === sandboxId).map(previewRecordFromStored);
    } catch (error) {
      this.fallbackFrom(error);
      return this.fallback.listPreviews(sandboxId);
    }
  }

  public async putPreview(record: SandboxPreviewRecord): Promise<{ ok: true; durability?: 'persistent' | 'volatile' } | { ok: false; error: 'UNAVAILABLE' | 'CONFLICT' }> {
    const injected = this.consumeIndexedDbFailure('indexeddb-quota-exceeded', 'corrupted-state');
    if (injected) return this.volatilePreviewResult(await this.fallback.putPreview(record));
    const database = await this.database();
    if (!database) return this.volatilePreviewResult(await this.fallback.putPreview(record));
    try {
      const transaction = database.transaction(PREVIEWS_STORE, 'readwrite');
      const store = transaction.objectStore(PREVIEWS_STORE);
      const key = keyFor(record.sandboxId, record.previewId);
      const existing = await requestResult(store.get(key)) as StoredPreview | undefined;
      if (existing && existing.payloadHash !== record.payloadHash) {
        transaction.abort();
        return { ok: false, error: 'CONFLICT' };
      }
      if (!existing) store.add({ ...record, key });
      await transactionResult(transaction);
      return { ok: true, durability: 'persistent' };
    } catch (error) {
      this.fallbackFrom(error);
      const fallbackResult = await this.fallback.putPreview(record);
      return this.volatilePreviewResult(fallbackResult);
    }
  }

  public async putPreviewAndCommand(preview: SandboxPreviewRecord, command: SandboxCommandRecord, state: SandboxStateRecord, expectedStateVersion: number): Promise<SandboxCommandWriteResult> {
    const injected = this.consumeIndexedDbFailure('indexeddb-quota-exceeded', 'corrupted-state');
    if (injected) return this.volatileCommandResult(await this.fallback.putPreviewAndCommand(preview, command, state, expectedStateVersion));
    const database = await this.database();
    if (!database) return this.volatileCommandResult(await this.fallback.putPreviewAndCommand(preview, command, state, expectedStateVersion));
    try {
      const transaction = database.transaction([STATES_STORE, COMMANDS_STORE, PREVIEWS_STORE], 'readwrite');
      const stateStore = transaction.objectStore(STATES_STORE);
      const commandStore = transaction.objectStore(COMMANDS_STORE);
      const previewStore = transaction.objectStore(PREVIEWS_STORE);
      const idempotencyKey = command.idempotencyKey ?? command.operationId;
      const commandKey = keyFor(command.sandboxId, idempotencyKey);
      const previewKey = keyFor(preview.sandboxId, preview.previewId);
      const [existingCommand, existingState, existingPreview] = await Promise.all([
        requestResult(commandStore.get(commandKey)) as Promise<StoredCommand | undefined>,
        requestResult(stateStore.get(state.id)) as Promise<SandboxStateRecord | undefined>,
        requestResult(previewStore.get(previewKey)) as Promise<StoredPreview | undefined>,
      ]);
      if (existingCommand) {
        const record = commandRecordFromStored(existingCommand);
        if (record.payloadHash !== command.payloadHash || record.command !== command.command || record.mode !== command.mode) { transaction.abort(); return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: record }; }
        transaction.abort();
        return { ok: true, record, duplicate: true, durability: 'persistent' };
      }
      if (existingPreview && existingPreview.payloadHash !== preview.payloadHash) { transaction.abort(); return { ok: false, error: 'IDEMPOTENCY_CONFLICT' }; }
      const actualStateVersion = existingState?.stateVersion ?? 0;
      if (actualStateVersion !== expectedStateVersion) { transaction.abort(); return { ok: false, error: 'CONFLICT', actualStateVersion }; }
      if (!existingPreview) previewStore.add({ ...preview, key: previewKey });
      // A preview records a command candidate but must not change durable
      // aggregate metadata such as the HTTP ETag timestamp.
      stateStore.put({ ...state, updatedAt: existingState?.updatedAt ?? state.updatedAt });
      commandStore.put({ ...command, key: commandKey });
      await transactionResult(transaction);
      return { ok: true, record: { ...command }, durability: 'persistent' };
    } catch (error) {
      this.fallbackFrom(error);
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  public async commitReplay(commands: SandboxCommandRecord[], state: SandboxStateRecord, expectedStateVersion: number): Promise<SandboxCommandWriteResult> {
    if (!commands.length) return { ok: false, error: 'UNAVAILABLE' };
    const injected = this.consumeIndexedDbFailure('indexeddb-quota-exceeded', 'corrupted-state');
    if (injected) return { ok: false, error: 'UNAVAILABLE' };
    const database = await this.database();
    if (!database) return { ok: false, error: 'UNAVAILABLE' };
    try {
      const transaction = database.transaction([STATES_STORE, COMMANDS_STORE], 'readwrite');
      const stateStore = transaction.objectStore(STATES_STORE);
      const commandStore = transaction.objectStore(COMMANDS_STORE);
      const [existingState, existingCommands] = await Promise.all([
        requestResult(stateStore.get(state.id)) as Promise<SandboxStateRecord | undefined>,
        Promise.all(commands.map((command) => requestResult(commandStore.get(keyFor(command.sandboxId, command.idempotencyKey ?? command.operationId))) as Promise<StoredCommand | undefined>)),
      ]);
      const actualStateVersion = existingState?.stateVersion ?? 0;
      if (actualStateVersion !== expectedStateVersion) { transaction.abort(); return { ok: false, error: 'CONFLICT', actualStateVersion }; }
      let existingCount = 0;
      let firstExisting: SandboxCommandRecord | undefined;
      for (let index = 0; index < existingCommands.length; index += 1) {
        const stored = existingCommands[index];
        if (!stored) continue;
        const existing = commandRecordFromStored(stored);
        existingCount += 1;
        firstExisting ??= existing;
        const command = commands[index];
        if (existing.payloadHash !== command.payloadHash || existing.command !== command.command || existing.mode !== command.mode) {
          transaction.abort();
          return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing };
        }
      }
      if (existingCount === commands.length) { transaction.abort(); return { ok: true, record: { ...commands.at(-1)! }, duplicate: true, durability: 'persistent' }; }
      if (existingCount > 0) { transaction.abort(); return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: firstExisting }; }
      commands.forEach((command) => commandStore.add({ ...command, key: keyFor(command.sandboxId, command.idempotencyKey ?? command.operationId) }));
      stateStore.put({ ...state });
      await transactionResult(transaction);
      return { ok: true, record: { ...commands.at(-1)! }, durability: 'persistent' };
    } catch (error) {
      this.fallbackFrom(error);
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  public async commitCommand(command: SandboxCommandRecord, state: SandboxStateRecord, expectedStateVersion: number, previewId?: string): Promise<SandboxCommandWriteResult> {
    const injected = this.consumeIndexedDbFailure('indexeddb-quota-exceeded', 'corrupted-state');
    if (injected) return this.volatileCommandResult(await this.fallback.commitCommand(command, state, expectedStateVersion, previewId));
    const database = await this.database();
    if (!database) return this.volatileCommandResult(await this.fallback.commitCommand(command, state, expectedStateVersion, previewId));
    try {
      const transaction = database.transaction([STATES_STORE, COMMANDS_STORE, PREVIEWS_STORE], 'readwrite');
      const stateStore = transaction.objectStore(STATES_STORE);
      const commandStore = transaction.objectStore(COMMANDS_STORE);
      const previewStore = transaction.objectStore(PREVIEWS_STORE);
      const idempotencyKey = command.idempotencyKey ?? command.operationId;
      const commandKey = keyFor(command.sandboxId, idempotencyKey);
      const [existingCommand, existingState, existingPreview] = await Promise.all([
        requestResult(commandStore.get(commandKey)) as Promise<StoredCommand | undefined>,
        requestResult(stateStore.get(state.id)) as Promise<SandboxStateRecord | undefined>,
        previewId ? requestResult(previewStore.get(keyFor(command.sandboxId, previewId))) as Promise<StoredPreview | undefined> : Promise.resolve(undefined),
      ]);
      if (existingCommand) {
        const record = commandRecordFromStored(existingCommand);
        if (record.payloadHash !== command.payloadHash || record.command !== command.command || record.mode !== command.mode) {
          transaction.abort();
          return { ok: false, error: 'IDEMPOTENCY_CONFLICT', existing: { ...record } };
        }
        transaction.abort();
        return { ok: true, record: { ...record }, duplicate: true, durability: 'persistent' };
      }
      const actualStateVersion = existingState?.stateVersion ?? 0;
      if (actualStateVersion !== expectedStateVersion) {
        transaction.abort();
        return { ok: false, error: 'CONFLICT', actualStateVersion };
      }
      if (previewId && (!existingPreview || existingPreview.status !== 'PENDING')) {
        transaction.abort();
        return { ok: false, error: 'CONFLICT', actualStateVersion };
      }
      stateStore.put({ ...state });
      commandStore.put({ ...command, key: commandKey });
      if (existingPreview && previewId) previewStore.put({ ...existingPreview, status: 'COMMITTED', committedOperationId: command.operationId });
      await transactionResult(transaction);
      return { ok: true, record: { ...command }, durability: 'persistent' };
    } catch (error) {
      this.fallbackFrom(error);
      return this.volatileCommandResult(await this.fallback.commitCommand(command, state, expectedStateVersion, previewId));
    }
  }

  public async purgeExpired(now: string): Promise<void> {
    const database = await this.database();
    if (!database) {
      await this.fallback.purgeExpired(now);
      return;
    }
    try {
      const transaction = database.transaction([COMMANDS_STORE, PREVIEWS_STORE], 'readwrite');
      const commandStore = transaction.objectStore(COMMANDS_STORE);
      const previewStore = transaction.objectStore(PREVIEWS_STORE);
      const [commands, previews] = await Promise.all([
        requestResult(commandStore.getAll()) as Promise<StoredCommand[]>,
        requestResult(previewStore.getAll()) as Promise<StoredPreview[]>,
      ]);
      commands.filter((record) => record.expiresAt <= now).forEach((record) => commandStore.delete(record.key));
      previews.filter((record) => record.retentionExpiresAt <= now).forEach((record) => previewStore.delete(record.key));
      await transactionResult(transaction);
    } catch (error) {
      this.fallbackFrom(error);
      await this.fallback.purgeExpired(now);
    }
  }

  public async clear(sandboxId?: string): Promise<void> {
    const database = await this.database();
    if (!database) {
      this.fallback.clear(sandboxId);
      return;
    }
    try {
      const transaction = database.transaction([STATES_STORE, COMMANDS_STORE, PREVIEWS_STORE], 'readwrite');
      if (!sandboxId) {
        transaction.objectStore(STATES_STORE).clear();
        transaction.objectStore(COMMANDS_STORE).clear();
        transaction.objectStore(PREVIEWS_STORE).clear();
      } else {
        const stateStore = transaction.objectStore(STATES_STORE);
        const commandStore = transaction.objectStore(COMMANDS_STORE);
        const previewStore = transaction.objectStore(PREVIEWS_STORE);
        stateStore.delete(sandboxId);
        const commands = await requestResult(commandStore.getAll()) as StoredCommand[];
        const previews = await requestResult(previewStore.getAll()) as StoredPreview[];
        commands.filter((record) => record.sandboxId === sandboxId).forEach((record) => commandStore.delete(record.key));
        previews.filter((record) => record.sandboxId === sandboxId).forEach((record) => previewStore.delete(record.key));
      }
      await transactionResult(transaction);
    } catch (error) {
      this.fallbackFrom(error);
      this.fallback.clear(sandboxId);
    }
  }

  private async database(): Promise<IDBDatabase | null> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve) => {
      let settled = false;
      if (this.faultPoint === 'indexeddb-unavailable') {
        this.faultPoint = null;
        this.recordFailure('UNAVAILABLE');
        resolve(null);
        return;
      }
      if (typeof indexedDB === 'undefined') {
        this.diagnostic = { ...this.diagnostic, backend: 'memory', ready: true, fallbackReason: this.diagnostic.fallbackReason ?? 'UNAVAILABLE' };
        resolve(null);
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        this.fallbackFrom(error);
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STATES_STORE)) database.createObjectStore(STATES_STORE, { keyPath: 'id' });
        const commands = database.objectStoreNames.contains(COMMANDS_STORE) ? request.transaction?.objectStore(COMMANDS_STORE) : database.createObjectStore(COMMANDS_STORE, { keyPath: 'key' });
        const previews = database.objectStoreNames.contains(PREVIEWS_STORE) ? request.transaction?.objectStore(PREVIEWS_STORE) : database.createObjectStore(PREVIEWS_STORE, { keyPath: 'key' });
        if (commands && !commands.indexNames.contains(COMMAND_SANDBOX_INDEX)) commands.createIndex(COMMAND_SANDBOX_INDEX, ['sandboxId', 'createdAt'], { unique: false });
        if (previews && !previews.indexNames.contains(PREVIEW_SANDBOX_INDEX)) previews.createIndex(PREVIEW_SANDBOX_INDEX, ['sandboxId', 'createdAt'], { unique: false });
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => database.close();
        this.diagnostic = { ...this.diagnostic, backend: 'indexeddb', ready: true, fallbackReason: undefined };
        resolve(database);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        this.fallbackFrom(request.error);
        resolve(null);
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        this.fallbackFrom(new Error('IndexedDB version change blocked'));
        resolve(null);
      };
    });
    return this.databasePromise;
  }

  private fallbackFrom(error: unknown): void {
    this.diagnostic = {
      ...this.diagnostic,
      backend: 'memory',
      ready: true,
      fallbackReason: isQuotaError(error) ? 'QUOTA_EXCEEDED' : error instanceof Error && error.message === 'CORRUPTED' ? 'CORRUPTED' : 'UNAVAILABLE',
    };
  }

  private consumeIndexedDbFailure(...points: SandboxFaultPoint[]): SandboxStorageDiagnostics['fallbackReason'] | null {
    if (!this.faultPoint || !points.includes(this.faultPoint)) return null;
    const point = this.faultPoint;
    this.faultPoint = null;
    const reason = point === 'indexeddb-quota-exceeded' ? 'QUOTA_EXCEEDED' : 'CORRUPTED';
    this.recordFailure(reason);
    return reason;
  }

  private volatileStateResult(result: SandboxStoreWriteResult): SandboxStoreWriteResult {
    return result.ok ? { ...result, durability: 'volatile' } : result;
  }

  private volatileCommandResult(result: SandboxCommandWriteResult): SandboxCommandWriteResult {
    return result.ok ? { ...result, durability: 'volatile' } : result;
  }

  private volatilePreviewResult(result: { ok: true; durability?: 'persistent' | 'volatile' } | { ok: false; error: 'UNAVAILABLE' | 'CONFLICT' }): typeof result {
    return result.ok ? { ...result, durability: 'volatile' } : result;
  }
}

export const SANDBOX_IDB_DATABASE_NAME = DATABASE_NAME;
