import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serializeOperation } from "./writeSafety.js";
import { auditWrite } from "./audit.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { NormalizedResponse } from "./types.js";
import { textResult } from "./toolHelpers.js";
import { isToolExposed } from "./toolProfiles.js";
import type { ServerConfig } from "./config.js";
import { SiyuanCli } from "./cli.js";
import { registerDatabaseTools } from "./databaseTools.js";
import { registerDangerousTools } from "./dangerousTools.js";
import { registerReadTools } from "./readTools.js";
import { registerWriteTools } from "./writeTools.js";

/**
 * Registers SiYuan MCP tools according to the configured profile.
 *
 * Profiles:
 * - minimal: smallest read-only note lookup surface
 * - standard: normal note maintenance with safe content updates
 * - full: every tool, including dangerous-gated tools
 */
export function registerTools(server: McpServer, config: ServerConfig, cli = new SiyuanCli(config)): void {
  const filteredServer = filterServerForProfile(server, config);

  registerReadTools(filteredServer, config, cli);
  registerDatabaseTools(filteredServer, config, cli);
  registerWriteTools(filteredServer, config, cli);

  if (config.toolProfile === "full") {
    registerDangerousTools(filteredServer, config, cli);
  }
}

function filterServerForProfile(server: McpServer, config: ServerConfig): McpServer {
  return {
    registerTool(name: string, ...args: unknown[]) {
      if (isToolExposed(name, config.toolProfile)) {
        const handler = args[args.length - 1];
        if (typeof handler === "function") {
          // One queue also prevents reads from observing this server's half-finished batch.
          args[args.length - 1] = (...input: unknown[]) => serializeOperation(async () => {
            const result = await handler(...input) as CallToolResult;
            const response = result.structuredContent;
            if (response?.ok === false && response.execution === "not-started" && response.code !== "AUDIT_UNAVAILABLE") {
              try {
                await auditWrite(config, String(response.command), { ...(input[0] as Record<string, unknown>), auditPhase: "rejected" }, false, response as NormalizedResponse);
              } catch {
                return textResult({ ...response, audit: "failed", warnings: [...(response.warnings as string[] ?? []), "The rejected write could not be recorded in the audit log."] });
              }
            }
            return result;
          });
        }
        return (server.registerTool as (...registerArgs: unknown[]) => unknown)(name, ...args);
      }

      return undefined;
    }
  } as McpServer;
}

export {
  buildBatchKramdownArgs,
  buildCreateDocumentArgs,
  buildDatabaseItemAddArgs,
  buildDatabaseItemUpdateArgs,
  buildDatabaseRenderArgs,
  buildDocumentListArgs,
  buildDocumentMoveArgs,
  buildHistoryListArgs,
  buildHistorySearchArgs,
  buildInsertBlockArgs,
  buildRepoListArgs,
  buildSearchArgs,
  buildSetAttrsArgs
} from "./argBuilders.js";
export {
  createDocumentPathWarning,
  documentInfoWithFallback,
  documentKramdownWithAssets,
  extractAssetRefs,
  normalizeCreateDocumentParentPath,
  normalizeDataRelativeAssetPath,
  normalizeWorkspacePath,
  outlineWithEmptyFallback,
  withDryRun
} from "./toolHelpers.js";
export { isSingleBlockMarkdown, validateWritableMarkdown } from "./writeTools.js";
export { replaceDocumentBodyDirectly } from "./writeTools.js";
