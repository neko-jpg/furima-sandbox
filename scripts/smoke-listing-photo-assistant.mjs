const apiBaseUrl = (process.env.ASSISTANT_API_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/u, '');
const uiBaseUrl = (process.env.FURIMA_UI_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/u, '');
const allowedOrigin = process.env.ASSISTANT_SMOKE_ORIGIN ?? 'http://localhost:3000';
const attempts = Number.parseInt(process.env.ASSISTANT_SMOKE_ATTEMPTS ?? '30', 10);
const delayMs = Number.parseInt(process.env.ASSISTANT_SMOKE_DELAY_MS ?? '1000', 10);

const fail = (message) => {
  throw new Error(`[assistant:smoke] ${message}`);
};

async function fetchWithRetry(url, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
      if (response.ok || attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
  }
  throw lastError ?? new Error('request failed');
}

const health = await fetchWithRetry(`${apiBaseUrl}/api/health`, { headers: { accept: 'application/json' } });
if (health.status !== 200) fail(`/api/health returned HTTP ${health.status}`);
let healthBody;
try {
  healthBody = await health.json();
} catch {
  fail('/api/health did not return JSON');
}
if (healthBody?.status !== 'ok') fail('/api/health did not return status=ok');

const preflight = await fetchWithRetry(`${apiBaseUrl}/api/health`, {
  method: 'OPTIONS',
  headers: {
    Origin: allowedOrigin,
    'Access-Control-Request-Method': 'GET',
  },
});
if (preflight.status < 200 || preflight.status >= 300) fail(`allowed CORS preflight returned HTTP ${preflight.status}`);
if (preflight.headers.get('access-control-allow-origin') !== allowedOrigin) fail('allowed CORS origin was not echoed exactly');

const rejectedOrigin = 'http://assistant-smoke.invalid';
const rejected = await fetch(`${apiBaseUrl}/api/health`, {
  headers: { Origin: rejectedOrigin, accept: 'application/json' },
  signal: AbortSignal.timeout(5_000),
});
if (rejected.headers.get('access-control-allow-origin') === rejectedOrigin) fail('untrusted CORS origin was allowed');

const background = await fetchWithRetry(`${apiBaseUrl}/api/generate-background`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'image/png' },
  body: JSON.stringify({ styleId: 'studio_white' }),
});
if (background.status !== 200) fail(`/api/generate-background returned HTTP ${background.status}`);
if (!background.headers.get('content-type')?.toLowerCase().startsWith('image/png')) fail('fixture background response is not image/png');
if ((await background.arrayBuffer()).byteLength === 0) fail('fixture background response is empty');

const ui = await fetchWithRetry(`${uiBaseUrl}/`, { headers: { accept: 'text/html' } });
if (ui.status !== 200) fail(`UI root returned HTTP ${ui.status}`);

console.log(`[assistant:smoke] api=ok cors=allowlist background=fixture ui=ok`);
