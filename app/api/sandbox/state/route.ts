import {
  authorizationFailure,
  DEFAULT_SANDBOX_ID,
  failure,
  MAX_SANDBOX_REQUEST_BYTES,
  sandboxIdFrom,
  storeForRequest,
} from '../runtime';

const REQUIRED_ARRAY_FIELDS = ['actors', 'items', 'purchaseIntents', 'transactions', 'payments', 'shipments', 'bids', 'reviews', 'inventoryMovements', 'events', 'notifications', 'wallets'];

const hasValidStateEnvelope = (candidate: Record<string, unknown>, sandboxId: string): boolean => candidate.version === '1'
  && candidate.sandboxId === sandboxId
  && typeof candidate.scenarioId === 'string'
  && typeof candidate.seed === 'string'
  && typeof candidate.now === 'string'
  && Number.isFinite(Date.parse(candidate.now))
  && typeof candidate.currentActorId === 'string'
  && REQUIRED_ARRAY_FIELDS.every((field) => Array.isArray(candidate[field]))
  && Boolean(candidate.drafts) && typeof candidate.drafts === 'object' && !Array.isArray(candidate.drafts)
  && Boolean(candidate.draftOwners) && typeof candidate.draftOwners === 'object' && !Array.isArray(candidate.draftOwners)
  && Array.isArray(candidate.pendingFailures);

export async function GET(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request);
  if (authError) return authError;
  const id = sandboxIdFrom(request);
  if (!id) return failure('INVALID_STATE_ID', 400);
  try {
    const record = await (await storeForRequest()).get(id);
    if (!record) return failure('STATE_NOT_FOUND', 404);
    const etag = `"${record.stateVersion}-${record.updatedAt}"`;
    if (request.headers.get('if-none-match')?.split(',').some((candidate) => candidate.trim() === etag)) return new Response(null, { status: 304, headers: { 'cache-control': 'no-store', etag } });
    return new Response(record.payload, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag } });
  } catch {
    return failure('D1_UNAVAILABLE', 503, { retryable: true });
  }
}

export async function PUT(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request);
  if (authError) return authError;
  const id = sandboxIdFrom(request);
  if (!id) return failure('INVALID_STATE_ID', 400);
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_SANDBOX_REQUEST_BYTES) return failure('PAYLOAD_TOO_LARGE', 413, { maxBytes: MAX_SANDBOX_REQUEST_BYTES });
  let raw: string;
  try {
    raw = await request.text();
    if (raw.length > MAX_SANDBOX_REQUEST_BYTES) return failure('PAYLOAD_TOO_LARGE', 413, { maxBytes: MAX_SANDBOX_REQUEST_BYTES });
  } catch {
    return failure('INVALID_STATE', 400);
  }
  let candidate: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure('INVALID_STATE', 400);
    candidate = parsed as Record<string, unknown>;
  } catch {
    return failure('INVALID_STATE', 400);
  }
  const stateVersion = candidate.stateVersion;
  if (!hasValidStateEnvelope(candidate, id) || !Number.isInteger(stateVersion) || Number(stateVersion) < 0) return failure('INVALID_STATE', 400);
  try {
    const store = await storeForRequest();
    const expected = request.headers.get('if-match-state-version');
    const expectedStateVersion = expected === null ? undefined : Number(expected);
    const existing = expected === null ? await store.get(id) : null;
    if (expected !== null && !Number.isInteger(expectedStateVersion)) return failure('STATE_CONFLICT', 409, { expectedStateVersion: expected, actualStateVersion: null });
    else if (existing) return failure('STATE_CONFLICT', 409, { expectedStateVersion: null, actualStateVersion: existing.stateVersion });
    const result = await store.put({
      id,
      scenarioId: String(candidate.scenarioId),
      seed: String(candidate.seed),
      stateVersion: Number(stateVersion),
      virtualNow: String(candidate.now),
      payload: raw,
      updatedAt: new Date().toISOString(),
    }, expectedStateVersion, false);
    if (!result.ok) return failure(result.error === 'CONFLICT' ? 'STATE_CONFLICT' : 'D1_UNAVAILABLE', result.error === 'CONFLICT' ? 409 : 503, { actualStateVersion: result.actualStateVersion, retryable: result.error === 'UNAVAILABLE' });
    return Response.json({ ok: true, stateVersion: Number(stateVersion), id: id || DEFAULT_SANDBOX_ID, sandboxId: id }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return failure('D1_UNAVAILABLE', 503, { retryable: true });
  }
}
