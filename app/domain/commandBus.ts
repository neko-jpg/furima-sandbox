import type {
  ActionMetadata,
  ActionResult,
  ActionTraceEntry,
  AgentActionOptions,
} from '../types/mercari';
import { isTrustedPrincipal } from './sandboxEngine.ts';

export interface CommandBusContext {
  sandboxId: string;
  actorId: string;
  stateVersion: number;
}

interface CachedCommandResult {
  fingerprint: string;
  result: ActionResult<unknown>;
  expiresAt: number;
}

interface CommandBusOptions {
  getContext: () => CommandBusContext;
  now?: () => number;
  ttlMs?: number;
  maxCacheEntries?: number;
  maxTraceEntries?: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const DEFAULT_MAX_TRACE_ENTRIES = 500;
const MAX_PAYLOAD_BYTES = 128 * 1024;

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const clone = <T,>(value: T): T => {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const digest = (value: string): string => {
  // Four independent 32-bit lanes keep the fingerprint synchronous and
  // available in both the browser and Worker runtimes without retaining raw
  // payload/PII in the idempotency store.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  let c = 0x85ebca6b;
  let d = 0xc2b2ae35;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + index), 0x27d4eb2d);
    c = Math.imul(c ^ (code << (index % 8)), 0x165667b1);
    d = Math.imul(d ^ (code * 31), 0x9e3779b1);
  }
  return [a, b, c, d].map((lane) => (lane >>> 0).toString(16).padStart(8, '0')).join('');
};

