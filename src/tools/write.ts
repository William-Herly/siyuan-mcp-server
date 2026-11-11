import { z } from "zod/v4";
import { blockContentArgs, buildCreateDocumentArgs, buildDocumentMoveArgs, buildImportArgs, buildSetAttrsArgs, withDryRun } from "../cli/args.js";
import { SiyuanCli } from "../cli/client.js";
import { createDocumentPathWarning, normalizeCreateDocumentParentPath } from "../cli/paths.js";
import { ServerConfig } from "../config.js";
import type { ToolRegistrar } from "../mcp/register.js";
import { registerCliTool } from "../mcp/register.js";
import { guardedWrite } from "../operations/guardedWrite.js";
import { patchBlocksDirectly } from "../operations/patchBlocks.js";
import { documentKramdownWithAssets, extractAssetRefs } from "../operations/readDocument.js";
import { replaceDocumentBodyDirectly } from "../operations/replaceDocumentBody.js";
import { updateBlockDirectly, writeBlockChild } from "../operations/writeBlock.js";
import { runAuditedWrite } from "../runtime/audit.js";
import { requireWrite } from "../safety/permissions.js";
import { resolveInsertion, readTargets, requireTarget, safetyError } from "../safety/targets.js";
import { parentBlockSchema, previousBlockSchema, patchOperationSchema, writableMarkdownSchema } from "./schemas.js";

/**
 * Registers safe-write tools for snapshots, append/prepend/insert, document creation, updates, and attrs.
 */
export function registerWriteTools(server: ToolRegistrar, config: ServerConfig, cli: SiyuanCli): void {
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
    "Appends markdown to a container. A heading or paragraph cannot receive children; use insert with a previous anchor for a heading section. Returns createdId when the CLI supplies one; no readback is needed just to locate it. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      parent: parentBlockSchema(),
      markdown: writableMarkdownSchema()
    },
    async ({ parent, markdown }) => writeBlockChild(config, cli, "block_append", "append", parent, markdown, false)
  );

  registerCliTool(
    server,
    "siyuan_prepend_block",
    "Prepends markdown to a container, not to a heading or paragraph. Returns createdId when supplied by the CLI. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      parent: parentBlockSchema(),
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
    "Inserts markdown into a container, optionally after previous. Heading children describe a section, not physical nesting: to insert below a heading, pass the container as parent and the heading or a known section block as previous. The anchor's immediate section heading is accepted as a legacy parent and resolved internally. Returns createdId when supplied by the CLI. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    {
      parent: parentBlockSchema(),
      markdown: writableMarkdownSchema(),
      previous: previousBlockSchema()
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

      const targets = await readTargets(cli, [parent, ...(previous ? [previous] : [])], "block_insert", undefined, false, Boolean(previous));
      if (!(targets instanceof Map)) return targets;
      const location = resolveInsertion(targets, parent, previous, "block_insert");
      if ("ok" in location) return location;
      return runAuditedWrite(
        config,
        cli,
        "block_insert",
        ["block", "insert", "--parent", location.parent, ...content.args, ...(previous ? ["--previous", previous] : [])],
        { parent, resolvedParent: location.parent, markdown, previous, dryRun: false },
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
    "Moves a content block to a container or after an anchor. Document roots, descendant destinations and invalid container/anchor relationships are rejected. Requires SIYUAN_MCP_ALLOW_WRITE=true.",
    { id: z.string().min(1), parent: parentBlockSchema(), previous: previousBlockSchema(), dryRun: z.boolean().default(false) },
    async ({ id, parent, previous, dryRun }) => {
      const permission = requireWrite(config, "block_move");
      if (permission) return permission;
      const targets = await readTargets(cli, [id, parent, ...(previous ? [previous] : [])], "block_move", undefined, false, true);
      if (!(targets instanceof Map)) return targets;
      const invalid = requireTarget(targets.get(id)!, "content", "block_move");
      if (invalid) return invalid;
      const location = resolveInsertion(targets, parent, previous, "block_move");
      if ("ok" in location) return location;
      for (const ref of [parent, ...(previous ? [previous] : [])]) {
        let current = targets.get(ref);
        while (current) {
          if (current.id === id) return safetyError("block_move", "CONFLICTING_OPERATIONS", "A block cannot be moved into, or after, itself or its descendants.", { id, destinationId: ref });
          current = targets.get(current.parent_id);
        }
      }
      const args = ["block", "move", "--id", id, "--parent", location.parent];
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

function assetList(data: unknown, key: string): string[] {
  const value = typeof data === "object" && data !== null ? (data as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
