import { authConfiguration, authorizationFailure, DEFAULT_SANDBOX_ID, failure, isLocalFixtureRequest, sandboxIdFrom, storageModeForRuntime, storeForRequest } from '../runtime.ts';

export async function GET(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request);
  if (authError) return authError;
  const id = sandboxIdFrom(request);
  if (!id) return failure('INVALID_STATE_ID', 400);
  try {
    const store = await storeForRequest();
    const record = await store.get(id);
    const storage = await storageModeForRuntime();
    const durable = storage === 'd1';
    const auth = await authConfiguration();
    const local = await isLocalFixtureRequest(request);
    return Response.json({
      ok: true,
      ready: true,
      degraded: !durable,
      sandboxId: id || DEFAULT_SANDBOX_ID,
      stateVersion: record?.stateVersion ?? 0,
      storage,
      persistence: { durable, volatileFallback: !durable, retentionCleanup: true },
      capabilities: {
        preview: true,
        commit: true,
        idempotency: true,
        cas: true,
        replayAtomic: true,
        controlAuth: local || auth.controlConfigured,
        externalPayment: false,
        productionAuth: local ? false : auth.apiConfigured,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return failure('D1_UNAVAILABLE', 503, { retryable: true });
  }
}

export function PUT(): Response {
  return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });
}
