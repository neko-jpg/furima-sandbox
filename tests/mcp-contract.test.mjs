import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createMcpSandboxAdapter } from '../app/domain/mcpSandboxAdapter.ts';

const readResult = (value) => JSON.parse(value.content[0].text);

const listingArgs = (idempotencyKey) => ({
  title: 'MCP security demo listing',
  description: 'A listing created through the shared MCP command path.',
  price: 1800,
  category: ['その他'],
  imageRefs: ['media_mcp_demo'],
  idempotencyKey,
});

test('MCP exposes only fixed-session data-plane tools and rejects actor injection', async () => {
  const adapter = createMcpSandboxAdapter({ sandboxId: 'mcp-contract', actorId: 'seller_01' });
  const tools = adapter.listTools().tools;
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names, ['search_items', 'get_item_detail', 'draft_listing', 'preview_listing', 'commit_preview', 'negotiate_price', 'purchase_item']);
  assert.equal(names.some((name) => /reset|import|export|actor|fault|inject/i.test(name)), false);

  const rejected = await adapter.callTool('draft_listing', { ...listingArgs('mcp-reject-1'), actorId: 'platform' });
  assert.equal(rejected.isError, true);
  assert.equal(readResult(rejected).error, 'INVALID_INPUT');
});

test('MCP draft to preview to commit uses shared state and idempotency semantics', async () => {
  const adapter = createMcpSandboxAdapter({ sandboxId: 'mcp-flow', actorId: 'seller_01' });
  const draft = await adapter.callTool('draft_listing', listingArgs('mcp-draft-1'));
  assert.equal(draft.isError, undefined);
  const repeatedDraft = await adapter.callTool('draft_listing', listingArgs('mcp-draft-1'));
  assert.deepEqual(repeatedDraft, draft);

  const beforePreviewVersion = adapter.getSnapshot().stateVersion;
  const preview = await adapter.callTool('preview_listing', listingArgs('mcp-preview-1'));
  assert.equal(preview.isError, undefined);
  const previewData = readResult(preview);
  assert.equal(previewData.ok, true);
  assert.equal(adapter.getSnapshot().stateVersion, beforePreviewVersion);

  const commitArgs = { previewId: previewData.data.previewId, idempotencyKey: 'mcp-commit-1' };
  const commit = await adapter.callTool('commit_preview', commitArgs);
  assert.equal(commit.isError, undefined);
  assert.equal(readResult(commit).ok, true);
  const repeatedCommit = await adapter.callTool('commit_preview', commitArgs);
  assert.deepEqual(repeatedCommit, commit);
  assert.equal(adapter.getSnapshot().events.filter((event) => event.type === 'LISTING_PUBLISHED').length, 1);
});

test('MCP buyer session cannot draft a seller listing', async () => {
  const adapter = createMcpSandboxAdapter({ sandboxId: 'mcp-buyer', actorId: 'buyer_01' });
  const result = await adapter.callTool('draft_listing', listingArgs('mcp-buyer-1'));
  assert.equal(result.isError, true);
  assert.equal(readResult(result).error, 'FORBIDDEN');
});

test('protected CI MCP checks require hosted analysis and fail closed without its secret', async () => {
  const verify = await readFile(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8');
  const nightly = await readFile(new URL('../.github/workflows/sandbox-nightly.yml', import.meta.url), 'utf8');
  const runner = await readFile(new URL('../scripts/run-mcp-scan.mjs', import.meta.url), 'utf8');

  assert.match(verify, /github\.event_name == 'pull_request' && 'inspect' \|\| 'hosted'/);
  assert.match(verify, /SNYK_TOKEN:\s*\$\{\{\s*secrets\.SNYK_TOKEN\s*\}\}/);
  assert.match(nightly, /MCP_SCAN_MODE:\s*hosted/);
  assert.match(nightly, /SNYK_TOKEN:\s*\$\{\{\s*secrets\.SNYK_TOKEN\s*\}\}/);
  assert.match(runner, /inspect mode cannot bypass hosted analysis on protected CI events/);
  assert.match(runner, /Protected CI events fail closed when it is missing/);
});
