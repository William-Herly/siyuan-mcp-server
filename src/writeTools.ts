import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { buildCreateDocumentArgs, buildDocumentMoveArgs, buildSetAttrsArgs } from "./argBuilders.js";
import { SiyuanCli } from "./cli.js";
import type { ServerConfig } from "./config.js";
import {
  createDocumentPathWarning,
  documentKramdownWithAssets,
  extractAssetRefs,
  normalizeCreateDocumentParentPath,
  registerCliTool,
  requireWrite,
  requireDangerous,
  runAuditedWrite,
  withDryRun
} from "./toolHelpers.js";

import { BLOCK_ID, checkInsertion, normalizeMarkdown, readTargets, requireTarget, safetyError, verifyMarkdown } from "./writeSafety.js";

const patchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("append"),
    parent: z.string().min(1),
    markdown: writableMarkdownSchema()
  }),
  z.object({
    op: z.literal("insert"),
    parent: z.string().min(1),
    previous: z.string().min(1).optional(),
    markdown: writableMarkdownSchema()
  }),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    markdown: writableMarkdownSchema(
      true,
      "Exactly one SiYuan block. One top-level list item counts as one block; use insert or append for multiple sibling items or sections."
    )
  }),
  z.object({
    op: z.literal("delete"),
    id: z.string().min(1).describe("Content block ID to delete. Deleting a parent block also deletes its children.")
  })
]);

type PatchOperation = z.output<typeof patchOperationSchema>;

/**
 * Registers safe-write tools for snapshots, append/prepend/insert, document creation, updates, and attrs.
 */
