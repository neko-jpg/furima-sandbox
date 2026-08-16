/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  FURIMA_D1_API_TOKEN?: string;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

export const isImageOptimizationRequest = (pathname: string): boolean => pathname === '/_vinext/image';
export const allowedImageWidths = (): number[] => [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];

const bindingUnavailable = (): Response => Response.json({ ok: false, error: 'WORKER_BINDING_UNAVAILABLE' }, { status: 503, headers: { 'cache-control': 'no-store' } });

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

    if (isImageOptimizationRequest(url.pathname)) {
      const assets = env.ASSETS;
      const images = env.IMAGES;
      if (!assets || !images) return bindingUnavailable();
      try {
        return await handleImageOptimization(request, {
        fetchAsset: (path) => assets.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
        }, allowedImageWidths());
      } catch {
        return Response.json({ ok: false, error: 'IMAGE_OPTIMIZATION_FAILED' }, { status: 502, headers: { 'cache-control': 'no-store' } });
      }
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
