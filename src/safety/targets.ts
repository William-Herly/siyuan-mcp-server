import { SiyuanCli } from "../cli/client.js";
import { NormalizedResponse } from "../types.js";

export const BLOCK_ID = /^\d{14}-[a-z0-9]{7}$/;

const CONTENT_TYPES = new Set(["p", "h", "l", "i", "b", "s", "c", "m", "t", "html", "iframe", "widget", "video", "audio", "query_embed", "tb", "av", "custom", "callout", "tabs", "tab", "mindmap", "mindmap_item"]);
const CONTAINER_TYPES = new Set(["d", "b", "l", "i", "s", "callout", "tabs", "tab", "mindmap", "mindmap_item"]);
const MAX_TARGET_IDS = 64;
const MAX_ANCESTOR_DEPTH = 64;
const MAX_SCOPE_ROWS = MAX_TARGET_IDS * (MAX_ANCESTOR_DEPTH + 1);

export interface BlockTarget {
  id: string;
  root_id: string;
  parent_id: string;
  type: string;
  markdown: string;
  ial: string;
  updated: string;
}

export function safetyError(command: string, code: string, message: string, data: Record<string, unknown> = {}): NormalizedResponse {
  return { ok: false, command, warnings: [message], code, execution: "not-started", retryable: false, data };
}

/** Fixed internal query; IDs are validated before interpolation. Never accepts caller SQL. */
export async function readTargets(cli: SiyuanCli, ids: string[], command: string, documentId?: string, allowMissing = false, includeAncestors = false): Promise<Map<string, BlockTarget> | NormalizedResponse> {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > MAX_TARGET_IDS || unique.some((id) => !BLOCK_ID.test(id)) || (documentId && !BLOCK_ID.test(documentId))) {
    return safetyError(command, "INVALID_BLOCK_ID", "Use an existing SiYuan block ID; no write was attempted.");
  }
  const ancestors = includeAncestors || Boolean(documentId);
  const where = `id IN (${unique.map((id) => `'${id}'`).join(",")})${documentId ? ` AND root_id = '${documentId}'` : ""}`;
  const columns = `id, root_id, parent_id, type, ${allowMissing && !ancestors ? "markdown, ial" : "'' AS markdown, '' AS ial"}, updated`;
  // Bound traversal as well as output. Query only referenced blocks and their ancestors,
  // never every block in a document. UNION keeps each (id, depth) pair finite on cycles.
  const sql = ancestors
    ? `WITH RECURSIVE target_scope(id, depth) AS (SELECT id, 0 FROM blocks WHERE ${where} UNION SELECT b.parent_id, s.depth + 1 FROM blocks b JOIN target_scope s ON b.id = s.id WHERE b.parent_id <> '' AND s.depth < ${MAX_ANCESTOR_DEPTH}) SELECT ${columns} FROM blocks WHERE id IN (SELECT id FROM target_scope) LIMIT ${MAX_SCOPE_ROWS + 1}`
    : `SELECT ${columns} FROM blocks WHERE ${where} LIMIT ${unique.length + 1}`;
  const result = await cli.run("write_targets", ["sql", "--limit", String(ancestors ? MAX_SCOPE_ROWS + 1 : unique.length + 1), sql]);
  if (!result.ok && result.code === "WORKSPACE_UNAVAILABLE") return { ...result, command };
  if (!result.ok || !Array.isArray(result.data)) {
    return safetyError(command, "TARGET_LOOKUP_FAILED", "Could not verify write targets. Stop; do not bypass MCP.");
  }
  if (result.truncated || result.data.length > (ancestors ? MAX_SCOPE_ROWS : unique.length)) {
    return safetyError(command, "TARGET_LOOKUP_INCOMPLETE", "Target metadata was truncated. No write was attempted.", { reason: "TRUNCATED" });
  }
  const targets = new Map<string, BlockTarget>();
  for (const row of result.data) {
    if (!row || typeof row !== "object") return safetyError(command, "TARGET_LOOKUP_FAILED", "Unexpected target metadata.");
    const value = row as Record<string, unknown>;
    if (!["id", "root_id", "parent_id", "type", "markdown", "ial", "updated"].every((key) => typeof value[key] === "string") ||
        !BLOCK_ID.test(String(value.id)) || !BLOCK_ID.test(String(value.root_id)) ||
        (value.parent_id !== "" && !BLOCK_ID.test(String(value.parent_id))) ||
        !/^[a-z][a-z0-9_]*$/.test(String(value.type)) || targets.has(String(value.id)) ||
        (documentId && value.root_id !== documentId)) {
      return safetyError(command, "TARGET_LOOKUP_FAILED", "Unknown or ambiguous block metadata; no write was attempted.");
    }
    targets.set(String(value.id), value as unknown as BlockTarget);
  }
  if (!allowMissing && unique.some((id) => !targets.has(id))) return safetyError(command, "TARGET_NOT_FOUND", "A target no longer exists or is outside the requested document.");
  const unsupported = unique.find((id) => targets.has(id) && targets.get(id)!.type !== "d" && !CONTENT_TYPES.has(targets.get(id)!.type));
  if (unsupported) {
    return safetyError(command, "TARGET_LOOKUP_FAILED", "An operation target has an unsupported block type. No write was attempted.", { reason: "UNSUPPORTED_TARGET_TYPE", id: unsupported, type: targets.get(unsupported)!.type });
  }
  if (ancestors) {
    for (const id of unique) {
      let current = targets.get(id);
      if (!current) continue;
      const rootId = current.root_id;
      const visited = new Set<string>();
      while (current.parent_id) {
        if (visited.has(current.id) || visited.size >= MAX_ANCESTOR_DEPTH) return safetyError(command, "TARGET_LOOKUP_INCOMPLETE", "Target ancestry contains a cycle or exceeds the supported depth.", { reason: "INVALID_ANCESTRY", id });
        visited.add(current.id);
        const parent = targets.get(current.parent_id);
        if (!parent || parent.root_id !== rootId) return safetyError(command, "TARGET_LOOKUP_INCOMPLETE", "Could not determine the complete target ancestry. No write was attempted.", { reason: "MISSING_ANCESTOR", id, missingAncestorId: current.parent_id });
        current = parent;
      }
      if (current.id !== rootId || current.type !== "d") return safetyError(command, "TARGET_LOOKUP_FAILED", "Target ancestry does not end at its document root.");
    }
  }
  return targets;
}