const uniqueOperationId = (sandboxId: string, command: string, sequence: number): string => {
  const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${sequence.toString(36)}`;
  return `${sandboxId}:${command}:${randomUuid}:${sequence}`;
};

const isImageField = (fieldName: string): boolean => /(?:^|(?:image|media|avatar|evidence|photo|thumbnail|blob|data))(?:s|ref|refs|url|bytes|size)?$/iu.test(fieldName);

export const compactImagePayload = (value: unknown, seen = new WeakSet<object>(), fieldName = ''): unknown => {
  if (typeof value === 'string') {
    if (!isImageField(fieldName) || (!value.startsWith('data:image/') && !value.startsWith('blob:'))) return value;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `[image:${value.slice(0, 24)}:${value.length}:${(hash >>> 0).toString(16)}]`;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[cycle]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => compactImagePayload(entry, seen, fieldName));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    result[key] = compactImagePayload(child, seen, key);
  });
  seen.delete(value);
  return result;
};

// Explicit name for the representation used in durable fingerprints and traces.
// Keep the shorter export above for existing command-executor callers.
export const compactImagePayloadForFingerprint = compactImagePayload;

export const canonicalize = (value: unknown, seen: WeakSet<object>, depth = 0): unknown => {
  if (depth > 12) throw new Error('payload-too-deep');
  if (value === undefined) return '__undefined__';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('payload-number');
    return value;
  }
  if (typeof value !== 'object') throw new Error('payload-type');
  if (seen.has(value)) throw new Error('payload-cycle');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => canonicalize(entry, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  Object.keys(value as Record<string, unknown>).sort().forEach((key) => {
    result[key] = canonicalize((value as Record<string, unknown>)[key], seen, depth + 1);
  });
  seen.delete(value);
  return result;
};

export const fingerprint = (value: unknown): string | null => {
  try {
    const serialized = JSON.stringify(canonicalize(value, new WeakSet<object>()));
    return serialized && utf8Bytes(serialized) <= MAX_PAYLOAD_BYTES ? `v1:${digest(serialized)}` : null;
  } catch {
    return null;
  }
};

const failure = <T,>(error: 'INVALID_INPUT' | 'STATE_CONFLICT' | 'FORBIDDEN' | 'IDEMPOTENCY_CONFLICT' | 'INTERNAL_ERROR', stateVersion: number, message: string, details?: unknown): ActionResult<T> => ({
  ok: false,
  error,
  stateVersion,
  message,
  ...(details === undefined ? {} : { details }),
});

export class SandboxCommandBus {
  private readonly cache = new Map<string, CachedCommandResult>();
  private readonly trace: ActionTraceEntry[] = [];
  private sequence = 0;
  private readonly getContext: () => CommandBusContext;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxCacheEntries: number;
  private readonly maxTraceEntries: number;

  public constructor(options: CommandBusOptions) {
    this.getContext = options.getContext;
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.maxTraceEntries = options.maxTraceEntries ?? DEFAULT_MAX_TRACE_ENTRIES;
  }

  public execute<T>(
    command: string,
    payload: unknown,
    options: AgentActionOptions | undefined,
    operation: () => ActionResult<T>,
  ): ActionResult<T> {
    this.pruneCache();
    const context = this.getContext();
    const actorId = options?.principal?.actorId ?? options?.actorId ?? context.actorId;
    const mode = options?.mode ?? 'commit';
    const operationId = options?.operationId ?? options?.idempotencyKey ?? options?.requestId ?? options?.commandId ?? uniqueOperationId(context.sandboxId, command, ++this.sequence);
    const key = options?.idempotencyKey ?? options?.requestId ?? options?.commandId;
    const originalFingerprint = fingerprint({ sandboxId: context.sandboxId, actorId, command, mode, payload });
    const tracePayload = compactImagePayload(payload);
    const payloadFingerprint = fingerprint({ sandboxId: context.sandboxId, actorId, command, mode, payload: tracePayload });
    const metadata: ActionMetadata = {
      sandboxId: context.sandboxId,
      actorId,
      stateVersion: context.stateVersion,
      operationId,
      ...(options?.commandId ? { commandId: options.commandId } : {}),
      ...(options?.requestId ? { requestId: options.requestId } : {}),
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      mode,
    };

    if (!originalFingerprint || !payloadFingerprint) return this.remember(command, tracePayload, options, this.decorate(failure('INVALID_INPUT', context.stateVersion, 'payloadはJSON互換・循環参照なし・128KB以内で指定してください'), metadata));
    if (options?.sandboxId && options.sandboxId !== context.sandboxId) {
      return this.remember(command, tracePayload, options, this.decorate(failure('INVALID_INPUT', context.stateVersion, 'sandboxIdが現在のSandboxと一致しません', { expectedSandboxId: context.sandboxId, receivedSandboxId: options.sandboxId }), metadata));
    }
    if (options?.principal && !isTrustedPrincipal(options.principal)) {
      return this.remember(command, tracePayload, options, this.decorate(failure('FORBIDDEN', context.stateVersion, '実行Principalは信頼済みadapterから注入してください'), metadata));
    }
    if (options?.principal && options.principal.actorId !== context.actorId && !options.principal.scopes.includes('sandbox-control')) {
      return this.remember(command, tracePayload, options, this.decorate(failure('FORBIDDEN', context.stateVersion, '実行Principalは現在のSandbox actorと一致している必要があります'), metadata));
    }
    if (!options?.principal && options?.actorId && options.scope !== 'sandbox-control' && options.actorId !== context.actorId) {
      return this.remember(command, tracePayload, options, this.decorate(failure('FORBIDDEN', context.stateVersion, 'actorIdは現在のSandbox actorと一致している必要があります'), metadata));
    }
    if (options?.expectedStateVersion !== undefined && options.expectedStateVersion !== context.stateVersion) {
      return this.remember(command, tracePayload, options, this.decorate(failure('STATE_CONFLICT', context.stateVersion, '状態が更新されています。最新スナップショットを取得してください。', {
        expectedStateVersion: options.expectedStateVersion,
        actualStateVersion: context.stateVersion,
      }), metadata));
    }

    if (key) {
      const cached = this.cache.get(key);
      if (cached) {
        if (cached.fingerprint !== payloadFingerprint) {
          return this.remember(command, tracePayload, options, this.decorate(failure('IDEMPOTENCY_CONFLICT', context.stateVersion, '同じ冪等キーで異なるpayloadを再利用できません'), metadata));
        }
        return clone(cached.result) as ActionResult<T>;
      }
    }

    let result: ActionResult<T>;
    try {
      result = operation();
    } catch (error) {
      result = failure('INTERNAL_ERROR', context.stateVersion, 'Sandbox commandの実行に失敗しました', {
        reason: error instanceof Error ? error.message : 'unknown-error',
      });
    }
    return this.remember(command, tracePayload, options, this.decorate(result, { ...metadata, mode }));
  }

  public getTrace(): ActionTraceEntry[] {
    return clone(this.trace);
  }

  public clear(): void {
    this.cache.clear();
    this.trace.splice(0, this.trace.length);
  }

  private decorate<T>(result: ActionResult<T>, metadata: ActionMetadata): ActionResult<T> {
    return { ...result, meta: { ...metadata, stateVersion: result.stateVersion } } as ActionResult<T>;
  }

  private remember<T>(command: string, payload: unknown, options: AgentActionOptions | undefined, result: ActionResult<T>): ActionResult<T> {
    const key = options?.idempotencyKey ?? options?.requestId ?? options?.commandId;
    const resultMeta = result.meta;
    const traceResult = result as ActionResult<unknown>;
    this.trace.push({
      action: command,
      requestId: options?.requestId,
      idempotencyKey: options?.idempotencyKey,
      commandId: options?.commandId,
      payload: clone(payload),
      result: clone(traceResult),
      at: new Date(this.now()).toISOString(),
    });
    if (this.trace.length > this.maxTraceEntries) this.trace.splice(0, this.trace.length - this.maxTraceEntries);
    if (key && resultMeta) {
      const resultFingerprint = fingerprint({
        sandboxId: resultMeta.sandboxId,
        actorId: resultMeta.actorId,
        command,
        mode: resultMeta.mode,
        payload,
      });
      if (resultFingerprint) {
        if (this.cache.size >= this.maxCacheEntries && !this.cache.has(key)) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, { fingerprint: resultFingerprint, result: clone(traceResult), expiresAt: this.now() + this.ttlMs });
      }
    }
    return result;
  }

  private pruneCache(): void {
    const now = this.now();
    for (const [key, value] of this.cache) if (value.expiresAt <= now) this.cache.delete(key);
  }
}