export function registerWriteTools(server: McpServer, config: ServerConfig, cli: SiyuanCli): void {
  registerCliTool(
    server,
    "siyuan_create_snapshot",
    "Creates a SiYuan repo snapshot. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { memo: z.string().min(1).optional(), dryRun: z.boolean().default(false) },
    async ({ memo, dryRun }) => {
      const permission = requireWrite(config, "repo_create");
      if (permission) {
        return permission;
      }

      const args = ["repo", "create"];
      if (memo) {
        args.push("--memo", memo);
      }
      return runAuditedWrite(config, cli, "repo_create", withDryRun(args, dryRun), { memo, dryRun }, dryRun);
    }
  );

  registerCliTool(
    server,
    "siyuan_repo_tag",
    "Tags a repository snapshot. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), name: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ id, name, dryRun }) => guardedWrite(config, cli, "repo_tag", ["repo", "tag", "--id", id, "--name", name], { id, name, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_repo_untag",
    "Removes a repository snapshot tag. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { name: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ name, dryRun }) => guardedWrite(config, cli, "repo_untag", ["repo", "untag", "--name", name], { name, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_append_daily_note",
    "Appends markdown to today's daily note. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      notebook: z.string().min(1),
      markdown: writableMarkdownSchema()
    },
    async ({ notebook, markdown }) => {
      const permission = requireWrite(config, "dailynote_append");
      if (permission) {
        return permission;
      }

      const dryRun = false;
      return runAuditedWrite(
        config,
        cli,
        "dailynote_append",
        withDryRun(["dailynote", "append", "--notebook", notebook, "--data", markdown], dryRun),
        { notebook, markdown, dryRun },
        dryRun
      );
    }
  );

  registerCliTool(
    server,
    "siyuan_create_daily_note",
    "Creates today's daily note in a notebook. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      notebook: z.string().min(1),
      dryRun: z.boolean().default(false)
    },
    async ({ notebook, dryRun }) => {
      const permission = requireWrite(config, "dailynote_create");
      if (permission) {
        return permission;
      }

      return runAuditedWrite(
        config,
        cli,
        "dailynote_create",
        withDryRun(["dailynote", "create", "--notebook", notebook], dryRun),
        { notebook, dryRun },
        dryRun
      );
    }
  );

  registerCliTool(
    server,
    "siyuan_prepend_daily_note",
    "Prepends markdown to today's daily note. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      notebook: z.string().min(1),
      markdown: writableMarkdownSchema(),
      dryRun: z.boolean().default(false)
    },
    async ({ notebook, markdown, dryRun }) => {
      const permission = requireWrite(config, "dailynote_prepend");
      if (permission) {
        return permission;
      }

      return runAuditedWrite(
        config,
        cli,
        "dailynote_prepend",
        withDryRun(["dailynote", "prepend", "--notebook", notebook, "--data", markdown], dryRun),
        { notebook, markdown, dryRun },
        dryRun
      );
    }
  );

  registerCliTool(
    server,
    "siyuan_append_block",
    "Appends markdown under a parent block. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      parent: z.string().min(1),
      markdown: writableMarkdownSchema()
    },
    async ({ parent, markdown }) => writeBlockChild(config, cli, "block_append", "append", parent, markdown, false)
  );

  registerCliTool(
    server,
    "siyuan_prepend_block",
    "Prepends markdown under a parent block. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      parent: z.string().min(1),
      markdown: writableMarkdownSchema(),
      dryRun: z.boolean().default(false)
    },
    async ({ parent, markdown, dryRun }) => writeBlockChild(config, cli, "block_prepend", "prepend", parent, markdown, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_create_document",
    "Creates a document. Requires SIYUAN_MCP_ALLOW_WRITE=true. Use parentPath only for an internal SiYuan parent path; do not pass human-readable paths.",
    {
      notebook: z.string().min(1).describe("Notebook ID."),
      title: z.string().min(1).describe("New document title."),
      path: z.string().optional().describe("Legacy internal parent path. Prefer parentPath."),
      parentPath: z.string().optional().describe("Internal SiYuan parent path, such as /20251202114556-abcdefg. Do not use a human-readable path."),
      markdown: writableMarkdownSchema(
        false,
        "Initial Markdown body only; put the document title in title instead of repeating it here."
      ).optional()
    },
    async ({ notebook, title, path, parentPath, markdown }) => {
      const permission = requireWrite(config, "document_create");
      if (permission) {
        return permission;
      }

      const dryRun = false;
      const resolvedPath = normalizeCreateDocumentParentPath(parentPath ?? path);
      const warning = createDocumentPathWarning(parentPath ?? path, resolvedPath);
      if (path && parentPath) {
        return {
          ok: false,
          warnings: ["Pass only one of path or parentPath. parentPath is preferred; path is kept for backward compatibility."],
          command: "document_create"
        };
      }

      if (path && /\.sy(?:[\\/]|$)/i.test(path.trim()) && !/\.sy$/i.test(path.trim())) {
        return {
          ok: false,
          warnings: [
            "create_document path must identify the parent document/folder, not the target document file. Pass parentPath plus title instead."
          ],
          command: "document_create",
          data: { path, title }
        };
      }

      const input = { notebook, title, path, parentPath, resolvedPath, markdown, dryRun };
      return runAuditedWrite(
        config,
        cli,
        "document_create",
        withDryRun(buildCreateDocumentArgs({ notebook, title, path: resolvedPath, markdown }), dryRun),
        input,
        dryRun
      ).then((result) => ({
        ...result,
        warnings: warning ? [warning, ...result.warnings] : result.warnings
      }));
    }
  );

  registerCliTool(
    server,
    "siyuan_rename_document",
    "Changes only a document title through the dedicated rename command. Never use block update to rename. Verifies title metadata without reading the body. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      title: z.string().min(1),
      dryRun: z.boolean().default(false)
    },
    async ({ id, title, dryRun }) => {
      const permission = requireWrite(config, "document_rename");
      if (permission) return permission;
      const targets = await readTargets(cli, [id], "document_rename");
      if (!(targets instanceof Map)) return targets;
      const invalid = requireTarget(targets.get(id)!, "document", "document_rename");
      if (invalid) return invalid;
      const result = await guardedWrite(config, cli, "document_rename", ["document", "rename", "--id", id, "--title", title], { id, title, dryRun }, dryRun);
      if (!result.ok || dryRun) return result;
      const check = await cli.run("document_rename_verify", ["block", "get", "--id", id]);
      const value = check.data as { id?: string; ial?: { title?: string } } | undefined;
      const passed = check.ok && value?.id === id && value.ial?.title === title;
      return { ...result, ok: passed, verification: passed ? "passed" : "unknown",
        ...(passed ? {} : { code: "VERIFICATION_FAILED" }),
        data: { id, title, requiresRefresh: !passed },
        warnings: [...result.warnings, ...(passed ? [] : ["Rename ran, but the title could not be verified. Do not retry blindly."])] };
    }
  );

  registerCliTool(
    server,
    "siyuan_reorganize_document",
    "Creates a reorganized copy of a source document after reading full kramdown and checking asset references. Requires SIYUAN_MCP_ALLOW_WRITE=true. Use parentPath only for an internal SiYuan parent path; do not pass human-readable paths.",
    {
      sourceId: z.string().min(1).describe("Source document ID."),
      notebook: z.string().min(1).describe("Target notebook ID."),
      title: z.string().min(1).describe("New document title."),
      markdown: writableMarkdownSchema(
        true,
        "Reorganized Markdown body only; put the document title in title instead of repeating it here."
      ),
      parentPath: z.string().optional().describe("Internal SiYuan parent path, such as /20251202114556-abcdefg. Do not use a human-readable path."),
      createSnapshot: z.boolean().default(true),
      dryRun: z.boolean().default(false)
    },
    async ({ sourceId, notebook, title, markdown, parentPath, createSnapshot, dryRun }) => {
      const permission = requireWrite(config, "document_reorganize");
      if (permission) {
        return permission;
      }

      const source = await documentKramdownWithAssets(cli, sourceId, "kramdown");
      if (!source.ok) {
        return {
          ...source,
          command: "document_reorganize"
        };
      }

      const sourceAssets = assetList(source.data, "assets");
      const targetAssets = extractAssetRefs(markdown);
      const missingAssets = sourceAssets.filter((asset) => !targetAssets.includes(asset));
      const warnings = missingAssets.length
        ? [`Reorganized markdown does not reference ${missingAssets.length} source asset(s): ${missingAssets.join(", ")}`]
        : [];

      const snapshot = createSnapshot
        ? await runAuditedWrite(
            config,
            cli,
            "repo_create",
            withDryRun(["repo", "create", "--memo", `Before reorganizing ${sourceId} into ${title}`], dryRun),
            { sourceId, title, dryRun, reason: "document_reorganize" },
            dryRun
          )
        : undefined;

      if (snapshot && !snapshot.ok) {
        return {
          ...snapshot,
          command: "document_reorganize",
          warnings: [...warnings, ...snapshot.warnings],
          data: {
            sourceId,
            sourceAssets,
            targetAssets,
            missingAssets,
            snapshot
          }
        };
      }

      const resolvedPath = normalizeCreateDocumentParentPath(parentPath);
      const pathWarning = createDocumentPathWarning(parentPath, resolvedPath);
      const created = await runAuditedWrite(
        config,
        cli,
        "document_create",
        withDryRun(buildCreateDocumentArgs({ notebook, title, path: resolvedPath, markdown }), dryRun),
        { sourceId, notebook, title, parentPath, resolvedPath, markdown, dryRun, reason: "document_reorganize" },
        dryRun
      );

      return {
        ok: created.ok,
        command: "document_reorganize",
        warnings: [...warnings, ...(pathWarning ? [pathWarning] : []), ...created.warnings],
        data: {
          sourceId,
          sourceAssets,
          targetAssets,
          missingAssets,
          snapshot,
          created: created.data,
          createdRaw: created.raw
        },
        raw: created.raw
      };
    }
  );

  registerCliTool(
    server,
    "siyuan_move_document",
    "Moves a document to another notebook/path. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      notebook: z.string().min(1),
      path: z.string().optional(),
      hpath: z.string().optional(),
      dryRun: z.boolean().default(false)
    },
    async ({ id, notebook, path, hpath, dryRun }) =>
      guardedWrite(
        config,
        cli,
        "document_move",
        buildDocumentMoveArgs({ id, notebook, path, hpath }),
        { id, notebook, path, hpath, dryRun },
        dryRun
      )
  );

  registerCliTool(
    server,
    "siyuan_duplicate_document",
    "Duplicates a document. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      dryRun: z.boolean().default(false)
    },
    async ({ id, dryRun }) => guardedWrite(config, cli, "document_duplicate", ["document", "duplicate", "--id", id], { id, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_insert_block",
    "Inserts markdown under a parent block, optionally after a previous sibling. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      parent: z.string().min(1),
      markdown: writableMarkdownSchema(),
      previous: z.string().min(1).optional()
    },
    async ({ parent, markdown, previous }) => {
      const permission = requireWrite(config, "block_insert");
      if (permission) {
        return permission;
      }
      const content = blockContentArgs(markdown);
      if ("error" in content) {
        return content.error;
      }

      const targets = await readTargets(cli, [parent, ...(previous ? [previous] : [])], "block_insert");
      if (!(targets instanceof Map)) return targets;
      const invalidTarget = checkInsertion(targets, parent, previous, "block_insert");
      if (invalidTarget) return invalidTarget;
      return runAuditedWrite(
        config,
        cli,
        "block_insert",
        ["block", "insert", "--parent", parent, ...content.args, ...(previous ? ["--previous", previous] : [])],
        { parent, markdown, previous, dryRun: false },
        false
      );
    }
  );

  registerCliTool(
    server,
    "siyuan_update_block",
    "Updates exactly one existing SiYuan content block. One top-level list item counts as one block; use insert or append for multiple sibling items or sections. Document roots are rejected. No automatic backup or rollback. Verifies only the target block; use the returned ID on success. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      markdown: writableMarkdownSchema(
        true,
        "Exactly one SiYuan block. Do not pass multiple sibling list items, a heading plus body text, or a complete section."
      )
    },
    async ({ id, markdown }) => updateBlockDirectly(config, cli, id, markdown, false)
  );

  registerCliTool(
    server,
    "siyuan_patch_blocks",
    "Applies 1-20 operations within documentId. Prechecks target types, scope and conflicting ancestor/target dependencies before writing. Update/delete can remove existing content and descendants. No automatic backup or rollback. Returns final verification and partial progress; do not repeat verified writes or blindly retry a failed batch. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      documentId: z.string().min(1).describe("Document containing every operation target."),
      operations: z.array(patchOperationSchema).min(1).max(20).describe("Ordered operations; maximum 20 per call."),
      dryRun: z.boolean().default(false)
    },
    async ({ documentId, operations, dryRun }) => patchBlocksDirectly(config, cli, documentId, operations, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_replace_document_body",
    "Replaces the complete document body, preserving its document ID. Before calling, tell the user which document will be replaced, show the proposed complete content, and explain that existing body blocks will be removed with no automatic backup or rollback. You MUST ask the user in chat and WAIT for their explicit approval of this target and replacement content before calling. Silence, broad editing permission, or your own judgment is not approval. If the target or proposed content changes, ask again. This is an agent instruction; the server does not verify chat consent. Never substitute block edits to bypass confirmation. Requires write permission; dangerous permission never bypasses confirmation. Verifies the body once internally.",
    {
      id: z.string().min(1).describe("Existing SiYuan document ID."),
      markdown: writableMarkdownSchema(false, "Complete replacement Markdown body. Pass an empty string to clear the body.")
    },
    async ({ id, markdown }) => replaceDocumentBodyDirectly(config, cli, id, markdown)
  );

  registerCliTool(
    server,
    "siyuan_set_attrs",
    "Sets block attributes except reserved identity/title/timestamp fields. Use rename_document for document titles. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      attrs: z.record(z.string().min(1), z.string()),
      dryRun: z.boolean().default(false)
    },
    async ({ id, attrs, dryRun }) => {
      const permission = requireWrite(config, "attr_set");
      if (permission) {
        return permission;
      }

      if (Object.entries(attrs).length === 0) {
        return {
          ok: false,
          warnings: ["attrs must contain at least one key-value pair."],
          command: "attr_set"
        };
      }

      if (Object.keys(attrs).some((key) => ["id", "title", "type", "updated", "created"].includes(key.toLowerCase()))) {
        return safetyError("attr_set", "RESERVED_ATTRIBUTE", "Identity, title and timestamp attributes cannot be changed through this tool. Use the dedicated document tool.");
      }

      return runAuditedWrite(
        config,
        cli,
        "attr_set",
        withDryRun(buildSetAttrsArgs({ id, attrs }), dryRun),
        { id, attrs, dryRun },
        dryRun
      );
    }
  );

  registerCliTool(
    server,
    "siyuan_create_notebook",
    "Creates a notebook. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      name: z.string().min(1),
      dryRun: z.boolean().default(false)
    },
    async ({ name, dryRun }) => guardedWrite(config, cli, "notebook_create", ["notebook", "create", "--name", name], { name, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_rename_notebook",
    "Renames a notebook. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      name: z.string().min(1),
      dryRun: z.boolean().default(false)
    },
    async ({ id, name, dryRun }) => guardedWrite(config, cli, "notebook_rename", ["notebook", "rename", "--id", id, "--name", name], { id, name, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_open_notebook",
    "Opens a notebook. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      dryRun: z.boolean().default(false)
    },
    async ({ id, dryRun }) => guardedWrite(config, cli, "notebook_open", ["notebook", "open", "--id", id], { id, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_close_notebook",
    "Closes a notebook. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      id: z.string().min(1),
      dryRun: z.boolean().default(false)
    },
    async ({ id, dryRun }) => guardedWrite(config, cli, "notebook_close", ["notebook", "close", "--id", id], { id, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_set_notebook_icon",
    "Sets a notebook icon. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), icon: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ id, icon, dryRun }) => guardedWrite(config, cli, "notebook_set_icon", ["notebook", "set-icon", "--id", id, "--icon", icon], { id, icon, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_random_notebook_icon",
    "Sets a random notebook icon. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1).optional(), dryRun: z.boolean().default(false) },
    async ({ id, dryRun }) => {
      const args = ["notebook", "random-icon"];
      if (id) {
        args.push("--id", id);
      }
      return guardedWrite(config, cli, "notebook_random_icon", args, { id, dryRun }, dryRun);
    }
  );

  registerCliTool(
    server,
    "siyuan_move_block",
    "Moves a block under another parent, optionally after a previous sibling. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), parent: z.string().min(1), previous: z.string().min(1).optional(), dryRun: z.boolean().default(false) },
    async ({ id, parent, previous, dryRun }) => {
      const args = ["block", "move", "--id", id, "--parent", parent];
      if (previous) {
        args.push("--previous", previous);
      }
      return guardedWrite(config, cli, "block_move", args, { id, parent, previous, dryRun }, dryRun);
    }
  );

  registerCliTool(
    server,
    "siyuan_ref_refresh",
    "Refreshes backlink indexes for a block. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ id, dryRun }) => guardedWrite(config, cli, "ref_refresh", ["ref", "refresh", "--id", id], { id, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_tag_rename",
    "Renames a tag. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { old: z.string().min(1), new: z.string().min(1), dryRun: z.boolean().default(false) },
    async (args) => guardedWrite(config, cli, "tag_rename", ["tag", "rename", "--old", args.old, "--new", args.new], args, args.dryRun)
  );

  registerCliTool(
    server,
    "siyuan_tag_remove",
    "Removes a tag label. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { label: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ label, dryRun }) => guardedWrite(config, cli, "tag_remove", ["tag", "remove", "--label", label], { label, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_bookmark_rename",
    "Renames a bookmark label. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { old: z.string().min(1), new: z.string().min(1), dryRun: z.boolean().default(false) },
    async (args) => guardedWrite(config, cli, "bookmark_rename", ["bookmark", "rename", "--old", args.old, "--new", args.new], args, args.dryRun)
  );

  registerCliTool(
    server,
    "siyuan_bookmark_remove",
    "Removes a bookmark label. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { label: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ label, dryRun }) => guardedWrite(config, cli, "bookmark_remove", ["bookmark", "remove", "--label", label], { label, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_database_key_add",
    "Adds a database field. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      av: z.string().min(1),
      name: z.string().min(1),
      type: z.string().min(1),
      icon: z.string().optional(),
      prev: z.string().optional(),
      dryRun: z.boolean().default(false)
    },
    async ({ av, name, type, icon, prev, dryRun }) => {
      const args = ["database", "key", "add", "--av", av, "--name", name, "--type", type];
      if (icon) {
        args.push("--icon", icon);
      }
      if (prev) {
        args.push("--prev", prev);
      }
      return guardedWrite(config, cli, "database_key_add", args, { av, name, type, icon, prev, dryRun }, dryRun);
    }
  );

  registerCliTool(
    server,
    "siyuan_template_create",
    "Creates a template from markdown data. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { name: z.string().min(1), data: writableMarkdownSchema(), overwrite: z.boolean().optional(), dryRun: z.boolean().default(false) },
    async ({ name, data, overwrite, dryRun }) => {
      const args = ["template", "create", "--name", name, "--data", data];
      if (overwrite) {
        args.push("--overwrite");
      }
      return guardedWrite(config, cli, "template_create", args, { name, data, overwrite, dryRun }, dryRun);
    }
  );

  registerCliTool(
    server,
    "siyuan_template_save_as",
    "Saves a document as a template. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), name: z.string().min(1), overwrite: z.boolean().optional(), dryRun: z.boolean().default(false) },
    async ({ id, name, overwrite, dryRun }) => {
      const args = ["template", "save-as", "--id", id, "--name", name];
      if (overwrite) {
        args.push("--overwrite");
      }
      return guardedWrite(config, cli, "template_save_as", args, { id, name, overwrite, dryRun }, dryRun);
    }
  );

  registerCliTool(
    server,
    "siyuan_asset_upload",
    "Uploads asset files to a document. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), files: z.array(z.string().min(1)).min(1).max(20), dryRun: z.boolean().default(false) },
    async ({ id, files, dryRun }) => {
      const args = ["asset", "upload", "--id", id];
      for (const file of files) {
        args.push("--file", file);
      }
      return guardedWrite(config, cli, "asset_upload", args, { id, files, dryRun }, dryRun);
    }
  );

  registerCliTool(
    server,
    "siyuan_import_md",
    "Imports Markdown file or directory. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { file: z.string().min(1), notebook: z.string().min(1), path: z.string().optional(), hpath: z.string().optional(), dryRun: z.boolean().default(false) },
    async (args) => guardedWrite(config, cli, "import_md", buildImportArgs("md", args), args, args.dryRun)
  );

  registerCliTool(
    server,
    "siyuan_import_sy",
    "Imports .sy.zip file. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { file: z.string().min(1), notebook: z.string().min(1), path: z.string().optional(), hpath: z.string().optional(), dryRun: z.boolean().default(false) },
    async (args) => guardedWrite(config, cli, "import_sy", buildImportArgs("sy", args), args, args.dryRun)
  );

  registerCliTool(
    server,
    "siyuan_import_data",
    "Imports a full data backup. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { file: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ file, dryRun }) => guardedWrite(config, cli, "import_data", ["import", "data", "--file", file], { file, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_file_write",
    "Writes a workspace file from a local source file. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { path: z.string().min(1), file: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ path, file, dryRun }) => guardedWrite(config, cli, "file_write", ["file", "write", path, "--file", file], { path, file, dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_file_rename",
    "Renames or moves a workspace file. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { old: z.string().min(1), new: z.string().min(1), dryRun: z.boolean().default(false) },
    async (args) => guardedWrite(config, cli, "file_rename", ["file", "rename", args.old, args.new], args, args.dryRun)
  );

  registerCliTool(
    server,
    "siyuan_file_copy",
    "Copies a workspace file or directory. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { src: z.string().min(1), dst: z.string().min(1), dryRun: z.boolean().default(false) },
    async (args) => guardedWrite(config, cli, "file_copy", ["file", "copy", args.src, args.dst], args, args.dryRun)
  );

  registerCliTool(
    server,
    "siyuan_sync_push",
    "Pushes sync data. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { dryRun: z.boolean().default(false) },
    async ({ dryRun }) => guardedWrite(config, cli, "sync_push", ["sync", "push"], { dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_sync_pull",
    "Pulls sync data. Requires SIYUAN_MCP_ALLOW_DANGEROUS=true.",
    { dryRun: z.boolean().default(false) },
    async ({ dryRun }) => guardedWrite(config, cli, "sync_pull", ["sync", "pull"], { dryRun }, dryRun)
  );

  registerCliTool(
    server,
    "siyuan_export_docx",
    "Exports a document as docx to an output path. Requires SIYUAN_MCP_ALLOW_WRITE=true because it writes a file.",
    { id: z.string().min(1), output: z.string().min(1), dryRun: z.boolean().default(false) },
    async ({ id, output, dryRun }) => guardedWrite(config, cli, "export_docx", ["export", "docx", "--id", id, "--output", output], { id, output, dryRun }, dryRun)
  );
}

export async function replaceDocumentBodyDirectly(config: ServerConfig, cli: SiyuanCli, id: string, markdown: string) {
  const command = "document_replace_body";
  const permission = requireWrite(config, command);
  if (permission) return permission;
  const targets = await readTargets(cli, [id], command);
  if (!(targets instanceof Map)) return targets;
  const invalid = requireTarget(targets.get(id)!, "document", command);
  if (invalid) return invalid;
  const issues = validateWritableMarkdown(markdown);
  if (issues.length) return safetyError(command, "INVALID_MARKDOWN", issues.join(" "));
  const result = await replaceDocumentBodySteps(config, cli, id, markdown);
  const verified = await verifyMarkdown(cli, id, markdown, result);
  return verified;
}

async function replaceDocumentBodySteps(
  config: ServerConfig,
  cli: SiyuanCli,
  id: string,
  markdown: string
) {
  const children = await cli.run("block_children", ["block", "children", "--id", id]);
  if (!children.ok) {
    return {
      ...children,
      execution: "not-started",
      command: "document_replace_body",
      warnings: ["Could not enumerate the document's initial top-level blocks. No changes were applied.", ...children.warnings]
    };
  }

  const childIds = directChildIds(children.data);
  if (!childIds || childIds.includes(id) || new Set(childIds).size !== childIds.length) {
    return {
      ok: false,
      execution: "not-started",
      command: "document_replace_body",
      warnings: ["The block children response had an unexpected shape. No changes were applied."],
      data: { documentId: id, deletedCount: 0, appended: false }
    };
  }

  const deletedIds: string[] = [];
  // Delete from the end so heading-owned descendants are removed before their heading.
  // The ID set remains fixed; the tool never re-enumerates newly exposed blocks.
  for (const childId of [...childIds].reverse()) {
    const deleted = await runAuditedWrite(
      config,
      cli,
      "block_delete",
      ["block", "delete", "--id", childId],
      { id: childId, documentId: id, reason: "document_replace_body" },
      false
    );
    if (!deleted.ok) {
      return {
        ok: false,
        code: "PARTIAL_FAILURE",
        execution: deleted.execution === "unknown" ? "unknown" : deletedIds.length ? "partial" : "not-started",
        retryable: false,
        command: "document_replace_body",
        warnings: [
          `Failed after deleting ${deletedIds.length} of ${childIds.length} initial top-level blocks. The operation is non-transactional.`,
          ...deleted.warnings
        ],
        data: {
          documentId: id,
          initialTopLevelCount: childIds.length,
          deletedCount: deletedIds.length,
          deletedIds,
          failedId: childId,
          appended: false,
          requiresRefresh: deletedIds.length > 0 || deleted.execution === "unknown"
        },
        raw: deleted.raw
      };
    }
    deletedIds.push(childId);
  }

  const submittedHash = createHash("sha256").update(markdown, "utf8").digest("hex");
  if (markdown.length === 0) {
    return {
      ok: true,
      command: "document_replace_body",
      warnings: [],
      data: {
        documentId: id,
        initialTopLevelCount: childIds.length,
        deletedCount: deletedIds.length,
        appended: false,
        submittedHash,
        requiresRefresh: childIds.length > 0
      }
    };
  }

  const placeholderLookup = await cli.run("block_children", ["block", "children", "--id", id]);
  const placeholderId = placeholderLookup.ok ? singleEmptyParagraphId(placeholderLookup.data) : undefined;
  const placeholderItems = placeholderLookup.ok ? directChildItems(placeholderLookup.data) : undefined;
  const placeholderLookupComplete =
    placeholderLookup.ok && (placeholderItems?.length === 0 || placeholderId !== undefined);
  const placeholderWarnings = placeholderLookupComplete
    ? []
    : [
        placeholderLookup.ok
          ? "The replacement body will be written, but SiYuan's generated empty placeholder could not be identified uniquely and may remain."
          : "The replacement body will be written, but the generated empty placeholder could not be enumerated and may remain."
      ];

  const appended = await runAuditedWrite(
    config,
    cli,
    "block_append",
    ["block", "append", "--parent", id, "--data", markdown],
    {
      documentId: id,
      markdown,
      reason: "document_replace_body"
    },
    false
  );
  if (!appended.ok) {
    return {
      ok: false,
      code: "PARTIAL_FAILURE",
      execution: appended.execution === "unknown" ? "unknown" : "partial",
      retryable: false,
      command: "document_replace_body",
      warnings: [
        `The ${deletedIds.length} initial top-level blocks were deleted, but appending the replacement body failed. The operation is non-transactional.`,
        ...placeholderWarnings,
        ...appended.warnings
      ],
      data: {
        documentId: id,
        initialTopLevelCount: childIds.length,
        deletedCount: deletedIds.length,
        deletedIds,
        appended: false,
        submittedHash,
        requiresRefresh: true
      },
      raw: appended.raw
    };
  }

  let placeholderCleanupComplete = placeholderLookupComplete;
  const cleanupWarnings = [...placeholderWarnings];
  if (placeholderId) {
    const cleaned = await runAuditedWrite(
      config,
      cli,
      "block_delete",
      ["block", "delete", "--id", placeholderId],
      { documentId: id, reason: "document_replace_body_placeholder_cleanup" },
      false
    );
    placeholderCleanupComplete = cleaned.ok;
    if (!cleaned.ok) {
      cleanupWarnings.push(
        "The replacement body was written successfully, but SiYuan's generated empty placeholder could not be removed.",
        ...cleaned.warnings
      );
    }
  }

  return {
    ok: true,
    command: "document_replace_body",
    warnings: cleanupWarnings,
    data: {
      documentId: id,
      initialTopLevelCount: childIds.length,
      deletedCount: deletedIds.length,
      appended: true,
      appendResult: appended.data,
      placeholderCleanupComplete,
      submittedHash,
      requiresRefresh: true
    }
  };
}

function directChildIds(data: unknown): string[] | undefined {
  const items = directChildItems(data);
  if (!items) {
    return undefined;
  }

  const ids = items.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    if (typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).id === "string") {
      return (item as Record<string, unknown>).id as string;
    }
    return undefined;
  });

  return ids.every((item): item is string => typeof item === "string" && BLOCK_ID.test(item)) ? ids : undefined;
}

function directChildItems(data: unknown): unknown[] | undefined {
  if (Array.isArray(data)) {
    return data;
  }
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  for (const key of ["children", "blocks", "data"]) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }

  return directChildItems(record.data);
}

