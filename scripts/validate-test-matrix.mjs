import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(join(root, path), 'utf8');
const fail = (message) => { throw new Error(`[qa:matrix] ${message}`); };

async function filesUnder(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else result.push(relative(root, target).replaceAll('\\', '/'));
    }
  }
  await visit(join(root, directory));
  return result;
}

const matrix = YAML.parse(await read('docs/qa/test-matrix.yaml'));
const openapi = YAML.parse(await read('docs/api/openapi.yaml'));
const routeFiles = (await filesUnder('app/api')).filter((path) => path.endsWith('/route.ts'));
const contractFirstPythonService = new Set(Object.entries(openapi.paths ?? {})
  .filter(([, definition]) => definition?.['x-implementation-status'] === 'python-service')
  .map(([path]) => path));
const routePaths = routeFiles.map((path) => {
  const parts = path.replace(/^app\/api\//u, '').replace(/\/route\.ts$/u, '').split('/').filter(Boolean);
  return `/api/${parts.map((part) => part.startsWith('[') && part.endsWith(']') ? `{${part.slice(1, -1)}}` : part).join('/')}`;
});
for (const route of routePaths) if (!openapi.paths[route]) fail(`route is not in OpenAPI: ${route}`);
for (const path of Object.keys(openapi.paths)) if (path.startsWith('/api/') && !routePaths.includes(path) && !contractFirstPythonService.has(path) && !['/api/listings', '/api/listings/{itemId}', '/api/wallet', '/api/wallet/deposit', '/api/wallet/withdraw', '/api/profile', '/api/follows', '/api/follows/{actorId}', '/api/follows/{actorId}/summary'].includes(path)) fail(`OpenAPI path has no implementation or explicit contract-first exception: ${path}`);

const types = await read('app/types/mercari.ts');
const apiBlock = types.match(/export interface MercariAgentAPI \{([\s\S]*?)\n\}/u)?.[1] ?? '';
const browserMethods = [...apiBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\s*:/gmu)].map((match) => match[1]);
if (!browserMethods.includes('previewAction') || !browserMethods.includes('commitPreview')) fail('preview/commit are missing from MercariAgentAPI');

const errorBlock = types.match(/export type AgentErrorCode =([\s\S]*?)export type ActionResult/u)?.[1] ?? '';
const errorCodes = [...errorBlock.matchAll(/^\s*\|\s*'([A-Z_]+)'/gmu)].map((match) => match[1]);
const errorDocs = await read('docs/api/error-codes.md');
for (const code of errorCodes) if (!errorDocs.includes(code)) fail(`error code is not documented: ${code}`);

const componentFiles = (await filesUnder('app/components')).filter((path) => path.endsWith('.tsx'));
let interactiveFiles = 0;
let interactiveMarkers = 0;
for (const file of componentFiles) {
  const source = await read(file);
  const matches = source.match(/<button\b|<a\b|<input\b|<textarea\b|<select\b|onClick=|onSubmit=|onChange=/gu) ?? [];
  if (matches.length) {
    interactiveFiles += 1;
    interactiveMarkers += matches.length;
  }
}

for (const suite of matrix.suites ?? []) {
  if (!suite.id || !suite.tests?.length) fail('every suite needs id and tests');
  for (const testPath of suite.tests) {
    if (testPath === 'semgrep/') continue;
    try { await stat(join(root, testPath)); } catch { fail(`suite ${suite.id} references missing evidence: ${testPath}`); }
  }
}
for (const [inventoryName, inventory] of Object.entries(matrix.inventories ?? {})) {
  if (!matrix.suites.some((suite) => suite.id === inventory.suite)) fail(`inventory has no suite: ${inventory.suite}`);
  const sourceDeclaration = typeof inventory.source === 'string' ? inventory.source : '';
  const sources = sourceDeclaration.split(',').map((source) => source.split('#', 1)[0].trim()).filter(Boolean);
  if (sources.length === 0) fail(`inventory ${inventoryName} must declare a source`);
  for (const source of sources) {
    if (source.endsWith('/**') || source.includes('**/')) {
      const baseDirectory = source.split('/**', 1)[0];
      const sourceFiles = (await filesUnder(baseDirectory)).filter((path) => {
        if (source.endsWith('*.py')) return path.endsWith('.py');
        return true;
      });
      if (sourceFiles.length === 0) fail(`inventory ${inventoryName} source has no files: ${source}`);
    } else {
      try { await stat(join(root, source)); } catch { fail(`inventory ${inventoryName} source is missing: ${source}`); }
    }
  }
}

const backendPythonFiles = (await filesUnder('services/listing_photo_assistant')).filter((path) => path.endsWith('.py'));
console.log(`[qa:matrix] routes=${routePaths.length}, browserApiMethods=${browserMethods.length}, errorCodes=${errorCodes.length}, interactiveFiles=${interactiveFiles}, interactiveMarkers=${interactiveMarkers}, backendPythonFiles=${backendPythonFiles.length}, policy=${matrix.policy.missingCoverage}`);
