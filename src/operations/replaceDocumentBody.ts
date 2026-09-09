import { createHash } from "node:crypto";
import { SiyuanCli } from "../cli/client.js";
import { ServerConfig } from "../config.js";
import { validateWritableMarkdown } from "../markdown/validate.js";
import { runAuditedWrite } from "../runtime/audit.js";
import { requireWrite } from "../safety/permissions.js";
import { BLOCK_ID, readTargets, requireTarget, safetyError } from "../safety/targets.js";
import { verifyMarkdown } from "../safety/verification.js";

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
