import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { auditWrite } from "./audit.js";
import type { ServerConfig } from "./config.js";
import { SiyuanCli } from "./cli.js";
import type { NormalizedResponse } from "./types.js";

export type ToolShape = Record<string, z.ZodType>;

/**
 * Registers one CLI-backed MCP tool and normalizes its response as text plus structured content.
 */
export function registerCliTool<TShape extends ToolShape>(
  server: McpServer,
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
    (async (args: z.output<z.ZodObject<TShape>>): Promise<CallToolResult> =>
      textResult(await handler(args))
    ) as never
  );
}

export function textResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}

export function appendNumber(target: string[], flag: string, value: number | undefined): void {
  if (value !== undefined) {
    target.push(flag, String(value));
  }
}

export function appendRepeated(target: string[], flag: string, values: string[] | undefined): void {
  for (const value of values ?? []) {
    target.push(flag, value);
  }
}

/**
 * Returns a normalized permission failure when a write tool is called in readonly mode.
 */
export function requireWrite(config: ServerConfig, command: string): NormalizedResponse | undefined {
  if (config.allowWrite || config.allowDangerous) {
    return undefined;
  }

  return {
    ok: false,
    warnings: ["Write tools require SIYUAN_MCP_ALLOW_WRITE=true."],
    command,
    data: {
      requiredPermission: "safe-write",
      currentPermission: "readonly"
    }
  };
}

/**
 * Returns a normalized permission failure for destructive tools unless dangerous mode is explicit.
 */
export function requireDangerous(config: ServerConfig, command: string): NormalizedResponse | undefined {
  if (config.allowDangerous) {
    return undefined;
  }

  return {
    ok: false,
    warnings: ["Dangerous tools require SIYUAN_MCP_ALLOW_DANGEROUS=true."],
    command,
    data: {
      requiredPermission: "dangerous",
      currentPermission: config.allowWrite ? "safe-write" : "readonly"
    }
  };
}

export function withDryRun(args: string[], dryRun: boolean): string[] {
  return dryRun ? ["--dry-run", ...args] : args;
}

export function normalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  return trimmed === "" || trimmed === "/" || trimmed === "\\" ? "." : trimmed;
}

export function normalizeDataRelativeAssetPath(path: string): string {
  return path.trim().replace(/^data[\\/]+/i, "");
}

export function normalizeCreateDocumentParentPath(path: string | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed || trimmed === "/") {
    return trimmed;
  }

  return trimmed.replace(/\.sy$/i, "");
}

export function createDocumentPathWarning(path: string | undefined, normalizedPath: string | undefined): string | undefined {
  if (!path || !normalizedPath || path === normalizedPath) {
    return undefined;
  }

  return `Normalized create-document parent path from "${path}" to "${normalizedPath}". The create tool expects a parent path, not a target .sy file path.`;
}

export function extractAssetRefs(markdown: string): string[] {
  const refs = new Set<string>();
  const assetPattern = /(?:^|[\s("'`])((?:data[\\/]+)?assets[\\/][^\s)"'`<>]+)/g;
  let match: RegExpExecArray | null;

  while ((match = assetPattern.exec(markdown)) !== null) {
    refs.add(normalizeDataRelativeAssetPath(match[1]));
  }

  return [...refs].sort();
}

export async function documentKramdownWithAssets(cli: SiyuanCli, id: string, mode: "kramdown" | "md" = "kramdown"): Promise<NormalizedResponse> {
  const args = ["block", "kramdown", "--id", id];
  if (mode) {
    args.push("--mode", mode);
  }

  const result = await cli.run("document_kramdown", args, { output: "text" });
  if (!result.ok || typeof result.data !== "string") {
    return result;
  }

  return {
    ...result,
    data: {
      id,
      mode,
      markdown: result.data,
      assets: extractAssetRefs(result.data)
    }
  };
}

/**
 * Runs a write-like command and appends a compact audit record. Dry-run output is text by design.
 */
export async function runAuditedWrite(
  config: ServerConfig,
  cli: SiyuanCli,
  command: string,
  args: string[],
  input: Record<string, unknown>,
  dryRun: boolean | undefined
): Promise<NormalizedResponse> {
  const effectiveDryRun = dryRun === true;
  const result = await cli.run(command, args, effectiveDryRun ? { output: "text" } : {});
  await auditWrite(config, command, input, effectiveDryRun, result);
  return result;
}

/**
 * Works around SiYuan CLI document-info path resolution issues by falling back to document get.
 */
export async function documentInfoWithFallback(cli: SiyuanCli, id: string): Promise<NormalizedResponse> {
  const info = await cli.run("document_info", ["document", "info", "--id", id]);
  if (info.ok) {
    return info;
  }

  const fallback = await cli.run("document_info", ["document", "get", "--id", id]);
  return {
    ...fallback,
    warnings: [
      `SiYuan CLI document info failed; returned document get fallback output instead. ${summarizeCliFailure(info)}`,
      ...fallback.warnings
    ],
    data: {
      fallback: "document_get",
      originalErrorSummary: summarizeCliFailure(info),
      document: fallback.data
    }
  };
}

export async function outlineWithEmptyFallback(cli: SiyuanCli, id: string): Promise<NormalizedResponse> {
  const result = await cli.run("outline_get", ["outline", "get", "--id", id]);
  const raw = `${result.raw ?? ""}\n${result.warnings.join("\n")}`;
  if (!result.ok && /has no headings/i.test(raw)) {
    return {
      ok: true,
      data: [],
      warnings: [],
      command: "outline_get"
    };
  }

  return result;
}

function summarizeCliFailure(result: NormalizedResponse): string {
  const text = String(result.raw || result.warnings[0] || "Unknown CLI error.");
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() || "Unknown CLI error.";
}

function publicInputSchema<TShape extends ToolShape>(inputSchema: TShape): ToolShape {
  const { dryRun: _dryRun, ...visibleSchema } = inputSchema;
  return visibleSchema;
}
