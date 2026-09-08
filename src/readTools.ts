import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { ServerConfig } from "./config.js";
import { writeCapabilities } from "./toolProfiles.js";
import { publicConfigSummary, validateConfig } from "./config.js";
import { SiyuanCli } from "./cli.js";
import { ensureLimit, validateSelectSql } from "./sql.js";
import { buildBatchKramdownArgs, buildDocumentListArgs, buildHistoryListArgs, buildHistorySearchArgs, buildRepoListArgs, buildSearchArgs } from "./argBuilders.js";
import {
  appendNumber,
  documentKramdownWithAssets,
  documentInfoWithFallback,
  normalizeDataRelativeAssetPath,
  normalizeWorkspacePath,
  outlineWithEmptyFallback,
  registerCliTool,
  requireWrite,
  runAuditedWrite,
  textResult
} from "./toolHelpers.js";

const optionalStringArray = z.array(z.string().min(1)).optional();

/**
 * Registers health, workspace, search, document, block, ref, tag, and bookmark read-only tools.
 */
export function registerReadTools(server: McpServer, config: ServerConfig, cli: SiyuanCli): void {
  server.registerTool(
    "siyuan_health",
    {
      title: "SiYuan MCP Health",
      description: "Returns server configuration summary and local validation warnings."
    },
    async () => {
      const structuredContent = {
        ok: true,
        data: { ...publicConfigSummary(config), writeCapabilities: writeCapabilities(config), accessPolicy: "mcp-only; missing capabilities are not permission to use HTTP, CLI or files", externalIsolation: "host-managed; not enforced by this server" },
        warnings: await validateConfig(config),
        command: "health"
      };
      return textResult(structuredContent);
    }
  );

  registerCliTool(server, "siyuan_workspace_info", "Returns current SiYuan workspace details.", {}, async () =>
    cli.run("workspace_info", ["workspace", "info"])
  );

  registerCliTool(server, "siyuan_workspace_list", "Lists registered SiYuan workspaces.", {}, async () =>
    cli.run("workspace_list", ["workspace", "list"])
  );

  registerCliTool(server, "siyuan_list_notebooks", "Lists SiYuan notebooks.", {}, async () =>
    cli.run("notebook_list", ["notebook", "list"])
  );

  registerCliTool(
    server,
    "siyuan_search",
    "Runs full-text search with optional pagination and filters.",
    {
      query: z.string().min(1),
      notebooks: optionalStringArray,
      paths: optionalStringArray,
      types: optionalStringArray,
      subtypes: optionalStringArray,
      method: z.number().int().optional(),
      orderBy: z.number().int().optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(20),
      groupBy: z.number().int().optional()
    },
    async (args) => cli.run("search", buildSearchArgs(args))
  );

  registerCliTool(
    server,
    "siyuan_sql_select",
    "Runs a read-only SELECT SQL query with a default LIMIT.",
    {
      sql: z.string().min(1),
      limit: z.number().int().positive().max(1000).default(100)
    },
    async ({ sql, limit }) => cli.run("sql_select", ["sql", ensureLimit(validateSelectSql(sql), limit)])
  );

  registerCliTool(
    server,
    "siyuan_get_document_kramdown",
    "Gets a full document as kramdown or markdown and extracts referenced assets.",
    {
      id: z.string().min(1),
      mode: z.enum(["kramdown", "md"]).default("kramdown")
    },
    async ({ id, mode }) => documentKramdownWithAssets(cli, id, mode)
  );

  registerCliTool(
    server,
    "siyuan_get_document",
    "Gets document content by document ID using the SiYuan CLI document get command.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("document_get", ["document", "get", "--id", id], { output: "text" })
  );

  registerCliTool(
    server,
    "siyuan_document_info",
    "Gets document metadata by document ID. Falls back to document get output if the SiYuan CLI document info command fails.",
    { id: z.string().min(1) },
    async ({ id }) => documentInfoWithFallback(cli, id)
  );

  registerCliTool(
    server,
    "siyuan_document_list",
    "Lists documents in a notebook, optionally constrained by path or human-readable path.",
    {
      notebook: z.string().min(1),
      path: z.string().optional(),
      hpath: z.string().optional()
    },
    async ({ notebook, path, hpath }) => cli.run("document_list", buildDocumentListArgs({ notebook, path, hpath }))
  );

  registerCliTool(
    server,
    "siyuan_document_search",
    "Searches documents by keyword.",
    { keyword: z.string().min(1) },
    async ({ keyword }) => cli.run("document_search", ["document", "search", keyword])
  );

  registerCliTool(
    server,
    "siyuan_get_block",
    "Gets block metadata by block ID.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("block_get", ["block", "get", "--id", id])
  );

  registerCliTool(
    server,
    "siyuan_get_block_kramdown",
    "Gets block content as kramdown or markdown.",
    {
      id: z.string().min(1),
      mode: z.enum(["kramdown", "md"]).optional()
    },
    async ({ id, mode }) => {
      const args = ["block", "kramdown", "--id", id];
      if (mode) {
        args.push("--mode", mode);
      }
      return cli.run("block_kramdown", args, { output: "text" });
    }
  );

  registerCliTool(
    server,
    "siyuan_get_block_children",
    "Gets direct child blocks for a parent block.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("block_children", ["block", "children", "--id", id])
  );

  registerCliTool(
    server,
    "siyuan_block_dom",
    "Gets block DOM tree by block ID.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("block_dom", ["block", "dom", "--id", id], { output: "text" })
  );

  registerCliTool(
    server,
    "siyuan_block_breadcrumb",
    "Gets the breadcrumb path for a block.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("block_breadcrumb", ["block", "breadcrumb", "--id", id])
  );

  registerCliTool(
    server,
    "siyuan_block_stat",
    "Gets statistics for a document or block by ID.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("block_stat", ["block", "stat", "--id", id])
  );

  registerCliTool(
    server,
    "siyuan_batch_get_blocks",
    "Gets metadata for multiple blocks. Maximum 50 IDs per call.",
    { ids: z.array(z.string().min(1)).min(1).max(50) },
    async ({ ids }) => cli.run("block_batch_get", ["block", "batch-get", "--ids", ids.join(",")])
  );

  registerCliTool(
    server,
    "siyuan_batch_get_kramdown",
    "Gets kramdown content for multiple blocks. Maximum 50 IDs per call.",
    { ids: z.array(z.string().min(1)).min(1).max(50) },
    async ({ ids }) => cli.run("block_batch_kramdown", buildBatchKramdownArgs(ids))
  );

  registerCliTool(
    server,
    "siyuan_get_outline",
    "Gets document heading outline by document ID.",
    { id: z.string().min(1) },
    async ({ id }) => outlineWithEmptyFallback(cli, id)
  );

  registerCliTool(
    server,
    "siyuan_get_attrs",
    "Gets custom attributes for a block.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("attr_get", ["attr", "get", "--id", id])
  );

  registerCliTool(
    server,
    "siyuan_batch_get_attrs",
    "Gets custom attributes for multiple blocks. Maximum 50 IDs per call.",
    { ids: z.array(z.string().min(1)).min(1).max(50) },
    async ({ ids }) => cli.run("attr_batch_get", ["attr", "batch-get", "--ids", ids.join(",")])
  );

  registerCliTool(
    server,
    "siyuan_get_backlinks",
    "Gets backlinks for a block, with optional keyword and sort.",
    {
      id: z.string().min(1),
      keyword: z.string().optional(),
      sort: z.number().int().min(0).max(7).optional()
    },
    async ({ id, keyword, sort }) => {
      const args = ["ref", "backlinks", "--id", id];
      if (keyword) {
        args.push("--keyword", keyword);
      }
      appendNumber(args, "--sort", sort);
      return cli.run("ref_backlinks", args, { output: "text" });
    }
  );

  registerCliTool(
    server,
    "siyuan_ref_mentions",
    "Gets mentions for a block, with optional keyword and sort.",
    {
      id: z.string().min(1),
      keyword: z.string().optional(),
      sort: z.number().int().min(0).max(7).optional()
    },
    async ({ id, keyword, sort }) => {
      const args = ["ref", "mentions", "--id", id];
      if (keyword) {
        args.push("--keyword", keyword);
      }
      appendNumber(args, "--sort", sort);
      return cli.run("ref_mentions", args, { output: "text" });
    }
  );

  registerCliTool(
    server,
    "siyuan_tag_list",
    "Lists or searches tags.",
    { keyword: z.string().optional() },
    async ({ keyword }) => {
      const args = ["tag", "list"];
      if (keyword) {
        args.push("--keyword", keyword);
      }
      return cli.run("tag_list", args);
    }
  );

  registerCliTool(
    server,
    "siyuan_bookmark_list",
    "Lists bookmarks.",
    {},
    async () => cli.run("bookmark_list", ["bookmark", "list"])
  );

  registerCliTool(
    server,
    "siyuan_bookmark_labels",
    "Lists bookmark labels.",
    {},
    async () => cli.run("bookmark_labels", ["bookmark", "labels"])
  );

  registerCliTool(
    server,
    "siyuan_repo_list",
    "Lists repository snapshots.",
    {
      tag: z.boolean().optional(),
      page: z.number().int().positive().optional()
    },
    async (args) => cli.run("repo_list", buildRepoListArgs(args))
  );

  registerCliTool(
    server,
    "siyuan_repo_search",
    "Searches files in repository snapshots.",
    {
      keyword: z.string().min(1),
      page: z.number().int().positive().optional()
    },
    async ({ keyword, page }) => {
      const args = ["repo", "search", keyword];
      if (page !== undefined) {
        args.push("--page", String(page));
      }
      return cli.run("repo_search", args);
    }
  );

  registerCliTool(
    server,
    "siyuan_repo_diff",
    "Compares two repository snapshots.",
    {
      left: z.string().min(1),
      right: z.string().min(1)
    },
    async ({ left, right }) => cli.run("repo_diff", ["repo", "diff", "--left", left, "--right", right])
  );

  registerCliTool(
    server,
    "siyuan_repo_file_get",
    "Reads a file from a repository snapshot by file ID.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("repo_file_get", ["repo", "file", "get", "--id", id], { output: "text" })
  );

  registerCliTool(
    server,
    "siyuan_repo_file_open",
    "Opens or previews a file from a repository snapshot by file ID.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("repo_file_open", ["repo", "file", "open", "--id", id], { output: "text" })
  );

  registerCliTool(
    server,
    "siyuan_repo_file_export",
    "Exports a file from a repository snapshot by file ID.",
    { id: z.string().min(1) },
    async ({ id }) => cli.run("repo_file_export", ["repo", "file", "export", "--id", id], { output: "text" })
  );

  registerCliTool(
    server,
    "siyuan_history_list",
    "Lists document history records.",
    {
      notebook: z.string().min(1).optional(),
      op: z.enum(["delete", "update", "create"]).optional(),
      type: z.number().int().min(0).max(4).optional(),
      page: z.number().int().positive().optional()
    },
    async (args) => cli.run("history_list", buildHistoryListArgs(args))
  );

  registerCliTool(
    server,
    "siyuan_history_search",
    "Searches document history records.",
    {
      query: z.string().min(1),
      notebook: z.string().min(1).optional(),
      op: z.enum(["delete", "update", "create"]).optional(),
      type: z.number().int().min(0).max(4).optional(),
      page: z.number().int().positive().optional()
    },
    async (args) => cli.run("history_search", buildHistorySearchArgs(args))
  );

  registerCliTool(
    server,
    "siyuan_history_get",
    "Gets historical content by history path.",
    { path: z.string().min(1) },
    async ({ path }) => cli.run("history_get", ["history", "get", "--path", path])
  );

  registerCliTool(
    server,
    "siyuan_template_search",
    "Searches templates; omit keyword to list all templates.",
    { keyword: z.string().optional() },
    async ({ keyword }) => {
      const args = ["template", "search"];
      if (keyword) {
        args.push(keyword);
      }
      return cli.run("template_search", args);
    }
  );

  registerCliTool(
    server,
    "siyuan_template_get",
    "Reads a template by workspace-relative template path.",
    { path: z.string().min(1) },
    async ({ path }) => cli.run("template_get", ["template", "get", "--path", path])
  );

  registerCliTool(
    server,
    "siyuan_template_render",
    "Renders a template preview against a block context.",
    {
      path: z.string().min(1),
      id: z.string().min(1)
    },
    async ({ path, id }) => cli.run("template_render", ["template", "render", "--path", path, "--id", id])
  );

  registerCliTool(
    server,
    "siyuan_sync_status",
    "Returns SiYuan sync status.",
    {},
    async () => cli.run("sync_status", ["sync", "status"])
  );

  registerCliTool(
    server,
    "siyuan_asset_unused",
    "Lists unused assets.",
    {},
    async () => cli.run("asset_unused", ["asset", "unused"])
  );

  registerCliTool(
    server,
    "siyuan_asset_stat",
    "Gets asset file information by data-directory-relative asset path.",
    { path: z.string().min(1) },
    async ({ path }) => cli.run("asset_stat", ["asset", "stat", "--path", normalizeDataRelativeAssetPath(path)])
  );

  registerCliTool(
    server,
    "siyuan_file_list",
    "Lists workspace directory contents by workspace-relative path.",
    { path: z.string().min(1) },
    async ({ path }) => cli.run("file_list", ["file", "list", normalizeWorkspacePath(path)], { output: "text" })
  );

  registerCliTool(
    server,
    "siyuan_file_read",
    "Reads a workspace file by workspace-relative path.",
    { path: z.string().min(1) },
    async ({ path }) => cli.run("file_read", ["file", "read", normalizeWorkspacePath(path)], { output: "text" })
  );

  registerCliTool(
    server,
    "siyuan_file_grep",
    "Searches workspace files with a regular expression.",
    {
      pattern: z.string().min(1),
      path: z.string().min(1),
      include: z.string().optional(),
      context: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(1000).optional()
    },
    async ({ pattern, path, include, context, limit }) => {
      const args = ["file", "grep", "--pattern", pattern, "--path", normalizeWorkspacePath(path)];
      if (include) {
        args.push("--include", include);
      }
      appendNumber(args, "--context", context);
      appendNumber(args, "--limit", limit);
      return cli.run("file_grep", args);
    }
  );

  registerCliTool(
    server,
    "siyuan_file_find",
    "Finds workspace files by glob pattern.",
    {
      path: z.string().min(1),
      include: z.string().optional(),
      limit: z.number().int().positive().max(1000).optional()
    },
    async ({ path, include, limit }) => {
      const args = ["file", "find", normalizeWorkspacePath(path)];
      if (include) {
        args.push("--include", include);
      }
      appendNumber(args, "--limit", limit);
      return cli.run("file_find", args);
    }
  );

  registerCliTool(
    server,
    "siyuan_file_stat",
    "Gets workspace file or directory information.",
    { path: z.string().min(1) },
    async ({ path }) => cli.run("file_stat", ["file", "stat", normalizeWorkspacePath(path)])
  );

  registerCliTool(
    server,
    "siyuan_export_md",
    "Exports a document as Markdown. Passing output writes to a target path and requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), output: z.string().optional() },
    async ({ id, output }) => exportMaybeWrite(config, cli, "export_md", output ? ["export", "md", "--id", id, "--output", output] : ["export", "md", "--id", id], { id, output }, output)
  );

  registerCliTool(
    server,
    "siyuan_export_html",
    "Exports a document as HTML. Passing output writes to a target path and requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), output: z.string().optional() },
    async ({ id, output }) => exportMaybeWrite(config, cli, "export_html", output ? ["export", "html", "--id", id, "--output", output] : ["export", "html", "--id", id], { id, output }, output)
  );

  registerCliTool(
    server,
    "siyuan_export_preview",
    "Exports document preview HTML. Passing output writes to a target path and requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), output: z.string().optional() },
    async ({ id, output }) => exportMaybeWrite(config, cli, "export_preview", output ? ["export", "preview", "--id", id, "--output", output] : ["export", "preview", "--id", id], { id, output }, output)
  );

  registerCliTool(
    server,
    "siyuan_export_sy",
    "Exports a document as .sy.zip. Passing output writes to a target path and requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), output: z.string().optional() },
    async ({ id, output }) => exportMaybeWrite(config, cli, "export_sy", output ? ["export", "sy", "--id", id, "--output", output] : ["export", "sy", "--id", id], { id, output }, output)
  );

  registerCliTool(
    server,
    "siyuan_export_md_zip",
    "Exports a document as Markdown zip. Passing output writes to a target path and requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), output: z.string().optional() },
    async ({ id, output }) => exportMaybeWrite(config, cli, "export_md_zip", output ? ["export", "md-zip", "--id", id, "--output", output] : ["export", "md-zip", "--id", id], { id, output }, output)
  );

  registerCliTool(
    server,
    "siyuan_export_data",
    "Exports full workspace data. Passing output writes to a target path and requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { output: z.string().optional() },
    async ({ output }) => exportMaybeWrite(config, cli, "export_data", output ? ["export", "data", "--output", output] : ["export", "data"], { output }, output)
  );

  registerCliTool(
    server,
    "siyuan_system_current_time",
    "Returns the SiYuan CLI current server time.",
    {},
    async () => cli.run("system_current_time", ["system", "current-time"])
  );
}

async function exportMaybeWrite(
  config: ServerConfig,
  cli: SiyuanCli,
  command: string,
  args: string[],
  input: Record<string, unknown>,
  outputPath: string | undefined
) {
  if (!outputPath) {
    return cli.run(command, args, { output: "text" });
  }

  const permission = requireWrite(config, command);
  if (permission) {
    return permission;
  }

  return runAuditedWrite(config, cli, command, args, input, false);
}
