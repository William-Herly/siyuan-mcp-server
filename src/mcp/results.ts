import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    ...(structuredContent.ok === false ? { isError: true } : {}),
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}
