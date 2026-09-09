import { SiyuanCli } from "../cli/client.js";
import { NormalizedResponse } from "../types.js";

export const BLOCK_ID = /^\d{14}-[a-z0-9]{7}$/;

const CONTENT_TYPES = new Set(["p", "h", "l", "i", "b", "s", "c", "m", "t", "html", "iframe", "widget", "video", "audio", "query_embed", "tb", "av"]);

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
export async function readTargets(cli: SiyuanCli, ids: string[], command: string, documentId?: string, allowMissing = false): Promise<Map<string, BlockTarget> | NormalizedResponse> {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.some((id) => !BLOCK_ID.test(id)) || (documentId && !BLOCK_ID.test(documentId))) {
    return safetyError(command, "INVALID_BLOCK_ID", "Use an existing SiYuan block ID; no write was attempted.");
  }
  const where = documentId ? `root_id = '${documentId}'` : `id IN (${unique.map((id) => `'${id}'`).join(",")})`;
  const result = await cli.run("write_targets", ["sql", `SELECT id, root_id, parent_id, type, ${documentId ? "'' AS markdown, '' AS ial" : "markdown, ial"}, updated FROM blocks WHERE ${where}`]);
  if (!result.ok || !Array.isArray(result.data)) {
    return safetyError(command, "TARGET_LOOKUP_FAILED", "Could not verify write targets. Stop; do not bypass MCP.");
  }
  const targets = new Map<string, BlockTarget>();
  for (const row of result.data) {
    if (!row || typeof row !== "object") return safetyError(command, "TARGET_LOOKUP_FAILED", "Unexpected target metadata.");
    const value = row as Record<string, unknown>;
    if (!["id", "root_id", "parent_id", "type", "markdown", "ial", "updated"].every((key) => typeof value[key] === "string") ||
        !BLOCK_ID.test(String(value.id)) || !BLOCK_ID.test(String(value.root_id)) ||
        (value.parent_id !== "" && !BLOCK_ID.test(String(value.parent_id))) ||
        (value.type !== "d" && !CONTENT_TYPES.has(String(value.type))) || targets.has(String(value.id)) ||
        (documentId && value.root_id !== documentId)) {
      return safetyError(command, "TARGET_LOOKUP_FAILED", "Unknown or ambiguous block metadata; no write was attempted.");
    }
    targets.set(String(value.id), value as unknown as BlockTarget);
  }
  if (!allowMissing && unique.some((id) => !targets.has(id))) return safetyError(command, "TARGET_NOT_FOUND", "A target no longer exists or is outside the requested document.");
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

export function checkInsertion(targets: Map<string, BlockTarget>, parent: string, previous: string | undefined, command: string): NormalizedResponse | undefined {
  const target = targets.get(parent)!;
  const invalid = requireTarget(target, target.type === "d" ? "document" : "content", command);
  if (invalid) return invalid;
  if (previous) {
    const sibling = targets.get(previous)!;
    if (sibling.parent_id !== parent || sibling.root_id !== target.root_id || sibling.type === "d") {
      return safetyError(command, "DOCUMENT_SCOPE_MISMATCH", "previous must be an existing direct child of parent in the same document.");
    }
  }
}
