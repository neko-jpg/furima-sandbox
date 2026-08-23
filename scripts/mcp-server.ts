import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpSandboxAdapter } from "../app/domain/mcpSandboxAdapter.ts";

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

const configuredActor = process.env.FURIMA_MCP_ACTOR_ID === 'buyer_01' ? 'buyer_01' : 'seller_01';
const adapter = createMcpSandboxAdapter({ actorId: configuredActor });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return adapter.listTools();
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return adapter.callTool(request.params.name, request.params.arguments ?? {});
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