export function requireTarget(target: BlockTarget, kind: "document" | "content", command: string): NormalizedResponse | undefined {
  const document = target.type === "d" && target.root_id === target.id && target.parent_id === "";
  const content = CONTENT_TYPES.has(target.type) && target.root_id !== target.id && target.parent_id !== "";
  if ((kind === "document" && !document) || (kind === "content" && !content)) {
    return safetyError(command, "TARGET_TYPE_MISMATCH", kind === "content"
      ? "Document roots cannot be updated or deleted as content blocks. Use siyuan_rename_document for a title; document deletion requires its dedicated tool."
      : "This operation requires a document root ID.");
  }
}

export interface InsertionLocation { parent: string; documentId: string }

/** SQL parent_id includes virtual heading ownership; the CLI needs a container. */
export function resolveInsertion(targets: Map<string, BlockTarget>, parent: string, previous: string | undefined, command: string): InsertionLocation | NormalizedResponse {
  const target = targets.get(parent)!;
  const invalid = requireTarget(target, target.type === "d" ? "document" : "content", command);
  if (invalid) return invalid;
  if (previous) {
    const sibling = targets.get(previous)!;
    const details = { providedParentId: parent, previousId: previous, anchorSemanticParentId: sibling.parent_id, documentId: target.root_id };
    if (sibling.root_id !== target.root_id || sibling.type === "d") {
      return safetyError(command, "DOCUMENT_SCOPE_MISMATCH", "The anchor must be a content block in the requested document.", { ...details, reason: "INVALID_ANCHOR_SCOPE" });
    }
    let container = targets.get(sibling.parent_id);
    const visited = new Set<string>();
    while (container?.type === "h" && !visited.has(container.id)) {
      visited.add(container.id);
      container = targets.get(container.parent_id);
    }
    if (!container || !CONTAINER_TYPES.has(container.type)) return safetyError(command, "TARGET_LOOKUP_INCOMPLETE", "Could not resolve the anchor's insertion container.", { ...details, reason: "UNKNOWN_CONTAINER" });
    // Accept the physical container and legacy callers supplying the anchor's
    // immediate semantic heading parent. Neither permits arbitrary retargeting.
    if (parent !== container.id && !(target.type === "h" && parent === sibling.parent_id)) {
      return safetyError(command, "DOCUMENT_SCOPE_MISMATCH", "parent must be the anchor's container or its immediate section heading. No write was attempted.", { ...details, reason: "PARENT_MISMATCH", anchorContainerId: container.id });
    }
    return { parent: container.id, documentId: target.root_id };
  }
  if (!CONTAINER_TYPES.has(target.type)) return safetyError(command, "TARGET_TYPE_MISMATCH", "parent must be a container. Headings and paragraphs cannot receive children; use insert with previous set to the heading or a known section block.", { reason: "PARENT_NOT_CONTAINER", providedParentId: parent, parentType: target.type, documentId: target.root_id });
  return { parent, documentId: target.root_id };
}
