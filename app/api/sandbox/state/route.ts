import { eq } from 'drizzle-orm';
import { getDb } from '../../../../db';
import { sandboxStates } from '../../../../db/schema';

const DEFAULT_STATE_ID = 'furima-demo';
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const VALID_SCENARIOS = new Set([
  'catalog_default', 'purchase_happy_path', 'already_sold', 'multi_inventory',
  'auction_outbid', 'listing_policy_blocked', 'zero_search_results', 'payment_timeout', 'delivery_delay',
]);
const REQUIRED_ARRAY_FIELDS = ['actors', 'items', 'purchaseIntents', 'transactions', 'payments', 'shipments', 'bids', 'reviews', 'inventoryMovements', 'events', 'notifications', 'wallets'];

const stateIdFrom = (request: Request): string | null => {
  const value = new URL(request.url).searchParams.get('id') ?? DEFAULT_STATE_ID;
  return /^[a-zA-Z0-9_-]{1,80}$/u.test(value) ? value : null;
};

const failure = (message: string, status: number, details?: unknown): Response => Response.json({ ok: false, error: message, details }, {
  status,
  headers: { 'cache-control': 'no-store' },
});

const unavailable = (): Response => failure('D1_UNAVAILABLE', 503, { retryable: true });

const hasValidStateEnvelope = (candidate: Record<string, unknown>): boolean => candidate.version === '1'
  && typeof candidate.scenarioId === 'string'
  && VALID_SCENARIOS.has(candidate.scenarioId)
  && typeof candidate.seed === 'string'
  && typeof candidate.now === 'string'
  && Number.isFinite(Date.parse(candidate.now))
  && typeof candidate.currentActorId === 'string'
  && REQUIRED_ARRAY_FIELDS.every((field) => Array.isArray(candidate[field]))
  && Boolean(candidate.drafts) && typeof candidate.drafts === 'object' && !Array.isArray(candidate.drafts)
  && Boolean(candidate.draftOwners) && typeof candidate.draftOwners === 'object' && !Array.isArray(candidate.draftOwners)
  && Array.isArray(candidate.pendingFailures);

export async function GET(request: Request): Promise<Response> {
  const id = stateIdFrom(request);
  if (!id) return failure('INVALID_STATE_ID', 400);
  try {
    const db = getDb();
    const [row] = await db.select().from(sandboxStates).where(eq(sandboxStates.id, id)).limit(1);
    if (!row) return failure('STATE_NOT_FOUND', 404);
    const payload = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
    const etag = `"${row.stateVersion}-${row.updatedAt}"`;
    if (request.headers.get('if-none-match')?.split(',').some((candidate) => candidate.trim() === etag)) return new Response(null, { status: 304, headers: { 'cache-control': 'no-store', etag } });
    return new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag },
    });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_STATE_BYTES) return failure('PAYLOAD_TOO_LARGE', 413, { maxBytes: MAX_STATE_BYTES });
  let candidate: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_STATE_BYTES) return failure('PAYLOAD_TOO_LARGE', 413, { maxBytes: MAX_STATE_BYTES });
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure('INVALID_STATE', 400);
    candidate = parsed as Record<string, unknown>;
  } catch {
    return failure('INVALID_STATE', 400);
  }
  const stateVersion = candidate.stateVersion;
  const scenarioId = candidate.scenarioId;
  const virtualNow = candidate.now;
  if (!hasValidStateEnvelope(candidate) || !Number.isInteger(stateVersion) || Number(stateVersion) < 0 || typeof scenarioId !== 'string' || typeof virtualNow !== 'string') return failure('INVALID_STATE', 400);
  try {
    const db = getDb();
    const id = stateIdFrom(request);
    if (!id) return failure('INVALID_STATE_ID', 400);
    const [existing] = await db.select().from(sandboxStates).where(eq(sandboxStates.id, id)).limit(1);
    const expected = request.headers.get('if-match-state-version');
    if (expected !== null) {
      const expectedStateVersion = Number(expected);
      const actualStateVersion = existing?.stateVersion ?? 0;
      if (!Number.isInteger(expectedStateVersion) || expectedStateVersion !== actualStateVersion) return failure('STATE_CONFLICT', 409, { expectedStateVersion, actualStateVersion });
    } else if (existing) {
      return failure('STATE_CONFLICT', 409, { expectedStateVersion: null, actualStateVersion: existing.stateVersion });
    }
    const updatedAt = new Date().toISOString();
    const payload = JSON.stringify(candidate);
    await db.insert(sandboxStates).values({ id, scenarioId, seed: typeof candidate.seed === 'string' ? candidate.seed : 'unknown', stateVersion: Number(stateVersion), virtualNow, payload, updatedAt }).onConflictDoUpdate({ target: sandboxStates.id, set: { scenarioId, seed: typeof candidate.seed === 'string' ? candidate.seed : 'unknown', stateVersion: Number(stateVersion), virtualNow, payload, updatedAt } });
    return Response.json({ ok: true, stateVersion: Number(stateVersion), id }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return unavailable();
  }
}
