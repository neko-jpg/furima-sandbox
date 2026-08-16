import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = ['openapi.yaml', 'browser-api.md', 'listing-flow.md', 'error-codes.md'];
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

console.log(`[docs:public] sanitized API source files=${required.length}`);
