#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createToolRegistrar } from "./mcp/register.js";
import { registerTools } from "./mcp/registerTools.js";
import { SERVER_INSTRUCTIONS, SERVER_VERSION } from "./serverMetadata.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = new McpServer(
    {
      name: "siyuan-mcp-server",
      version: SERVER_VERSION
    },
    {
      instructions: SERVER_INSTRUCTIONS
    }
  );

  registerTools(createToolRegistrar(server), config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("siyuan-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("siyuan-mcp-server failed:", error);
  process.exit(1);
});
