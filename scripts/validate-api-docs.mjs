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
if (document.paths['/api/health']['x-implementation-status'] !== 'python-service') fail('/api/health must be marked as a Python service contract');
if (!document.info.description.includes('8339803b45b4899ba61546a4e1686d65a0ecd54c')) fail('Team-D backend baseline is missing from the API contract');

const corsPolicy = document['x-cors-policy'];
if (!corsPolicy || JSON.stringify(corsPolicy.allowOrigins) !== JSON.stringify(['http://127.0.0.1:3000', 'http://localhost:3000'])) fail('assistant CORS origins must match the explicit local allowlist');
if (JSON.stringify(corsPolicy.allowMethods) !== JSON.stringify(['GET', 'POST'])) fail('assistant CORS methods must be GET and POST');
if (JSON.stringify(corsPolicy.allowHeaders) !== JSON.stringify(['accept', 'content-type'])) fail('assistant CORS headers must match FastAPI');
if (corsPolicy.allowCredentials !== false || corsPolicy.allowOrigins.includes('*')) fail('assistant CORS must not allow credentials or wildcard origins');

const assistantPaths = {
  '/api/health': {
    method: 'get',
    statuses: ['200'],
    successContentType: 'application/json',
    successSchema: '#/components/schemas/AssistantHealth',
  },
  '/api/livekit-token': {
    method: 'post',
    statuses: ['200', '422', '503'],
    requestContentType: 'application/json',
    requestSchema: '#/components/schemas/LiveKitTokenRequest',
    successContentType: 'application/json',
    successSchema: '#/components/schemas/LiveKitTokenResponse',
  },
  '/api/analyze-shot': {
    method: 'post',
    statuses: ['200', '413', '415', '422', '502', '503', '504'],
    requestContentType: 'multipart/form-data',
    requestSchema: '#/components/schemas/ShotAnalysisUpload',
    successContentType: 'application/json',
    successSchema: '#/components/schemas/ShotAssessment',
  },
  '/api/suggest-measurement-points': {
    method: 'post',
    statuses: ['200', '413', '415', '422', '502', '503', '504'],
    requestContentType: 'multipart/form-data',
    requestSchema: '#/components/schemas/MeasurementPointsUpload',
    successContentType: 'application/json',
    successSchema: '#/components/schemas/MeasurementPointSuggestion',
  },
  '/api/remove-background': {
    method: 'post',
    statuses: ['200', '413', '415', '422', '502', '503', '504'],
    requestContentType: 'multipart/form-data',
    requestSchema: '#/components/schemas/FrontImageUpload',
    successContentType: 'image/png',
    successSchema: { type: 'string', format: 'binary' },
  },
  '/api/generate-background': {
    method: 'post',
    statuses: ['200', '422', '502', '503', '504'],
    requestContentType: 'application/json',
    requestSchema: '#/components/schemas/BackgroundGenerationRequest',
    successContentType: 'image/png',
    successSchema: { type: 'string', format: 'binary' },
  },
};

const assistantResponses = document.components.responses;
const assistantSchemas = document.components.schemas;
const assistantValidation = assistantResponses.AssistantValidationError;
if (assistantValidation?.content?.['application/json']?.schema?.$ref !== '#/components/schemas/AssistantValidationErrorResponse') fail('assistant 422 response must allow validation and safe provider errors');
const assistantValidationSchema = assistantSchemas.AssistantValidationErrorResponse;
if (!assistantValidationSchema || assistantValidationSchema.additionalProperties !== false || JSON.stringify(assistantValidationSchema.required) !== JSON.stringify(['detail'])) fail('assistant validation error schema is incomplete');
const assistantValidationVariants = assistantValidationSchema.properties?.detail?.oneOf ?? [];
if (!assistantValidationVariants.some((variant) => variant.$ref === '#/components/schemas/ProviderError') || !assistantValidationVariants.some((variant) => variant.type === 'array')) fail('assistant validation error schema must include ProviderError and FastAPI validation details');

