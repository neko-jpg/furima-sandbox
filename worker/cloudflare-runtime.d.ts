// The local Vinext dependency does not ship Cloudflare's runtime ambient types.
// These minimal declarations keep the worker and D1 adapter type-checkable in
// local development; the deployed runtime supplies the concrete implementations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare type D1Database = any;

declare interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module 'cloudflare:workers' {
  export const env: { DB?: D1Database; FURIMA_D1_API_TOKEN?: string };
}
