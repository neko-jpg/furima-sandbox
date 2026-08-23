import { z } from 'zod';
import { INITIAL_ITEMS, INITIAL_NOTIFICATIONS } from '../data/initialData.ts';
import { SandboxCommandExecutor, previewOperationFor } from './commandExecutor.ts';
import { MemorySandboxStateStore } from './sandboxStore.ts';
import { SandboxEngine, createTrustedPrincipal } from './sandboxEngine.ts';
import type { ActionResult, AgentActionOptions, ExecutionPrincipal, PreviewCommand } from '../types/mercari.ts';

const DEFAULT_SANDBOX_ID = 'furima-mcp-demo';
const DEFAULT_ACTOR_ID = 'seller_01';

const ListingFieldsSchema = z.object({
  title: z.string().min(1).max(40),
  description: z.string().max(5000),
  price: z.number().int().min(0),
  category: z.array(z.string().min(1).max(80)).min(1).max(10),
  condition: z.string().max(100).optional(),
  imageRefs: z.array(z.string().regex(/^media_[A-Za-z0-9_-]+$/u)).max(20).optional(),
}).strict();

const DraftListingSchema = ListingFieldsSchema.extend({ idempotencyKey: z.string().min(1).max(200) }).strict();
const PreviewListingSchema = ListingFieldsSchema.extend({ idempotencyKey: z.string().min(1).max(200) }).strict();
const CommitPreviewSchema = z.object({
  previewId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
}).strict();
const SearchItemsSchema = z.object({ query: z.string().max(200).optional() }).strict();
const GetItemDetailSchema = z.object({ itemId: z.string().min(1).max(200) }).strict();
const NegotiatePriceSchema = z.object({ itemId: z.string().min(1).max(200), price: z.number().int().min(0), idempotencyKey: z.string().min(1).max(200) }).strict();
const PurchaseItemSchema = z.object({ itemId: z.string().min(1).max(200), idempotencyKey: z.string().min(1).max(200) }).strict();

const actorFor = (actorId: string): { id: 'buyer_01' | 'seller_01'; role: 'buyer' | 'seller' } => actorId === 'buyer_01'
  ? { id: 'buyer_01', role: 'buyer' }
  : { id: 'seller_01', role: 'seller' };

const toolResult = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

const resultFor = <T,>(result: ActionResult<T>) => toolResult(result, !result.ok);

const listingPayloadFor = (input: z.infer<typeof ListingFieldsSchema>) => ({
  ...input,
  condition: input.condition ?? '目立った傷や汚れなし',
  shippingFee: '送料込み（出品者負担）',
  shippingMethod: 'らくらくメルカリ便',
  origin: '東京都',
  shippingDays: '1〜2日で発送',
});

export interface McpSandboxAdapterOptions {
  sandboxId?: string;
  actorId?: 'buyer_01' | 'seller_01';
}

export interface McpSandboxAdapter {
  listTools: () => { tools: Array<Record<string, unknown>> };
  callTool: (name: string, args: unknown) => Promise<ReturnType<typeof toolResult>>;
  getSnapshot: () => ReturnType<SandboxEngine['getSnapshot']>;
}