function singleEmptyParagraphId(data: unknown): string | undefined {
  const items = directChildItems(data);
  if (!items || items.length !== 1) {
    return undefined;
  }

  const item = items[0];
  if (typeof item !== "object" || item === null) {
    return undefined;
  }

  const record = item as Record<string, unknown>;
  return typeof record.id === "string" && BLOCK_ID.test(record.id) && record.type === "p" && record.content === "" && record.markdown === ""
    ? record.id
    : undefined;
}

async function patchBlocksDirectly(config: ServerConfig, cli: SiyuanCli, documentId: string, operations: PatchOperation[], dryRun: boolean) {
  const command = "block_patch";
  const permission = requireWrite(config, command);
  if (permission) return permission;
  const prepared = operations.map((operation, index) => ({ index, operation, built: buildPatchOperationArgs(operation) }));
  const invalid = prepared.find((item) => "error" in item.built);
  if (invalid && "error" in invalid.built) return { ...invalid.built.error, execution: "not-started", data: { failedIndex: invalid.index, applied: [] } };
  const targetIds = operations.flatMap((op) => "id" in op ? [op.id] : [op.parent, ...(op.op === "insert" && op.previous ? [op.previous] : [])]);
  const targets = await readTargets(cli, [documentId, ...targetIds], command, documentId);
  if (!(targets instanceof Map)) return targets;
  const invalidDocument = requireTarget(targets.get(documentId)!, "document", command);
  if (invalidDocument) return invalidDocument;
  const destructive = operations.filter((op) => op.op === "update" || op.op === "delete");
  for (const op of operations) {
    if ("id" in op) {
      const invalidTarget = requireTarget(targets.get(op.id)!, "content", command);
      if (invalidTarget) return invalidTarget;
    } else {
      const invalidTarget = checkInsertion(targets, op.parent, op.op === "insert" ? op.previous : undefined, command);
      if (invalidTarget) return invalidTarget;
    }
  }
  // Reject dependencies on any destructive target, in either order, before the first write.
  for (const op of destructive) {
    const duplicate = destructive.filter((item) => item.id === op.id).length > 1;
    if (duplicate) return safetyError(command, "CONFLICTING_OPERATIONS", "A block cannot be updated/deleted twice in one batch.");
    for (const other of operations) {
      if (other === op) continue;
      const refs = "id" in other ? [other.id] : [other.parent, ...(other.op === "insert" && other.previous ? [other.previous] : [])];
      for (const ref of refs) {
        let current = ref;
        const visited = new Set<string>();
        while (current && current !== documentId) {
          if (current === op.id || visited.has(current)) return safetyError(command, "CONFLICTING_OPERATIONS", "A batch cannot depend on a block/subtree that it updates or deletes. Split the dependent work and use fresh target IDs.");
          visited.add(current);
          const ancestor = targets.get(current);
          if (!ancestor) return safetyError(command, "TARGET_LOOKUP_FAILED", "Could not verify the target ancestry.");
          current = ancestor.parent_id;
        }
      }
    }
    // Heading updates can affect section ownership beyond parent_id relationships.
    if (targets.get(op.id)!.type === "h" && operations.length > 1) return safetyError(command, "CONFLICTING_OPERATIONS", "Edit or delete a heading in a separate call before composing changes to its section.");
  }
  const applied: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  for (const { index, operation, built } of prepared) {
    if ("error" in built) throw new Error("Invalid prepared operation");
    const result = await runAuditedWrite(config, cli, built.command, withDryRun(built.args, dryRun), { operation, index, documentId, dryRun }, dryRun);
    warnings.push(...result.warnings);
    if (!result.ok) return { ok: false, command, code: "PARTIAL_FAILURE", execution: result.execution === "unknown" ? "unknown" : applied.length ? "partial" : "not-started", retryable: false, warnings, data: { applied, failed: { index, op: operation.op, ...result }, requiresRefresh: true } };
    applied.push({ index, op: operation.op, id: "id" in operation ? operation.id : undefined, result: result.data });
  }
  let verified = true;
  if (destructive.length) {
    const remaining = await readTargets(cli, destructive.map((op) => op.id), command, undefined, true);
    verified = remaining instanceof Map && destructive.every((op) => op.op === "delete"
      ? !remaining.has(op.id)
      : remaining.has(op.id) && normalizeMarkdown(remaining.get(op.id)!.markdown) === normalizeMarkdown(op.markdown));
  }
  return { ok: verified, command, execution: "applied", verification: destructive.length ? verified ? "passed" : "unknown" : "not-required",
    ...(verified ? {} : { code: "VERIFICATION_FAILED", retryable: false }),
    warnings: [...warnings, ...(verified ? [] : ["The batch ran, but final targets could not be verified. Inspect the affected scope; do not repeat the batch."])],
    data: { documentId, applied, appliedCount: applied.length, requiresRefresh: !verified } };
}

