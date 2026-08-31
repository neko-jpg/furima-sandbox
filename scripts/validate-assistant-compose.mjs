import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const fail = (message) => {
  throw new Error(`[assistant:config] ${message}`);
};

const compose = YAML.parse(await readFile(resolve(root, 'compose.yaml'), 'utf8'));
const services = compose?.services;
if (!services || typeof services !== 'object') fail('compose.yaml must define services');

const service = (name) => {
  const value = services[name];
  if (!value || typeof value !== 'object') fail(`missing Compose service: ${name}`);
  return value;
};

const environment = (name) => service(name).environment ?? {};
const value = (name, key) => environment(name)[key];
const textValue = (name, key) => String(value(name, key) ?? '');
const includes = (list, expected) => Array.isArray(list) && list.some((item) => String(item) === expected);

const ui = service('ui');
const api = service('assistant-api');
const agent = service('assistant-agent');
const rembg = service('rembg');

if (api.build?.context !== '.' || api.build?.dockerfile !== 'services/listing_photo_assistant/Dockerfile') {
  fail('assistant-api must build from the repository Dockerfile');
}
if (textValue('assistant-api', 'PROVIDER_MODE') !== '${PROVIDER_MODE:-fixture}') {
  fail('assistant-api must default to PROVIDER_MODE=fixture');
}
if (textValue('assistant-api', 'API_HOST') !== '0.0.0.0' || textValue('assistant-api', 'API_PORT') !== '3001') {
  fail('assistant-api must bind its configured container port');
}
if (textValue('assistant-api', 'ASSISTANT_CORS_ORIGINS') !== 'http://127.0.0.1:3000,http://localhost:3000') {
  fail('assistant-api CORS must be the explicit local allowlist');
}
if (textValue('assistant-api', 'ASSISTANT_CORS_ORIGINS').includes('*')) fail('wildcard CORS is forbidden');

const corsOrigins = textValue('assistant-api', 'ASSISTANT_CORS_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean);
if (corsOrigins.length !== 2 || new Set(corsOrigins).size !== corsOrigins.length) fail('CORS allowlist must contain two distinct origins');
for (const origin of corsOrigins) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail(`invalid CORS origin: ${origin}`);
  }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/') {
    fail(`CORS origin is outside the local allowlist: ${origin}`);
  }
}

const apiCommand = api.command?.map((item) => String(item)) ?? [];
const expectedApiCommand = ['uv', 'run', '--frozen', '--no-sync', 'python', '-m', 'services.listing_photo_assistant.server'];
if (apiCommand.join('\u0000') !== expectedApiCommand.join('\u0000')) {
  fail('assistant-api must execute through the frozen uv environment');
}
const agentCommand = agent.command?.map((item) => String(item)) ?? [];
const expectedAgentCommand = ['uv', 'run', '--frozen', '--no-sync', 'python', '-m', 'services.listing_photo_assistant.agent'];
if (agentCommand.join('\u0000') !== expectedAgentCommand.join('\u0000')) {
  fail('assistant-agent must execute through the frozen uv environment');
}

if (!includes(agent.profiles, 'live')) fail('assistant-agent must be limited to the live profile');
if (textValue('assistant-agent', 'PROVIDER_MODE') !== 'live') fail('assistant-agent must not run in fixture mode');
if (!includes(rembg.profiles, 'live')) fail('rembg must be limited to the live profile');
if (Array.isArray(rembg.ports) && rembg.ports.length > 0) fail('rembg must not publish a host port');
if (!includes(rembg.expose, '7000')) fail('rembg must expose its private service port to Compose only');
if (rembg.image !== 'docker.io/danielgatis/rembg:2.0.81') fail('rembg image must remain pinned to 2.0.81');

if (ui.environment?.VITE_LISTING_ASSISTANT_API_URL !== 'http://127.0.0.1:3001') {
  fail('UI must use the public local assistant API URL');
}
if (!ui.depends_on?.['assistant-api'] || ui.depends_on['assistant-api'].condition !== 'service_healthy') {
  fail('UI must wait for assistant-api health');
}
for (const [serviceName, serviceEnvironment] of Object.entries({ ui: ui.environment ?? {}, 'assistant-api': api.environment ?? {}, 'assistant-agent': agent.environment ?? {} })) {
  for (const key of Object.keys(serviceEnvironment)) {
    if (/^(?:OPENAI_API_KEY|LIVEKIT_API_KEY|LIVEKIT_API_SECRET|BACKGROUND_GENERATOR_URL|REMBG_URL)$/u.test(key) && serviceName === 'ui') {
      fail(`server-only credential/provider setting is exposed to the UI: ${key}`);
    }
    if (/^VITE_.*(?:KEY|SECRET|TOKEN)$/u.test(key)) fail(`secret-like VITE variable is forbidden: ${key}`);
  }
}
for (const serviceName of ['ui', 'assistant-api']) {
  if (!service(serviceName).healthcheck) fail(`${serviceName} must define a healthcheck`);
}

const envExample = await readFile(resolve(root, '.env.example'), 'utf8');
const requiredEntries = {
  PROVIDER_MODE: 'fixture',
  VITE_LISTING_ASSISTANT_MODE: 'fixture',
  VITE_LISTING_ASSISTANT_API_URL: 'http://127.0.0.1:3001',
  ASSISTANT_CORS_ORIGINS: 'http://127.0.0.1:3000,http://localhost:3000',
};
for (const [key, expected] of Object.entries(requiredEntries)) {
  const match = envExample.match(new RegExp(`^${key}=(.*)$`, 'mu'));
  if (!match || match[1] !== expected) fail(`.env.example must declare ${key}=${expected}`);
}
for (const secretName of ['OPENAI_API_KEY', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
  const match = envExample.match(new RegExp(`^${secretName}=(.*)$`, 'mu'));
  if (!match || match[1].trim() !== '') fail(`${secretName} must be empty in .env.example`);
}
if (/^VITE_.*(?:KEY|SECRET|TOKEN)=/mu.test(envExample)) fail('.env.example contains a secret-like VITE variable');
for (const pattern of [/-----BEGIN [^-]+ PRIVATE KEY-----/u, /(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,})/u, /data:image\//u]) {
  if (pattern.test(envExample)) fail(`.env.example contains forbidden material: ${pattern}`);
}

const policyFiles = [
  'docs/api/openapi.yaml',
  'docs/api/listing-flow.md',
  'docs/architecture.md',
  'docs/runbooks/listing-photo-assistant.md',
  'docs/wiki/Listing-Flow.md',
  'docs/wiki/Local-Development.md',
  'docs/wiki/Release-Runbook.md',
  'docs/wiki/_Footer.md',
];
const policyPatterns = [
  /-----BEGIN [^-]+ PRIVATE KEY-----/u,
  /(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/u,
  /data:image\//u,
];
for (const file of policyFiles) {
  const content = await readFile(resolve(root, file), 'utf8');
  for (const pattern of policyPatterns) if (pattern.test(content)) fail(`${file} contains forbidden material: ${pattern}`);
}

console.log(`[assistant:config] services=ui,assistant-api,assistant-agent,rembg; cors=${corsOrigins.join(',')}; liveProfile=checked; secretPolicy=ok; docsPolicy=ok`);
