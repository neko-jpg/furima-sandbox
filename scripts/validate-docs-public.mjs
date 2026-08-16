import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = ['openapi.yaml', 'browser-api.md', 'listing-flow.md', 'error-codes.md'];
const generated = ['index.html', '_headers', 'api/openapi.yaml', 'api/browser-api.html', 'api/listing-flow.html', 'api/error-codes.html', 'assets/scalar.js', 'assets/scalar.css'];
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,})/u,
  /data:image\//u,
  /[A-Za-z]:\\(?:Users|home|root)\\/iu,
  /FURIMA_D1_API_TOKEN\s*=/u,
];

for (const file of required) {
  const path = resolve(root, 'docs/api', file);
  const text = await readFile(path, 'utf8');
  for (const pattern of forbidden) if (pattern.test(text)) throw new Error(`[docs:public] forbidden content in ${file}: ${pattern}`);
}

const scalarSource = await readFile(resolve(root, 'docs/scalar-entry.js'), 'utf8');
for (const token of ['url: \'./api/openapi.yaml\'', 'hideTestRequestButton: true', 'showDeveloperTools: \'never\'', 'agent: { disabled: true }', 'withDefaultFonts: false']) {
  if (!scalarSource.includes(token)) throw new Error(`[docs:public] Scalar configuration is missing ${token}`);
}

let generatedChecked = false;
const generatedRoot = resolve(root, 'output/docs-site');
let generatedExists = true;
try {
  await access(generatedRoot);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  generatedExists = false;
}

if (generatedExists) {
  const generatedText = new Map(await Promise.all(generated.map(async (file) => [file, await readFile(resolve(generatedRoot, file), 'utf8')])));
  const index = generatedText.get('index.html');
  const headers = generatedText.get('_headers');
  if (!index.includes('scalar-api-reference')) throw new Error('[docs:public] Scalar mount is missing from generated index');
  for (const token of ['<body class="docs-page">', 'class="docs-main"', 'class="docs-shell"']) {
    if (!index.includes(token)) throw new Error(`[docs:public] generated layout guard is missing ${token}`);
  }
  if (index.includes('cdn.jsdelivr.net') || index.includes('proxy.scalar.com')) throw new Error('[docs:public] generated site references an external Scalar runtime');
  if (!headers.includes('Content-Security-Policy:') || !headers.includes("frame-ancestors 'none'")) throw new Error('[docs:public] security headers are incomplete');
  generatedChecked = true;
}

console.log(`[docs:public] sanitized API source files=${required.length}, generated=${generatedChecked ? 'checked' : 'not-built'}`);