function buildPatchOperationArgs(operation: PatchOperation):
  | { command: string; args: string[] }
  | { error: { ok: false; warnings: string[]; command: string } } {
  if (operation.op === "delete") {
    return {
      command: "block_delete",
      args: ["block", "delete", "--id", operation.id]
    };
  }

  const content = blockContentArgs(operation.markdown);
  if ("error" in content) {
    return content;
  }

  if (operation.op === "append") {
    return {
      command: "block_append",
      args: ["block", "append", "--parent", operation.parent, ...content.args]
    };
  }

  if (operation.op === "insert") {
    return {
      command: "block_insert",
      args: ["block", "insert", "--parent", operation.parent, ...content.args, ...(operation.previous ? ["--previous", operation.previous] : [])]
    };
  }

  if (!isSingleBlockMarkdown(operation.markdown)) {
    return {
      error: {
        ok: false,
        warnings: [
          "update operations only support one Markdown block. Use insert/append operations for multi-block content."
        ],
        command: "block_patch"
      }
    };
  }

  return {
    command: "block_update",
    args: ["block", "update", "--id", operation.id, ...content.args]
  };
}

function buildImportArgs(
  kind: "md" | "sy",
  args: { file: string; notebook: string; path?: string; hpath?: string }
): string[] {
  const cliArgs = ["import", kind, "--file", args.file, "--notebook", args.notebook];
  if (args.path) {
    cliArgs.push("--path", args.path);
  }
  if (args.hpath) {
    cliArgs.push("--hpath", args.hpath);
  }
  return cliArgs;
}

