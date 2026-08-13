import type { MarketplaceState } from '../domain/marketplace';

export type MesaEngineStatus = {
  name: 'Mesa';
  version: string;
  connected: boolean;
  mode: 'sidecar' | 'browser-fallback';
  detail: string;
};

export type MesaCommandIntent = {
  id: string;
  action: 'browse' | 'like' | 'offer' | 'buy' | 'ship' | 'deliver' | 'review' | 'list';
  actorId: string;
  actorType: 'npc' | 'ai_agent';
  targetId?: string;
  correlationId: string;
  payload: Record<string, unknown>;
  simulatedAt: string;
};

export type MesaStepResponse = {
  worldId: string;
  tick: number;
  simulatedAt: string;
  intents: MesaCommandIntent[];
  events: Array<Record<string, unknown>>;
  metrics: Record<string, number>;
};

type MesaWireIntent = {
  intent_id: string;
  idempotency_key: string;
  sequence: number;
  actor_id: string;
  actor_type: 'npc' | 'ai_agent';
  command: MesaCommandIntent['action'];
  target_id: string;
  payload: Record<string, unknown>;
  simulated_at: string;
};

const configuredBaseUrl = (
  process.env.NEXT_PUBLIC_MESA_API_URL
  ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8010' : '')
).replace(/\/$/u, '');

const withTimeout = (timeoutMs = 2500) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, stop: () => clearTimeout(timeoutId) };
};

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  if (!configuredBaseUrl) throw new Error('NEXT_PUBLIC_MESA_API_URL is not configured');
  const timeout = withTimeout();
  try {
    const response = await fetch(`${configuredBaseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      signal: timeout.controller.signal,
    });
    if (!response.ok) throw new Error(`Mesa API returned ${response.status}`);
    return await response.json() as T;
  } finally {
    timeout.stop();
  }
};

export const getMesaEngineStatus = async (): Promise<MesaEngineStatus> => {
  if (!configuredBaseUrl) {
    return {
      name: 'Mesa',
      version: '3.5.1',
      connected: false,
      mode: 'browser-fallback',
      detail: 'Mesa API URL未設定 — 同じcommand contractのブラウザ実行を使用中',
    };
  }
  try {
    const health = await request<{ engine?: string; mesaVersion?: string; mesa_version?: string }>('/health');
    return {
      name: 'Mesa',
      version: health.mesaVersion ?? health.mesa_version ?? '3.5.1',
      connected: true,
      mode: 'sidecar',
      detail: `${health.engine ?? 'MarketplaceModel'}へ接続済み`,
    };
  } catch {
    return {
      name: 'Mesa',
      version: '3.5.1',
      connected: false,
      mode: 'browser-fallback',
      detail: 'Mesa sidecarへ接続できないためブラウザ実行を使用中',
    };
  }
};

export const bootstrapMesaWorld = async (marketplace: MarketplaceState, seed: number) => request<{
  world_id: string;
  seed: number;
  engine: string;
  participants: number;
  active_listings: number;
  transactions: number;
  metrics: Record<string, unknown>;
}>('/worlds/bootstrap', {
  method: 'POST',
  body: JSON.stringify({
    world_id: 'world-default',
    seed,
    snapshot: marketplace,
  }),
});

export const stepMesaWorld = async (
  marketplace: MarketplaceState,
  steps: number,
  speed: 1 | 10,
) => {
  const wire = await request<{
    world_id: string;
    steps: number;
    speed: number;
    command_intents: MesaWireIntent[];
    events: Array<Record<string, unknown> & { simulated_at?: string }>;
    metrics: Record<string, unknown>;
  }>('/worlds/world-default/step', {
    method: 'POST',
    body: JSON.stringify({ steps, speed, seed: 12345, snapshot: marketplace }),
  });
  const intents = wire.command_intents.map((intent) => ({
    id: intent.intent_id,
    action: intent.command,
    actorId: intent.actor_id,
    actorType: intent.actor_type,
    targetId: intent.target_id,
    correlationId: intent.idempotency_key,
    payload: intent.payload,
    simulatedAt: intent.simulated_at,
  }));
  const simulatedAt = intents.at(-1)?.simulatedAt
    ?? String(wire.events.at(-1)?.simulated_at ?? new Date().toISOString());
  return {
    worldId: wire.world_id,
    tick: Number(wire.metrics.model_time ?? wire.steps),
    simulatedAt,
    intents,
    events: wire.events,
    metrics: Object.fromEntries(
      Object.entries(wire.metrics).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    ),
  } satisfies MesaStepResponse;
};

export const mesaApiConfigured = Boolean(configuredBaseUrl);
