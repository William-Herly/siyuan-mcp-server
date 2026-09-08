import MarkdownIt from "markdown-it";
import type { SiyuanCli } from "./cli.js";
import type { NormalizedResponse } from "./types.js";

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

/** Serializes MCP operations. Other processes/SiYuan UI remain outside this lock. */
let operationQueue: Promise<unknown> = Promise.resolve();
export function serializeOperation<T>(action: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(action, action);
  operationQueue = result.catch(() => undefined);
  return result;
}

const markdownParser = new MarkdownIt({ html: true, linkify: false, typographer: false });
type MarkdownToken = ReturnType<typeof markdownParser.parse>[number];

/** Compare parsed content, not serializer spacing; never modify the stored Markdown. */
export function normalizeMarkdown(value: string): string {
  const source = value.replace(/\r\n/g, "\n");
  const protectedLines = new Set<number>();
  for (const token of markdownParser.parse(source, {})) {
    if (token.map && (["fence", "code_block", "html_block"].includes(token.type) || token.children?.some((child) => child.type === "code_inline"))) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) protectedLines.add(line);
    }
  }
  // Remove block IAL before table parsing, where it otherwise becomes a spurious table row.
  const withoutBlockAttrs = source.split("\n").map((line, index) => {
    const attribute = line.match(/^(\s*(?:>\s*)*)\{:\s+id="\d{14}-[a-z0-9]{7}"[^\r\n]*\}\s*$/);
    return !protectedLines.has(index) && attribute ? attribute[1].trimEnd() : line;
  }).join("\n");
  return JSON.stringify(canonicalTokens(markdownParser.parse(withoutBlockAttrs, {})));
}

function canonicalTokens(tokens: MarkdownToken[], inline = false): unknown[] {
  const output: { type: string; tag: string; nesting: number; attrs: unknown; content: string; info: string; children: unknown[] | null }[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let content = token.content;
    // Only text at a block/line start can be generated IAL. Code, HTML and link labels stay literal.
    if (inline && token.type === "text" && (index === 0 || tokens[index - 1].type === "softbreak")) {
      content = content.replace(/^\{:\s+id="\d{14}-[a-z0-9]{7}"[^\r\n]*?\}/, "");
      if (!content) {
        if (output.at(-1)?.type === "softbreak") output.pop();
        continue;
      }
    }
    const children = token.children ? canonicalTokens(token.children, true) : null;
    if (token.type === "inline" && children?.length === 0 && output.at(-1)?.type === "paragraph_open" && tokens[index + 1]?.type === "paragraph_close") {
      output.pop(); index += 1; continue;
    }
    // map, markup, level and hidden encode source formatting, including tight/loose lists.
    output.push({ type: token.type, tag: token.tag, nesting: token.nesting, attrs: token.attrs,
      content: token.type === "inline" ? "" : content, info: token.info, children });
  }
  return output;
}

export async function verifyMarkdown(cli: SiyuanCli, id: string, markdown: string, result: NormalizedResponse): Promise<NormalizedResponse> {
  if (!result.ok) return result;
  const read = await cli.run("write_verify", ["block", "kramdown", "--id", id, "--mode", "md"], { output: "text" });
  const passed = read.ok && typeof read.data === "string" && normalizeMarkdown(read.data) === normalizeMarkdown(markdown);
  return {
    ...result, ok: passed, execution: "applied", verification: passed ? "passed" : read.ok ? "failed" : "unknown",
    ...(passed ? {} : { code: "VERIFICATION_FAILED", retryable: false }),
    warnings: [...result.warnings, ...(passed ? [] : ["Write completed, but its content could not be verified (Markdown normalization may differ). Do not blindly retry; inspect the affected scope."])],
    data: { ...(typeof result.data === "object" && result.data !== null && !Array.isArray(result.data) ? result.data : { result: result.data }), id, requiresRefresh: !passed }
  };
}
