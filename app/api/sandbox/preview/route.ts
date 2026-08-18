import type { PreviewCommand } from '../../../types/mercari.ts';
import { SandboxCommandExecutor, previewOperationFor } from '../../../domain/commandExecutor.ts';
import {
  actionOptionsFor,
  actionFailure,
  authorizationFailure,
  engineFromRecord,
  MAX_SANDBOX_REQUEST_BYTES,
  hasJsonContentType,
  principalForRequest,
  readJson,
  sandboxIdFrom,
  storeForRequest,
} from '../runtime.ts';

const previewCommands = new Set<PreviewCommand>(['purchase', 'listing.create', 'wallet.deposit', 'wallet.withdraw']);

const statusFor = (error: string): number => {
  if (error === 'AUTH_REQUIRED') return 401;
  if (error === 'FORBIDDEN') return 403;
  if (error === 'PREVIEW_NOT_FOUND' || error === 'STATE_NOT_FOUND') return 404;
  if (error === 'STATE_CONFLICT' || error === 'IDEMPOTENCY_CONFLICT' || error === 'PREVIEW_EXPIRED') return 409;
  if (error === 'PAYLOAD_TOO_LARGE') return 413;
  if (error === 'D1_UNAVAILABLE') return 503;
  return 400;
};

export async function POST(request: Request): Promise<Response> {
  const authError = await authorizationFailure(request, { requireControl: true });
  if (authError) return authError;
  if (!hasJsonContentType(request)) return actionFailure(request, undefined, 'preview', 'INVALID_INPUT', 415, 0, { message: 'Content-Typeはapplication/jsonで指定してください' });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_SANDBOX_REQUEST_BYTES) return actionFailure(request, undefined, 'preview', 'PAYLOAD_TOO_LARGE', 413, 0, { maxBytes: MAX_SANDBOX_REQUEST_BYTES });
  const body = await readJson(request);
  if (!body) return actionFailure(request, undefined, 'preview', 'INVALID_INPUT', 400, 0, { message: 'JSON bodyが不正です' });
  const id = sandboxIdFrom(request, body);
  if (!id) return actionFailure(request, body, 'preview', 'INVALID_STATE_ID', 400);
  const command = body.command;
  if (typeof command !== 'string' || !previewCommands.has(command as PreviewCommand)) return actionFailure(request, body, 'preview', 'INVALID_INPUT', 400, 0, { message: 'preview対象commandが不正です', allowedCommands: [...previewCommands] });
  const store = await storeForRequest();
  try {
    const record = await store.get(id);
    if (!record) return actionFailure(request, body, 'preview', 'STATE_NOT_FOUND', 404, 0, { sandboxId: id });
    const engine = engineFromRecord(id, record);
    const options = actionOptionsFor(body, engine.getCurrentActor().id, principalForRequest(request));
    const executor = new SandboxCommandExecutor({ engine, store });
    const result = await executor.preview(command as PreviewCommand, body.payload ?? {}, options, (previewEngine) => previewOperationFor(command as PreviewCommand, body.payload ?? {}, options.actorId ?? previewEngine.getCurrentActor().id, previewEngine));
    return Response.json(result, { status: result.ok ? 200 : statusFor(result.error), headers: { 'cache-control': 'no-store' } });
  } catch {
    return actionFailure(request, body, 'preview', 'D1_UNAVAILABLE', 503, 0, { retryable: true });
  }
}
