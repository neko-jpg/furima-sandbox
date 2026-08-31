import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(resolve(root, relativePath), 'utf8');
const fail = (message) => {
  throw new Error(`[docs:check] ${message}`);
};

const [openapiText, browserText, flowText, errorsText, typesText] = await Promise.all([
  read('docs/api/openapi.yaml'),
  read('docs/api/browser-api.md'),
  read('docs/api/listing-flow.md'),
  read('docs/api/error-codes.md'),
  read('app/types/mercari.ts'),
]);

const document = YAML.parse(openapiText);
if (document?.openapi !== '3.1.0') fail('OpenAPI must declare version 3.1.0');
if (!document?.info?.title || !document?.info?.version) fail('OpenAPI info.title and info.version are required');
if (!document?.paths || typeof document.paths !== 'object') fail('OpenAPI paths are required');
if (!document?.components?.schemas?.MercariItem) fail('MercariItem schema is required');
if (!document?.components?.schemas?.ListingMediaRef) fail('ListingMediaRef schema is required');

for (const path of ['/api/catalog', '/api/catalog/{itemId}', '/api/sandbox/state', '/api/sandbox/health', '/api/sandbox/preview', '/api/sandbox/commit', '/api/sandbox/reset', '/api/sandbox/seed', '/api/sandbox/replay', '/api/livekit-token', '/api/analyze-shot', '/api/suggest-measurement-points', '/api/remove-background', '/api/generate-background', '/api/listings', '/api/listings/{itemId}', '/api/follows', '/api/follows/{actorId}', '/api/follows/{actorId}/summary']) {
  if (!document.paths[path]) fail(`missing documented path ${path}`);
}

for (const path of ['/api/livekit-token', '/api/analyze-shot', '/api/suggest-measurement-points', '/api/remove-background', '/api/generate-background']) {
  if (document.paths[path]['x-implementation-status'] !== 'python-service') fail(`${path} must be marked as a Python service contract`);
}
if (!document.info.description.includes('cd7b42a207fc3912fdd5e8e76ac2e91f7f5f5abe')) fail('Team-D backend baseline is missing from the API contract');
const measurementPointSuggestion = document.components.schemas.MeasurementPointSuggestion;
if (!measurementPointSuggestion || measurementPointSuggestion.properties.confidence || JSON.stringify(measurementPointSuggestion.required) !== JSON.stringify(['lengthStart', 'lengthEnd', 'widthStart', 'widthEnd'])) {
  fail('measurement point API must expose exactly four normalized endpoints');
}
const providerError = document.components.schemas.ProviderError;
if (!providerError || JSON.stringify(providerError.required) !== JSON.stringify(['provider', 'code', 'message', 'retryable'])) fail('ProviderError contract is incomplete');

const itemSchema = document.components.schemas.MercariItem;
if (itemSchema.properties.title.maxLength !== 40) fail('title maxLength must be 40');
if (itemSchema.properties.description.maxLength !== 1000) fail('description maxLength must be 1000');
if (itemSchema.properties.price.minimum !== 300 || itemSchema.properties.price.maximum !== 9999999) fail('price bounds must be 300..9999999');
if (itemSchema.properties.images.maxItems !== 20 || itemSchema.properties.imageRefs.maxItems !== 20) fail('image limits must be 20');
if (itemSchema.properties.condition.enum?.length !== 6) fail('condition enum must contain the official six values');

for (const name of ['__SHOP_API__', '__MERCARI_API__', 'waitForReady', 'catalog.list', 'catalog.get', 'getListingDrafts', 'saveListingDraft', 'deleteListingDraft', 'listOwnListings', 'updateListing', 'pauseListing', 'resumeListing', 'relistItem', 'getFollowList', 'getFollowSummary', 'followUser', 'unfollowUser', 'previewAction', 'commitPreview', 'sandboxId', 'operationId', 'requestId', 'idempotencyKey']) {
  if (!browserText.includes(name)) fail(`browser API docs omit ${name}`);
}
for (const name of ['フルスクリーン', '最大20枚', 'IndexedDB', '左右キー', 'preventScroll']) {
  if (!`${flowText}\n${browserText}`.includes(name)) fail(`listing/API docs omit ${name}`);
}

const errorCodeBlock = typesText.match(/export type AgentErrorCode =([\s\S]*?)export type ActionResult/u)?.[1] ?? '';
const errorCodes = [...errorCodeBlock.matchAll(/^\s*\|\s*'([A-Z_]+)'/gm)].map((match) => match[1]);
for (const code of errorCodes) if (!errorsText.includes(code)) fail(`error code ${code} is not documented`);

console.log(`[docs:check] OpenAPI paths=${Object.keys(document.paths).length}, errorCodes=${errorCodes.length}, constraints=ok`);
