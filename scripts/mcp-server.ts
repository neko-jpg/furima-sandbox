import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SandboxEngine } from "../app/domain/sandboxEngine.ts";
import { INITIAL_ITEMS, INITIAL_NOTIFICATIONS } from "../app/data/initialData.ts";

const engine = new SandboxEngine(INITIAL_ITEMS, { notifications: INITIAL_NOTIFICATIONS });

const server = new Server(
  {
    name: "furima-sandbox-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const SearchItemsSchema = z.object({
  query: z.string().optional(),
});

const GetItemDetailSchema = z.object({
  itemId: z.string(),
});

const DraftListingSchema = z.object({
  title: z.string(),
  description: z.string(),
  price: z.number(),
  category: z.array(z.string()),
  condition: z.string().optional(),
});

const NegotiatePriceSchema = z.object({
  itemId: z.string(),
  price: z.number(),
});

const PurchaseItemSchema = z.object({
  itemId: z.string(),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_items",
        description: "Search items in the catalog.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
      {
        name: "get_item_detail",
        description: "Get details of a specific item.",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string" },
          },
          required: ["itemId"],
        },
      },
      {
        name: "draft_listing",
        description: "Draft a new listing.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            price: { type: "number" },
            category: { type: "array", items: { type: "string" } },
            condition: { type: "string" },
          },
          required: ["title", "description", "price", "category"],
        },
      },
      {
        name: "negotiate_price",
        description: "Negotiate the price of an item via comments or place a bid on an auction.",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            price: { type: "number" },
          },
          required: ["itemId", "price"],
        },
      },
      {
        name: "purchase_item",
        description: "Purchase an item.",
        inputSchema: {
          type: "object",
          properties: {
            itemId: { type: "string" },
          },
          required: ["itemId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "search_items": {
        const { query } = SearchItemsSchema.parse(request.params.arguments);
        let items = engine.getItems();
        if (query) {
          const lowerQuery = query.toLowerCase();
          items = items.filter(
            (item) =>
              item.title.toLowerCase().includes(lowerQuery) ||
              item.description?.toLowerCase().includes(lowerQuery) ||
              item.category.some((c) => c.toLowerCase().includes(lowerQuery))
          );
        }
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      }

      case "get_item_detail": {
        const { itemId } = GetItemDetailSchema.parse(request.params.arguments);
        const item = engine.getItem(itemId);
        if (!item) {
          return { content: [{ type: "text", text: `Item with id ${itemId} not found.` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }] };
      }

      case "draft_listing": {
        const args = DraftListingSchema.parse(request.params.arguments);
        const result = engine.listItem({
          title: args.title,
          description: args.description,
          price: args.price,
          category: args.category,
          condition: args.condition ?? '目立った傷や汚れなし',
          shippingFee: '送料込み（出品者負担）',
          shippingMethod: 'らくらくメルカリ便',
          origin: '東京都',
          shippingDays: '1〜2日で発送',
        }, { actorId: 'seller_01' });

        if (!result.ok) {
          return { content: [{ type: "text", text: `Error: ${result.error} - ${result.message}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
      }

      case "negotiate_price": {
        const { itemId, price } = NegotiatePriceSchema.parse(request.params.arguments);
        const item = engine.getItem(itemId);
        if (!item) {
          return { content: [{ type: "text", text: `Item with id ${itemId} not found.` }], isError: true };
        }

        if (item.isAuction) {
          const bidResult = engine.placeBid(itemId, price, { actorId: 'buyer_01' });
          if (!bidResult.ok) {
            return { content: [{ type: "text", text: `Error: ${bidResult.error} - ${bidResult.message}` }], isError: true };
          }
          return { content: [{ type: "text", text: JSON.stringify(bidResult.data, null, 2) }] };
        } else {
          // Implement comment appending logic similar to UI
          const newComment = {
            id: `comment-${Date.now()}`,
            userId: 'buyer_01',
            userName: 'Sandbox Buyer',
            userAvatar: '/favicon.svg',
            text: `値下げ交渉: ${price}円にできませんか？`,
            date: new Date().toISOString().slice(0, 10),
          };

          const items = engine.getItems();
          const nextItems = items.map(i => i.id === itemId ? { ...i, comments: [...(i.comments || []), newComment] } : i);
          engine.replaceItems(nextItems);

          return { content: [{ type: "text", text: `Successfully appended price negotiation comment to item ${itemId}.` }] };
        }
      }

      case "purchase_item": {
        const { itemId } = PurchaseItemSchema.parse(request.params.arguments);

        const startResult = engine.startPurchase(itemId, { actorId: 'buyer_01' });
        if (!startResult.ok) {
          return { content: [{ type: "text", text: `Start Purchase Error: ${startResult.error} - ${startResult.message}` }], isError: true };
        }

        const confirmResult = engine.purchaseItemWithPricing(itemId, undefined, { actorId: 'buyer_01' });

        if (!confirmResult.ok) {
          return { content: [{ type: "text", text: `Confirm Purchase Error: ${confirmResult.error} - ${confirmResult.message}` }], isError: true };
        }

        return { content: [{ type: "text", text: JSON.stringify(confirmResult.data, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [{ type: "text", text: `Validation error: ${error.issues.map((issue) => issue.message).join(", ")}` }],
        isError: true,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Furima Sandbox MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