for (const [path, expected] of Object.entries(assistantPaths)) {
  const operation = document.paths[path]?.[expected.method];
  if (!operation) fail(`${path} must define ${expected.method.toUpperCase()}`);
  const statuses = Object.keys(operation.responses ?? {});
  if (JSON.stringify(statuses) !== JSON.stringify(expected.statuses)) fail(`${path} response status set is out of sync`);
  if (expected.requestContentType) {
    const requestContent = operation.requestBody?.content?.[expected.requestContentType];
    if (!requestContent || requestContent.schema?.$ref !== expected.requestSchema) fail(`${path} request body is out of sync`);
    if (expected.requestContentType === 'multipart/form-data' && requestContent.encoding?.file?.contentType !== 'image/jpeg, image/png, image/webp') fail(`${path} upload MIME contract is out of sync`);
  }
  const success = operation.responses['200'];
  const successContent = success?.content?.[expected.successContentType];
  if (!successContent) fail(`${path} success content type is out of sync`);
  if (typeof expected.successSchema === 'string' && successContent.schema?.$ref !== expected.successSchema) fail(`${path} success schema is out of sync`);
  if (typeof expected.successSchema === 'object' && JSON.stringify(successContent.schema) !== JSON.stringify(expected.successSchema)) fail(`${path} binary success schema is out of sync`);
  if (path !== '/api/health' && path !== '/api/livekit-token') {
    if (operation.responses['413']?.$ref !== '#/components/responses/ProviderFailure' && path !== '/api/generate-background') fail(`${path} upload-size error must use ProviderFailure`);
    if (operation.responses['502']?.$ref !== '#/components/responses/ProviderFailure' || operation.responses['503']?.$ref !== '#/components/responses/ProviderFailure' || operation.responses['504']?.$ref !== '#/components/responses/ProviderFailure') fail(`${path} provider error responses are incomplete`);
  }
  if (path === '/api/livekit-token' && operation.responses['503']?.$ref !== '#/components/responses/ProviderFailure') fail('/api/livekit-token unavailable response is out of sync');
  if (path === '/api/analyze-shot' && operation.responses['415']?.$ref !== '#/components/responses/ProviderFailure') fail('/api/analyze-shot MIME error is out of sync');
  if (path === '/api/suggest-measurement-points') {
    if (!operation.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/RequestId')) fail('measurement endpoint must document X-Request-ID');
    for (const header of ['Cache-Control', 'X-Content-Type-Options', 'X-Request-ID']) {
      if (!success.headers?.[header]) fail(`measurement success response must document ${header}`);
    }
  }
}

const healthSchema = assistantSchemas.AssistantHealth;
if (!healthSchema || healthSchema.additionalProperties !== false || JSON.stringify(healthSchema.required) !== JSON.stringify(['status']) || healthSchema.properties?.status?.const !== 'ok') fail('assistant health schema must be the secret-free status=ok object');
for (const [path, headers] of Object.entries({
  '/api/health': ['Cache-Control'],
  '/api/remove-background': ['Cache-Control', 'X-Content-Type-Options'],
  '/api/generate-background': ['Cache-Control'],
})) {
  const operation = document.paths[path].get ?? document.paths[path].post;
  for (const header of headers) if (!operation.responses['200'].headers?.[header]) fail(`${path} success response must document ${header}`);
}
const requestId = document.components.parameters.RequestId;
if (!requestId || requestId.name !== 'X-Request-ID' || requestId.in !== 'header' || requestId.schema?.minLength !== 1 || requestId.schema?.maxLength !== 200) fail('X-Request-ID bounds are missing');
const providerErrorCodes = assistantSchemas.ProviderErrorCode?.enum ?? [];
if (JSON.stringify(providerErrorCodes) !== JSON.stringify(['TIMEOUT', 'UNAVAILABLE', 'INVALID_RESPONSE', 'INVALID_INPUT', 'UNKNOWN'])) fail('public provider error codes must exclude internal adapter codes');
for (const forbidden of ['OPENAI_API_KEY', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'data:image/']) if (openapiText.includes(forbidden)) fail(`public API docs contain forbidden secret or image data: ${forbidden}`);
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