async function guardedWrite(
  config: ServerConfig,
  cli: SiyuanCli,
  command: string,
  args: string[],
  input: Record<string, unknown>,
  dryRun: boolean
) {
  const permission = ["file_write", "file_rename", "file_copy", "import_sy", "import_data", "sync_pull"].includes(command)
    ? requireDangerous(config, command) : requireWrite(config, command);
  if (permission) {
    return permission;
  }

  return runAuditedWrite(config, cli, command, withDryRun(args, dryRun), input, dryRun);
}

async function writeBlockChild(
  config: ServerConfig,
  cli: SiyuanCli,
  command: string,
  subcommand: "append" | "prepend",
  parent: string,
  markdown: string,
  dryRun: boolean
) {
  const permission = requireWrite(config, command);
  if (permission) {
    return permission;
  }
  const content = blockContentArgs(markdown);
  if ("error" in content) {
    return content.error;
  }

  const targets = await readTargets(cli, [parent], command);
  if (!(targets instanceof Map)) return targets;
  const invalid = checkInsertion(targets, parent, undefined, command);
  if (invalid) return invalid;
  return runAuditedWrite(
    config,
    cli,
    command,
    withDryRun(["block", subcommand, "--parent", parent, ...content.args], dryRun),
    { parent, markdown, dryRun },
    dryRun
  );
}

