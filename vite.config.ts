import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin.js";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

function loadHostingConfig(): { d1?: string; r2?: string } {
  const hostingPath = resolve(process.cwd(), ".openai", "hosting.json");
  if (!existsSync(hostingPath)) {
    return { d1: "DB" };
  }
  try {
    return JSON.parse(readFileSync(hostingPath, "utf8")) as {
      d1?: string;
      r2?: string;
    };
  } catch {
    return { d1: "DB" };
  }
}

const hostingConfig = loadHostingConfig();
const { d1 = "DB", r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const devSourcemapsEnabled = process.env.FURIMA_DEV_SOURCEMAPS === "true";

const OPENCV_BROWSER_MODULE_ID = "\0furima-opencv-browser";

/**
 * @techstark/opencv-js ships the official OpenCV.js UMD bundle. Vite's
 * CommonJS wrapper runs that bundle in strict ESM where top-level `this` is
 * undefined, so the browser build needs a tiny, deterministic ESM shim. The
 * source still comes from the pinned npm package; no CDN or runtime download
 * is introduced. Keeping the shim here also makes the same artifact work in
 * a module Worker, where `importScripts` is unavailable.
 */
const opencvBrowserPlugin = {
  name: "furima-opencv-browser-module",
  enforce: "pre" as const,
  resolveId(source: string): string | undefined {
    return source === "@techstark/opencv-js" ? OPENCV_BROWSER_MODULE_ID : undefined;
  },
  load(id: string): string | undefined {
    if (id !== OPENCV_BROWSER_MODULE_ID) return undefined;
    const source = readFileSync(resolve(process.cwd(), "node_modules", "@techstark", "opencv-js", "dist", "opencv.js"), "utf8");
    const browserSource = source.replace("}(this, function () {", "}(globalThis, function () {");
    if (browserSource === source) throw new Error("Pinned OpenCV.js UMD entrypoint changed; update the browser shim deliberately.");
    // Keep the browser/Worker branch deterministic. The upstream bundle also
    // contains Node/AMD branches; these bindings prevent an ESM bundler from
    // treating their CommonJS globals as runtime dependencies.
    return `const module = undefined;\nconst exports = undefined;\n${browserSource}\nconst opencv = globalThis.cv;\nexport { opencv as cv };\nexport default opencv;`;
  },
};

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    FURIMA_LOCAL_FIXTURE_MODE: "true",
    FURIMA_STORAGE_MODE: "memory",
    FURIMA_DEPLOYMENT_ENV: "development",
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // The ordinary dev server uses Vinext's lightweight Node runtime. Loading
  // Miniflare here adds tens of seconds on Windows and is unnecessary for the
  // in-memory local fixture. Edge binding work remains available via dev:edge,
  // while production builds still use the Cloudflare plugin.
  if (command === "serve") {
    process.env.FURIMA_LOCAL_FIXTURE_MODE ??= "true";
    process.env.FURIMA_STORAGE_MODE ??= "memory";
    process.env.FURIMA_DEPLOYMENT_ENV ??= "development";
  }
  const cloudflarePlugin = command === "build"
    ? (await import("@cloudflare/vite-plugin")).cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      })
    : null;

  return {
    optimizeDeps: {
      // Vinext already declares its React runtime dependencies. Avoid scanning
      // every app route on cold start: that needlessly traverses Worker-only
      // API modules and makes the first page request compete with the scanner.
      noDiscovery: true,
      holdUntilCrawlEnd: false,
      include: ["lucide-react", "next/image"],
    },
    environments: {
      // Vite 8 generates development sourcemaps separately for all three
      // Vinext environments. Keep the fast path lean and allow opt-in maps
      // when a server or hydration stack needs source-level debugging.
      rsc: {
        dev: {
          sourcemap: devSourcemapsEnabled,
          preTransformRequests: true,
        },
      },
      ssr: {
        dev: {
          sourcemap: devSourcemapsEnabled,
          preTransformRequests: true,
        },
      },
      client: { dev: { sourcemap: devSourcemapsEnabled } },
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      opencvBrowserPlugin,
      vinext(),
      sites(),
      cloudflarePlugin,
    ],
  };
});
