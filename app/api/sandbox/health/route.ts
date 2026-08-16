import { authorizationFailure, DEFAULT_SANDBOX_ID, failure, sandboxIdFrom, storeForRequest } from '../runtime.ts';

export async function GET(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request);
  if (authError) return authError;
  const id = sandboxIdFrom(request);
  if (!id) return failure('INVALID_STATE_ID', 400);
  try {
    const store = await storeForRequest();
    const record = await store.get(id);
    const storage = store.constructor.name === 'D1SandboxStateStore' ? 'd1' : 'memory';
    return Response.json({
      ok: true,
      ready: true,
      sandboxId: id || DEFAULT_SANDBOX_ID,
      stateVersion: record?.stateVersion ?? 0,
      storage,
      capabilities: {
        preview: true,
        commit: true,
        idempotency: true,
        cas: true,
        externalPayment: false,
        productionAuth: false,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return failure('D1_UNAVAILABLE', 503, { retryable: true });
  }
}
