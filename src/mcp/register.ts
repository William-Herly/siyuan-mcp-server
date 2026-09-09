import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { NormalizedResponse } from "../types.js";
import { textResult } from "./results.js";

export type ToolShape = Record<string, z.ZodType>;

/** The only server capability tool modules need. */
export interface ToolRegistrar {
  registerTool<TShape extends ToolShape>(
    name: string,
    definition: { title?: string; description?: string; inputSchema?: TShape },
    handler: (args: z.output<z.ZodObject<TShape>>) => Promise<CallToolResult>
  ): void;
}

/** Keep the SDK's schema compatibility types at the transport boundary. */
export function createToolRegistrar(server: McpServer): ToolRegistrar {
  return {
    registerTool(name, definition, handler) {
      server.registerTool(name, definition, handler as never);
    }
  };
}

/**
 * Registers one CLI-backed MCP tool and normalizes its response as text plus structured content.
 */
export function registerCliTool<TShape extends ToolShape>(
  server: ToolRegistrar,
  name: string,
  description: string,
  inputSchema: TShape,
  handler: (args: z.output<z.ZodObject<TShape>>) => Promise<NormalizedResponse>
): void {
  server.registerTool(
    name,
    {
      description,
      inputSchema: publicInputSchema(inputSchema) as TShape
    },
    async (args: z.output<z.ZodObject<TShape>>): Promise<CallToolResult> =>
      textResult(await handler(args))
  );
}

function publicInputSchema<TShape extends ToolShape>(inputSchema: TShape): ToolShape {
  const { dryRun: _dryRun, ...visibleSchema } = inputSchema;
  return visibleSchema;
}
