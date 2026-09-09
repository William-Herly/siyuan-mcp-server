import { z } from "zod/v4";
import { buildDatabaseItemAddArgs, buildDatabaseItemUpdateArgs, buildDatabaseRenderArgs, withDryRun } from "../cli/args.js";
import { SiyuanCli } from "../cli/client.js";
import { ServerConfig } from "../config.js";
import type { ToolRegistrar } from "../mcp/register.js";
import { registerCliTool } from "../mcp/register.js";
import { runAuditedWrite } from "../runtime/audit.js";
import { requireWrite } from "../safety/permissions.js";

/**
 * Registers database read tools and safe-write database row/cell operations.
 */
export function registerDatabaseTools(server: ToolRegistrar, config: ServerConfig, cli: SiyuanCli): void {
  registerCliTool(
    server,
    "siyuan_database_search",
    "Searches databases by keyword.",
    { keyword: z.string().min(1) },
    async ({ keyword }) => cli.run("database_search", ["database", "search", keyword])
  );

  registerCliTool(
    server,
    "siyuan_database_get",
    "Gets database details by database ID.",
    { av: z.string().min(1) },
    async ({ av }) => cli.run("database_get", ["database", "get", "--av", av])
  );

  registerCliTool(
    server,
    "siyuan_database_render",
    "Renders a database table with optional view, query, and pagination.",
    {
      av: z.string().min(1),
      view: z.string().optional(),
      query: z.string().optional(),
      page: z.number().int().positive().default(1),
      size: z.number().int().positive().max(100).default(50)
    },
    async (args) => cli.run("database_render", buildDatabaseRenderArgs(args))
  );

  registerCliTool(
    server,
    "siyuan_database_keys",
    "Lists database fields by database ID.",
    { av: z.string().min(1) },
    async ({ av }) => cli.run("database_keys", ["database", "keys", "--av", av])
  );

  registerCliTool(
    server,
    "siyuan_database_unused",
    "Lists unused databases.",
    {},
    async () => cli.run("database_unused", ["database", "unused"])
  );

  registerCliTool(
    server,
    "siyuan_database_item_add",
    "Adds a database item. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      av: z.string().min(1),
      block: z.string().min(1).optional(),
      content: z.string().optional(),
      view: z.string().min(1).optional(),
      group: z.string().min(1).optional(),
      previous: z.string().min(1).optional(),
      detached: z.boolean().optional(),
      ignoreDefaultFill: z.boolean().optional(),
      dryRun: z.boolean().default(false)
    },
    async (args) => {
      const permission = requireWrite(config, "database_item_add");
      if (permission) {
        return permission;
      }

      const normalizedArgs = {
        ...args,
        detached: args.detached ?? !args.block
      };

      return runAuditedWrite(
        config,
        cli,
        "database_item_add",
        withDryRun(buildDatabaseItemAddArgs(normalizedArgs), normalizedArgs.dryRun),
        normalizedArgs,
        normalizedArgs.dryRun
      );
    }
  );

  registerCliTool(
    server,
    "siyuan_database_item_update",
    "Updates a database cell. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      av: z.string().min(1),
      key: z.string().min(1),
      item: z.string().min(1),
      value: z.record(z.string(), z.unknown()),
      dryRun: z.boolean().default(false)
    },
    async ({ av, key, item, value, dryRun }) => {
      const permission = requireWrite(config, "database_item_update");
      if (permission) {
        return permission;
      }

      return runAuditedWrite(
        config,
        cli,
        "database_item_update",
        withDryRun(buildDatabaseItemUpdateArgs({ av, key, item, value }), dryRun),
        { av, key, item, value, dryRun },
        dryRun
      );
    }
  );
}
