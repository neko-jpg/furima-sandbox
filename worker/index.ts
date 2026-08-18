/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { D1SandboxStateStore } from "../app/domain/sandboxStore.ts";

type Env = Cloudflare.Env;

export const isImageOptimizationRequest = (pathname: string): boolean => pathname === '/_vinext/image';
export const allowedImageWidths = (): number[] => [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];

const bindingUnavailable = (): Response => Response.json({ ok: false, error: 'WORKER_BINDING_UNAVAILABLE' }, { status: 503, headers: { 'cache-control': 'no-store' } });

const requestIdFor = (request: Request): string => {
  const supplied = request.headers.get('x-request-id');
  if (supplied && /^[A-Za-z0-9._:-]{1,100}$/u.test(supplied)) return supplied;
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `req-${Date.now().toString(36)}`;
};

const withRequestId = (response: Response, requestId: string): Response => {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const logWorkerRequest = (request: Request, requestId: string, status: number, startedAt: number, details: Record<string, unknown> = {}): void => {
  const url = new URL(request.url);
  console.log(JSON.stringify({ event: 'worker.request', requestId, method: request.method, pathname: url.pathname, sandboxId: url.searchParams.get('id') ?? undefined, status, durationMs: Date.now() - startedAt, ...details }));
};

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// SVG optimization remains opt-in and disabled in this sandbox boundary.

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = requestIdFor(request);
    const startedAt = Date.now();

    if (isImageOptimizationRequest(url.pathname)) {
      const assets = env.ASSETS;
      const images = env.IMAGES;
      if (!assets || !images) {
        const response = withRequestId(bindingUnavailable(), requestId);
        logWorkerRequest(request, requestId, response.status, startedAt, { errorClass: 'WORKER_BINDING_UNAVAILABLE' });
        return response;
      }
      try {
        const response = withRequestId(await handleImageOptimization(request, {
        fetchAsset: (path) => assets.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
        }, allowedImageWidths()), requestId);
        logWorkerRequest(request, requestId, response.status, startedAt);
        return response;
      } catch {
        const response = withRequestId(Response.json({ ok: false, error: 'IMAGE_OPTIMIZATION_FAILED' }, { status: 502, headers: { 'cache-control': 'no-store' } }), requestId);
        logWorkerRequest(request, requestId, response.status, startedAt, { errorClass: 'IMAGE_OPTIMIZATION_FAILED' });
        return response;
      }
    }

    try {
      const response = withRequestId(await handler.fetch(request, env, ctx), requestId);
      logWorkerRequest(request, requestId, response.status, startedAt);
      return response;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      console.error(JSON.stringify({ event: 'worker.error', requestId, pathname: url.pathname, sandboxId: url.searchParams.get('id') ?? undefined, errorClass }));
      const response = withRequestId(Response.json({ ok: false, error: 'INTERNAL_ERROR', requestId }, { status: 500, headers: { 'cache-control': 'no-store' } }), requestId);
      logWorkerRequest(request, requestId, response.status, startedAt, { errorClass: 'INTERNAL_ERROR' });
      return response;
    }
  },
  scheduled(controller: { scheduledTime: number }, env: Env, ctx: ExecutionContext): void {
    if (!env.DB) {
      console.warn(JSON.stringify({ event: 'worker.retention.skip', reason: 'DB_BINDING_UNAVAILABLE' }));
      return;
    }
    ctx.waitUntil(new D1SandboxStateStore(env.DB as never).purgeExpired(new Date(controller.scheduledTime).toISOString()).then(() => {
      console.log(JSON.stringify({ event: 'worker.retention.cleanup', completedAt: new Date().toISOString() }));
    }).catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'worker.retention.error', errorClass: error instanceof Error ? error.name : 'UnknownError' }));
    }));
  },
};

export default worker;