async function updateBlockDirectly(
  config: ServerConfig,
  cli: SiyuanCli,
  id: string,
  markdown: string,
  dryRun: boolean
) {
  const permission = requireWrite(config, "block_update");
  if (permission) {
    return permission;
  }
  if (!isSingleBlockMarkdown(markdown)) {
    return {
      ok: false,
      warnings: [
        "siyuan_update_block only supports one Markdown block. SiYuan CLI block update keeps only the first block and discards later blocks."
      ],
      command: "block_update"
    };
  }

  const targets = await readTargets(cli, [id], "block_update");
  if (!(targets instanceof Map)) return targets;
  const target = targets.get(id)!;
  const invalid = requireTarget(target, "content", "block_update");
  if (invalid) return invalid;
  const issues = validateWritableMarkdown(markdown);
  if (issues.length) return safetyError("block_update", "INVALID_MARKDOWN", issues.join(" "));
  const result = await runAuditedWrite(config, cli, "block_update",
    withDryRun(["block", "update", "--id", id, "--data", markdown], dryRun),
    { id, markdown, dryRun, reason: "block_update" }, dryRun);
  return verifyMarkdown(cli, id, markdown, result);
}

function blockContentArgs(markdown: string):
  | { args: string[] }
  | { error: { ok: false; warnings: string[]; command: string } } {
  const issues = validateWritableMarkdown(markdown);
  if (!markdown || issues.length) return { error: { ok: false, command: "block_content", warnings: issues.length ? issues : ["Markdown must not be empty."] } };
  return { args: ["--data", markdown] };
}

