// The local Vinext dependency does not ship Cloudflare's runtime ambient types.
// These minimal declarations keep the worker and D1 adapter type-checkable in
// local development; the deployed runtime supplies the concrete implementations.
declare interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare interface D1Database {
  prepare(query: string): unknown;
}

declare namespace Cloudflare {
  interface Env {
    ASSETS?: Fetcher;
    DB: D1Database;
    FURIMA_D1_API_TOKEN?: string;
    FURIMA_D1_CONTROL_TOKEN?: string;
    FURIMA_LOCAL_FIXTURE_MODE?: string;
    FURIMA_STORAGE_MODE?: 'memory' | 'd1';
    FURIMA_DEPLOYMENT_ENV?: 'development' | 'staging' | 'production';
    IMAGES?: {
      input(stream: ReadableStream): {
        transform(options: Record<string, unknown>): {
          output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
        };
      };
    };
  }
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}
