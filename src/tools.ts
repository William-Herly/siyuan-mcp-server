import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig, ToolProfile } from "./config.js";
import { SiyuanCli } from "./cli.js";
import { registerDatabaseTools } from "./databaseTools.js";
import { registerDangerousTools } from "./dangerousTools.js";
import { registerReadTools } from "./readTools.js";
import { registerWriteTools } from "./writeTools.js";

const MINIMAL_TOOLS = new Set([
  "siyuan_health",
  "siyuan_list_notebooks",
  "siyuan_search",
  "siyuan_document_list",
  "siyuan_get_document_kramdown",
  "siyuan_get_outline",
  "siyuan_get_block_kramdown",
  "siyuan_get_block_children",
  "siyuan_batch_get_kramdown",
  "siyuan_block_breadcrumb",
  "siyuan_get_backlinks"
]);

const STANDARD_WRITE_TOOLS = [
  "siyuan_create_document",
  "siyuan_append_block",
  "siyuan_insert_block",
  "siyuan_update_block",
  "siyuan_patch_blocks",
  "siyuan_replace_document_body",
  "siyuan_append_daily_note"
];

const STANDARD_EXTRA_TOOLS = [
  "siyuan_document_info",
  "siyuan_document_search",
  "siyuan_get_block",
  "siyuan_batch_get_blocks",
  "siyuan_block_stat"
];

const STANDARD_TOOLS = new Set([...MINIMAL_TOOLS, ...STANDARD_WRITE_TOOLS, ...STANDARD_EXTRA_TOOLS]);

/**
 * Registers SiYuan MCP tools according to the configured profile.
 *
 * Profiles:
 * - minimal: smallest read-only note lookup surface
 * - standard: normal note maintenance with safe content updates
 * - full: every tool, including dangerous-gated tools
 */
export function registerTools(server: McpServer, config: ServerConfig, cli = new SiyuanCli(config)): void {
  const filteredServer = filterServerForProfile(server, config.toolProfile);

  registerReadTools(filteredServer, config, cli);
  registerDatabaseTools(filteredServer, config, cli);
  registerWriteTools(filteredServer, config, cli);

  if (config.toolProfile === "full") {
    registerDangerousTools(server, config, cli);
  }
}

function filterServerForProfile(server: McpServer, profile: ToolProfile): McpServer {
  if (profile === "full") {
    return server;
  }

  const allowedTools = profile === "standard" ? STANDARD_TOOLS : MINIMAL_TOOLS;
  return {
    registerTool(name: string, ...args: unknown[]) {
      if (allowedTools.has(name)) {
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