function assetList(data: unknown, key: string): string[] {
  const value = typeof data === "object" && data !== null ? (data as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function writableMarkdownSchema(requireContent = true, additionalGuidance?: string) {
  const schema = (requireContent ? z.string().min(1) : z.string()).superRefine((markdown, context) => {
    for (const issue of validateWritableMarkdown(markdown)) {
      context.addIssue({ code: "custom", message: issue });
    }
  });
  const guidance = [
    "Markdown content.",
    "For links, prefer [label](https://example.com).",
    "SiYuan inline formulas must use single-dollar delimiters: $...$.",
    "The final Markdown must contain standard single-backslash KaTeX commands, such as $\\sqrt{x}$.",
    "When constructing raw JSON or JavaScript source, escape backslashes as required, for example $\\\\sqrt{x}$ in source must decode to $\\sqrt{x}$.",
    "Do not store doubled backslashes merely because serialized JSON displays them as \\\\.",
    "Do not use \\(...\\) or bare LaTeX commands for inline formulas.",
    "Dollar signs inside fenced code blocks and inline code are treated literally and are excluded from formula validation.",
    additionalGuidance
  ].filter(Boolean);
  return schema.describe(guidance.join(" "));
}

const SUSPICIOUS_BARE_KATEX_COMMAND =
  /(^|[^\\A-Za-z])(?:sqrt|bar|mathrm|mathbf|mathit|mathbb|mathcal|frac|text|overline|underline|operatorname)\s*\{/i;

/**
 * Detects high-confidence signs that a source-language escape damaged Markdown before it reached MCP.
 * This is intentionally local and conservative: it performs no I/O and never rewrites content.
 */
export function validateWritableMarkdown(markdown: string): string[] {
  const issues: string[] = [];
  const forbiddenControl = markdown.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  if (forbiddenControl) {
    issues.push(
      `Markdown contains forbidden control character U+${forbiddenControl[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}; the input may have been damaged while constructing a JSON or JavaScript string.`
    );
  }

  if (/\r(?!\n)/.test(markdown)) {
    issues.push("Markdown contains a standalone carriage return; use a normal line break and ensure caller source strings are escaped correctly.");
  }

  const markdownWithoutCode = maskMarkdownCodeContexts(markdown);
  for (const { delimiter, formula } of extractMathSpans(markdownWithoutCode)) {
    if (delimiter === "$" && /[\u0000-\u001F\u007F]/.test(formula)) {
      issues.push("An inline formula contains a control character; ensure JavaScript or JSON source escapes each LaTeX backslash.");
    }
    if (SUSPICIOUS_BARE_KATEX_COMMAND.test(formula)) {
      issues.push("A formula contains a likely bare KaTeX command such as sqrt{...} or bar{...}; the final Markdown command must retain one backslash.");
    }
  }

  return [...new Set(issues)];
}

interface MathSpan {
  delimiter: "$" | "$$";
  formula: string;
}

function extractMathSpans(markdown: string): MathSpan[] {
  const spans: MathSpan[] = [];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "$" || isEscapedAt(markdown, index)) {
      continue;
    }

    const delimiter: "$" | "$$" = markdown[index + 1] === "$" ? "$$" : "$";
    const contentStart = index + delimiter.length;
    const closing = findMathClosingDelimiter(markdown, contentStart, delimiter);
    if (closing === undefined) {
      if (delimiter === "$") {
        index = skipToLineEnd(markdown, index);
      } else {
        index += delimiter.length - 1;
      }
      continue;
    }

    spans.push({
      delimiter,
      formula: markdown.slice(contentStart, closing)
    });
    index = closing + delimiter.length - 1;
  }
  return spans;
}

function findMathClosingDelimiter(
  markdown: string,
  start: number,
  delimiter: "$" | "$$"
): number | undefined {
  for (let index = start; index < markdown.length; index += 1) {
    if (delimiter === "$" && (markdown[index] === "\n" || markdown[index] === "\r")) {
      return undefined;
    }
    if (markdown[index] !== "$" || isEscapedAt(markdown, index)) {
      continue;
    }
    if (delimiter === "$$") {
      if (markdown[index + 1] === "$") {
        return index;
      }
      continue;
    }
    if (markdown[index + 1] !== "$" && markdown[index - 1] !== "$") {
      return index;
    }
  }
  return undefined;
}

function skipToLineEnd(markdown: string, start: number): number {
  const lineFeed = markdown.indexOf("\n", start);
  const carriageReturn = markdown.indexOf("\r", start);
  const endings = [lineFeed, carriageReturn].filter((index) => index >= 0);
  return endings.length > 0 ? Math.min(...endings) : markdown.length;
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function maskMarkdownCodeContexts(markdown: string): string {
  // String indexes in the scanners are UTF-16 code-unit offsets, so split("") must be used here.
  const masked = markdown.split("");
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let offset = 0;

  while (offset < markdown.length) {
    const newline = markdown.indexOf("\n", offset);
    const lineEnd = newline >= 0 ? newline : markdown.length;
    const contentEnd = lineEnd > offset && markdown[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    const line = markdown.slice(offset, contentEnd);

    if (fence) {
      maskRange(masked, offset, contentEnd);
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (opening) {
        fence = {
          marker: opening[1][0] as "`" | "~",
          length: opening[1].length
        };
        maskRange(masked, offset, contentEnd);
      } else if (/^(?: {4}|\t)/.test(line)) {
        maskRange(masked, offset, contentEnd);
      }
    }

    offset = newline >= 0 ? newline + 1 : markdown.length;
  }

  maskInlineCodeSpans(markdown, masked);
  return masked.join("");
}

function maskInlineCodeSpans(markdown: string, masked: string[]): void {
  for (let index = 0; index < markdown.length; index += 1) {
    if (masked[index] !== "`") {
      continue;
    }

    const openingLength = countRun(markdown, index, "`");
    let cursor = index + openingLength;
    let closing: number | undefined;
    while (cursor < markdown.length) {
      if (masked[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      const candidateLength = countRun(markdown, cursor, "`");
      if (candidateLength === openingLength) {
        closing = cursor;
        break;
      }
      cursor += candidateLength;
    }

    if (closing === undefined) {
      index += openingLength - 1;
      continue;
    }

    maskRange(masked, index, closing + openingLength);
    index = closing + openingLength - 1;
  }
}

function countRun(value: string, start: number, character: string): number {
  let length = 0;
  while (value[start + length] === character) {
    length += 1;
  }
  return length;
}

function maskRange(target: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (target[index] !== "\r" && target[index] !== "\n") {
      target[index] = " ";
    }
  }
}

export function isSingleBlockMarkdown(markdown: string): boolean {
  const blocks = markdown
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter((block) => block.trim() && !/^\s*\{:\s+[^}]+\}\s*$/.test(block.trim()));
  if (blocks.length !== 1) {
    return false;
  }

  const lines = blocks[0].split(/\r?\n/);
  let fenced = false;
  let firstListIndent: number | undefined;
  let topLevelListItems = 0;
  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }

    const listItem = line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+/);
    if (listItem) {
      const indent = listItem[1].replace(/\t/g, "    ").length;
      firstListIndent ??= indent;
      if (indent === firstListIndent) {
        topLevelListItems += 1;
      }
    }
  }

  if (topLevelListItems > 1) {
    return false;
  }

  const meaningfulLines = lines.filter((line) => line.trim() && !/^\s*\{:\s+[^}]+\}\s*$/.test(line));
  return !/^\s{0,3}#{1,6}\s+/.test(meaningfulLines[0] ?? "") || meaningfulLines.length === 1;
}
