import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { ServerConfig } from "./config.js";
import { SiyuanCli } from "./cli.js";
import { normalizeDataRelativeAssetPath, registerCliTool, requireDangerous, runAuditedWrite, withDryRun } from "./toolHelpers.js";

/**
 * Registers destructive tools behind the explicit dangerous permission gate.
 */
export function registerDangerousTools(server: McpServer, config: ServerConfig, cli: SiyuanCli): void {
  const dangerous = (
    name: string,
    command: string,
    description: string,
    schema: Record<string, z.ZodType>,
    buildArgs: (args: Record<string, unknown>) => string[],
    auditedInput: (args: Record<string, unknown>) => Record<string, unknown> = (args) => args
  ) => {
    registerCliTool(server, name, description, schema, async (args) => {
      const permission = requireDangerous(config, command);
      if (permission) {
        return permission;
      }

      const dryRun = typeof args.dryRun === "boolean" ? args.dryRun : false;
      return runAuditedWrite(config, cli, command, withDryRun(buildArgs(args), dryRun), auditedInput(args), dryRun);
    });
  };

  dangerous(
    "siyuan_delete_block",
    "block_delete",
    "Deletes a block. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { id: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ id }) => ["block", "delete", "--id", String(id)]
  );

  dangerous(
    "siyuan_remove_document",
    "document_remove",
    "Removes a document. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { id: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ id }) => ["document", "remove", "--id", String(id)]
  );

  dangerous(
    "siyuan_remove_notebook",
    "notebook_remove",
    "Removes a notebook. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { id: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ id }) => ["notebook", "remove", "--id", String(id)]
  );

  dangerous(
    "siyuan_history_rollback",
    "history_rollback",
    "Rolls back a history entry. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { path: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ path }) => ["history", "rollback", "--path", String(path)]
  );

  dangerous(
    "siyuan_history_clear",
    "history_clear",
    "Clears all history. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { dryRun: z.boolean().default(true) },
    () => ["history", "clear"]
  );

  dangerous(
    "siyuan_repo_checkout",
    "repo_checkout",
    "Checks out a repository snapshot. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { id: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ id }) => ["repo", "checkout", "--id", String(id)]
  );

  dangerous(
    "siyuan_repo_purge",
    "repo_purge",
    "Purges old repository snapshots. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { dryRun: z.boolean().default(true) },
    () => ["repo", "purge"]
  );

  dangerous(
    "siyuan_repo_file_rollback",
    "repo_file_rollback",
    "Rolls back one file from a repository snapshot. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { id: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ id }) => ["repo", "file", "rollback", "--id", String(id)]
  );

  dangerous(
    "siyuan_asset_clean",
    "asset_clean",
    "Cleans unused assets. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { path: z.string().optional(), dryRun: z.boolean().default(true) },
    ({ path }) => {
      const cliArgs = ["asset", "clean"];
      if (path) {
        cliArgs.push("--path", normalizeDataRelativeAssetPath(String(path)));
      }
      return cliArgs;
    }
  );

  dangerous(
    "siyuan_database_item_remove",
    "database_item_remove",
    "Removes database rows. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { av: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(50), dryRun: z.boolean().default(true) },
    ({ av, ids }) => ["database", "item", "remove", "--av", String(av), "--ids", (ids as string[]).join(",")]
  );

  dangerous(
    "siyuan_database_key_remove",
    "database_key_remove",
    "Removes a database field. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    {
      av: z.string().min(1),
      key: z.string().min(1),
      removeRelationDest: z.boolean().optional(),
      dryRun: z.boolean().default(true)
    },
    ({ av, key, removeRelationDest }) => {
      const cliArgs = ["database", "key", "remove", "--av", String(av), "--key", String(key)];
      if (removeRelationDest) {
        cliArgs.push("--remove-relation-dest");
      }
      return cliArgs;
    }
  );

  dangerous(
    "siyuan_database_clean",
    "database_clean",
    "Cleans unused databases. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { av: z.string().optional(), dryRun: z.boolean().default(true) },
    ({ av }) => {
      const cliArgs = ["database", "clean"];
      if (av) {
        cliArgs.push("--av", String(av));
      }
      return cliArgs;
    }
  );

  dangerous(
    "siyuan_template_remove",
    "template_remove",
    "Removes a template. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { path: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ path }) => ["template", "remove", "--path", String(path)]
  );

  dangerous(
    "siyuan_file_delete",
    "file_delete",
    "Deletes a workspace file or directory. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { path: z.string().min(1), dryRun: z.boolean().default(true) },
    ({ path }) => ["file", "delete", String(path)]
  );
}