export const createMcpSandboxAdapter = (options: McpSandboxAdapterOptions = {}): McpSandboxAdapter => {
  const sandboxId = options.sandboxId ?? DEFAULT_SANDBOX_ID;
  const selectedActor = actorFor(options.actorId ?? DEFAULT_ACTOR_ID);
  const principal: ExecutionPrincipal = createTrustedPrincipal({
    subjectId: `mcp-stdio-session:${selectedActor.id}`,
    actorId: selectedActor.id,
    roles: [selectedActor.role],
    scopes: ['user'],
  });
  const controlPrincipal = createTrustedPrincipal({
    subjectId: 'mcp-adapter-initializer',
    actorId: 'platform',
    roles: ['platform'],
    scopes: ['sandbox-control', 'operator'],
  });
  const executionOptions = (idempotencyKey?: string): AgentActionOptions => ({
    principal,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  const engine = new SandboxEngine(INITIAL_ITEMS, { sandboxId, notifications: INITIAL_NOTIFICATIONS });
  const switched = engine.switchActor(selectedActor.id, { principal: controlPrincipal });
  if (!switched.ok) throw new Error(`MCP actor initialization failed: ${switched.error}`);
  const store = new MemorySandboxStateStore();
  const executor = new SandboxCommandExecutor({ engine, store });
  const initialized = store.put({
    id: sandboxId,
    scenarioId: engine.getSnapshot().scenarioId,
    seed: engine.getSnapshot().seed,
    stateVersion: engine.getStateVersion(),
    virtualNow: engine.getNow(),
    payload: engine.exportState(),
    updatedAt: new Date().toISOString(),
  }, undefined, true);

  const listTools = () => ({
    tools: [
      {
        name: 'search_items',
        description: 'Search the catalog. This is a read-only data-plane operation.',
        inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 200 } } },
      },
      {
        name: 'get_item_detail',
        description: 'Get one catalog item. This is a read-only data-plane operation.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['itemId'], properties: { itemId: { type: 'string', maxLength: 200 } } },
      },
      {
        name: 'draft_listing',
        description: 'Create a seller-owned listing draft. The MCP session actor is fixed by server configuration.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'description', 'price', 'category', 'idempotencyKey'], properties: { title: { type: 'string' }, description: { type: 'string' }, price: { type: 'integer' }, category: { type: 'array', items: { type: 'string' } }, condition: { type: 'string' }, imageRefs: { type: 'array', items: { type: 'string' } }, idempotencyKey: { type: 'string' } } },
      },
      {
        name: 'preview_listing',
        description: 'Preview a seller-owned listing through the shared command executor without changing durable state.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'description', 'price', 'category', 'idempotencyKey'], properties: { title: { type: 'string' }, description: { type: 'string' }, price: { type: 'integer' }, category: { type: 'array', items: { type: 'string' } }, condition: { type: 'string' }, imageRefs: { type: 'array', items: { type: 'string' } }, idempotencyKey: { type: 'string' } } },
      },
      {
        name: 'commit_preview',
        description: 'Commit a preview created by this fixed MCP session actor using the shared idempotent command executor.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['previewId', 'idempotencyKey'], properties: { previewId: { type: 'string' }, idempotencyKey: { type: 'string' } } },
      },
      {
        name: 'negotiate_price',
        description: 'Add a negotiation comment or place a bid through the shared command executor.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['itemId', 'price', 'idempotencyKey'], properties: { itemId: { type: 'string' }, price: { type: 'integer' }, idempotencyKey: { type: 'string' } } },
      },
      {
        name: 'purchase_item',
        description: 'Start and confirm a purchase through the shared command executor. Requires a buyer-configured MCP session.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['itemId', 'idempotencyKey'], properties: { itemId: { type: 'string' }, idempotencyKey: { type: 'string' } } },
      },
    ],
  });

  const callTool = async (name: string, args: unknown) => {
    await initialized;
    try {
      switch (name) {
        case 'search_items': {
          const { query } = SearchItemsSchema.parse(args ?? {});
          const normalized = query?.trim().toLocaleLowerCase('ja-JP') ?? '';
          const items = engine.getItems().filter((item) => !normalized || `${item.title} ${item.description} ${item.category.join(' ')}`.toLocaleLowerCase('ja-JP').includes(normalized));
          return toolResult(items);
        }
        case 'get_item_detail': {
          const { itemId } = GetItemDetailSchema.parse(args);
          const item = engine.getItem(itemId);
          return item ? toolResult(item) : toolResult({ ok: false, error: 'ITEM_NOT_FOUND' }, true);
        }
        case 'draft_listing': {
          const parsed = DraftListingSchema.parse(args);
          const payload = listingPayloadFor(parsed);
          return resultFor(await executor.execute('createListingDraft', payload, executionOptions(parsed.idempotencyKey), (working) => working.createListingDraft(payload, executionOptions(parsed.idempotencyKey))));
        }
        case 'preview_listing': {
          const parsed = PreviewListingSchema.parse(args);
          const payload = listingPayloadFor(parsed);
          return resultFor(await executor.preview('listing.create', payload, executionOptions(parsed.idempotencyKey), (working) => previewOperationFor('listing.create', payload, principal.actorId, working)));
        }
        case 'commit_preview': {
          const parsed = CommitPreviewSchema.parse(args);
          return resultFor(await executor.commitPreview(parsed.previewId, executionOptions(parsed.idempotencyKey), (working, command, payload) => previewOperationFor(command as PreviewCommand, payload, principal.actorId, working)));
        }
        case 'negotiate_price': {
          const parsed = NegotiatePriceSchema.parse(args);
          const item = engine.getItem(parsed.itemId);
          if (!item) return toolResult({ ok: false, error: 'ITEM_NOT_FOUND' }, true);
          if (item.isAuction) return resultFor(await executor.execute('placeBid', { itemId: parsed.itemId, amount: parsed.price }, executionOptions(parsed.idempotencyKey), (working) => working.placeBid(parsed.itemId, parsed.price, executionOptions(parsed.idempotencyKey))));
          return resultFor(await executor.execute('addComment', { itemId: parsed.itemId, text: `値下げ交渉: ${parsed.price}円にできませんか？` }, executionOptions(parsed.idempotencyKey), (working) => working.addComment(parsed.itemId, `値下げ交渉: ${parsed.price}円にできませんか？`, executionOptions(parsed.idempotencyKey))));
        }
        case 'purchase_item': {
          const parsed = PurchaseItemSchema.parse(args);
          const start = await executor.execute('startPurchase', { itemId: parsed.itemId }, executionOptions(`${parsed.idempotencyKey}:start`), (working) => working.startPurchase(parsed.itemId, executionOptions(`${parsed.idempotencyKey}:start`)));
          if (!start.ok) return resultFor(start);
          return resultFor(await executor.execute('purchaseItem', { itemId: parsed.itemId }, executionOptions(parsed.idempotencyKey), (working) => working.purchaseItemWithPricing(parsed.itemId, undefined, executionOptions(parsed.idempotencyKey))));
        }
        default:
          return toolResult({ ok: false, error: 'UNKNOWN_TOOL' }, true);
      }
    } catch (error) {
      if (error instanceof z.ZodError) return toolResult({ ok: false, error: 'INVALID_INPUT', details: error.issues }, true);
      return toolResult({ ok: false, error: 'INTERNAL_ERROR' }, true);
    }
  };

  return { listTools, callTool, getSnapshot: () => engine.getSnapshot() };
};
