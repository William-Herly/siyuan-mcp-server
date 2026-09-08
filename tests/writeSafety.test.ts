import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { SiyuanCli } from "../src/cli.js";
import { registerTools } from "../src/tools.js";
import { normalizeMarkdown } from "../src/writeSafety.js";
import { runAuditedWrite } from "../src/toolHelpers.js";
import type { ServerConfig } from "../src/config.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const DOC = "20260908154051-h3ysj72", BLOCK = "20260908154051-8wu6gis", CHILD = "20260908154051-childaa", OTHER = "20260908154051-otheraa";
const row = (id: string, root_id = DOC, parent_id = DOC, type = "p", markdown = "old") => ({ id, root_id, parent_id, type, markdown, ial: "", updated: "" });
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture(options: { dangerous?: boolean; readonly?: boolean; fail?: string; rows?: ReturnType<typeof row>[]; unknownType?: boolean } = {}) {
  const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-safety-test-")); directories.push(logDir);
  const config: ServerConfig = { workspace: "MOCK", cliPath: "NEVER_EXECUTE", logDir, timeoutMs: 100, allowWrite: !options.readonly, allowDangerous: options.dangerous ?? false, toolProfile: "full" };
  const rows = options.rows ?? [row(DOC, DOC, "", "d", ""), row(BLOCK), row(CHILD, DOC, BLOCK), row(OTHER)];
  const calls: string[][] = [];
  let title = "old";
  const cli = new SiyuanCli(config, async (_file, args) => {
    calls.push(args);
    const ok = (data: unknown) => ({ stdout: typeof data === "string" ? data : JSON.stringify(data), stderr: "", exitCode: 0, timedOut: false });
    const id = args[args.indexOf("--id") + 1];
    if (options.fail && args.includes(options.fail)) return { stdout: "", stderr: "injected failure", exitCode: 1, timedOut: options.fail === "update" };
    if (args.includes("sql")) {
      const query = args.at(-1)!;
      return ok(rows.filter((r) => query.includes("WHERE root_id") ? r.root_id === DOC : query.includes(`'${r.id}'`)).map((r) => options.unknownType ? { ...r, type: "future_type" } : r));
    }
    if (args.includes("export")) { await writeFile(args[args.indexOf("--output") + 1], Buffer.concat([Buffer.from([80,75,3,4]), Buffer.alloc(30)])); return ok(""); }
    if (args.includes("rename")) title = args[args.indexOf("--title") + 1];
    if (args.includes("get")) return ok({ id, ial: { title } });
    if (args.includes("update")) rows.find((r) => r.id === id)!.markdown = args[args.indexOf("--data") + 1];
    if (args.includes("delete")) rows.splice(rows.findIndex((r) => r.id === id), 1);
    if (args.includes("kramdown")) return ok(rows.find((r) => r.id === id)?.markdown ?? "");
    return ok("ok");
  });
  const tools = new Map<string, { inputSchema: Record<string, z.ZodType>; handler: (args: unknown) => Promise<CallToolResult> }>();
  registerTools({ registerTool(name: string, meta: { inputSchema?: Record<string, z.ZodType> }, handler: (args: unknown) => Promise<CallToolResult>) { tools.set(name, { inputSchema: meta.inputSchema ?? {}, handler }); } } as never, config, cli);
  return { calls, rows, config, cli, async call(name: string, args: unknown) {
    const tool = tools.get(name)!;
    const result = await tool.handler(z.object(tool.inputSchema).parse(args));
    return { ...result.structuredContent, isError: result.isError } as Record<string, any>;
  }};
}

describe("write boundaries", () => {
  it.each(["siyuan_update_block", "siyuan_delete_block", "siyuan_patch_blocks"])("rejects document roots in %s before any mutation", async (name) => {
    const f = await fixture({ dangerous: true });
    const args = name === "siyuan_patch_blocks" ? { documentId: DOC, operations: [{ op: "delete", id: DOC }] } : { id: DOC, markdown: "title" };
    expect(await f.call(name, args)).toMatchObject({ ok: false, isError: true, code: "TARGET_TYPE_MISMATCH", execution: "not-started" });
    expect(f.calls.every((args) => args.includes("sql"))).toBe(true);
  });
  it.each(["siyuan_rename_document", "siyuan_replace_document_body"])("requires a document in %s", async (name) => {
    const f = await fixture({ dangerous: true });
    expect(await f.call(name, { id: BLOCK, title: "new", markdown: "new" })).toMatchObject({ code: "TARGET_TYPE_MISMATCH" });
    expect(f.calls).toHaveLength(1);
  });
  it("fails closed on unknown types, missing targets and invalid IDs", async () => {
    const f = await fixture({ unknownType: true });
    expect(await f.call("siyuan_update_block", { id: BLOCK, markdown: "new" })).toMatchObject({ code: "TARGET_LOOKUP_FAILED" });
    const normal = await fixture();
    expect(await normal.call("siyuan_update_block", { id: "arbitrary' SQL", markdown: "new" })).toMatchObject({ code: "INVALID_BLOCK_ID" });
    expect(normal.calls).toHaveLength(0);
  });
  it("keeps permission denial ahead of all CLI access", async () => {
    const f = await fixture({ readonly: true });
    expect(await f.call("siyuan_update_block", { id: BLOCK, markdown: "new" })).toMatchObject({ code: "PERMISSION_DENIED", isError: true });
    expect(f.calls).toHaveLength(0);
  });
  it("gates full replacement even when ordinary writing is enabled", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_replace_document_body", { id: DOC, markdown: "new" })).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.calls).toHaveLength(0);
  });
  it("renames using metadata only, without archive or body readback", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_rename_document", { id: DOC, title: "new" })).toMatchObject({ ok: true, verification: "passed", data: { id: DOC, requiresRefresh: false } });
    expect(f.calls.map((args) => args.slice(4, 6))).toEqual([["sql", expect.any(String)], ["document", "rename"], ["block", "get"]]);
    expect(f.rows.find((r) => r.id === BLOCK)!.markdown).toBe("old");
  });
  it("backs up a single update once and returns verified identity", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_update_block", { id: BLOCK, markdown: "new" })).toMatchObject({ ok: true, verification: "passed", recovery: { documentId: DOC }, data: { id: BLOCK, requiresRefresh: false } });
    expect(f.calls.filter((args) => args.includes("export"))).toHaveLength(1);
    expect(f.calls.filter((args) => args.includes("kramdown"))).toHaveLength(1);
    expect(f.calls.findIndex((args) => args.includes("export"))).toBeLessThan(f.calls.findIndex((args) => args.includes("update")));
  });
  it("does not modify content if a backup fails", async () => {
    const f = await fixture({ fail: "export" });
    expect(await f.call("siyuan_update_block", { id: BLOCK, markdown: "new" })).toMatchObject({ code: "BACKUP_FAILED", execution: "not-started" });
    expect(f.calls.some((args) => args.includes("update"))).toBe(false);
  });
  it("reports timeouts as unknown without retrying", async () => {
    const f = await fixture({ fail: "update" });
    expect(await f.call("siyuan_update_block", { id: BLOCK, markdown: "new" })).toMatchObject({ ok: false, execution: "unknown", retryable: false, recovery: { documentId: DOC } });
    expect(f.calls.filter((args) => args.includes("update"))).toHaveLength(1);
  });
  it("does not repeat a write when verification fails", async () => {
    const f = await fixture({ fail: "kramdown" });
    expect(await f.call("siyuan_update_block", { id: BLOCK, markdown: "new" })).toMatchObject({ ok: false, execution: "applied", verification: "unknown" });
    expect(f.calls.filter((args) => args.includes("update"))).toHaveLength(1);
  });
  it("rejects wrong sibling placement", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_insert_block", { parent: DOC, previous: CHILD, markdown: "new" })).toMatchObject({ code: "DOCUMENT_SCOPE_MISMATCH" });
    expect(f.calls).toHaveLength(1);
  });
  it.each([
    [{ op: "delete", id: BLOCK }, { op: "update", id: CHILD, markdown: "new" }],
    [{ op: "update", id: CHILD, markdown: "new" }, { op: "delete", id: BLOCK }],
    [{ op: "delete", id: BLOCK }, { op: "delete", id: BLOCK }],
    [{ op: "update", id: BLOCK, markdown: "new" }, { op: "insert", parent: DOC, previous: BLOCK, markdown: "new" }]
  ])("rejects dependent batches before writing: %j", async (...operations) => {
    const f = await fixture();
    expect(await f.call("siyuan_patch_blocks", { documentId: DOC, operations })).toMatchObject({ code: "CONFLICTING_OPERATIONS" });
    expect(f.calls).toHaveLength(1);
  });
  it("rejects cross-document batches", async () => {
    const f = await fixture({ rows: [row(DOC, DOC, "", "d"), row(BLOCK, OTHER, OTHER)] });
    expect(await f.call("siyuan_patch_blocks", { documentId: DOC, operations: [{ op: "update", id: BLOCK, markdown: "new" }] })).toMatchObject({ code: "TARGET_NOT_FOUND" });
    expect(f.calls).toHaveLength(1);
  });
  it("merges backup and verification for independent batch updates", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_patch_blocks", { documentId: DOC, operations: [{ op: "update", id: BLOCK, markdown: "new" }, { op: "delete", id: OTHER }] })).toMatchObject({ ok: true, verification: "passed", data: { appliedCount: 2, requiresRefresh: false } });
    expect(f.calls.filter((args) => args.includes("sql"))).toHaveLength(2);
    expect(f.calls.filter((args) => args.includes("export"))).toHaveLength(1);
    expect(f.calls.some((args) => args.includes("kramdown"))).toBe(false);
  });
  it("reports partial progress and recovery when the second batch step fails", async () => {
    const f = await fixture({ fail: "delete" });
    expect(await f.call("siyuan_patch_blocks", { documentId: DOC, operations: [{ op: "append", parent: DOC, markdown: "new" }, { op: "delete", id: OTHER }] })).toMatchObject({ ok: false, code: "PARTIAL_FAILURE", data: { applied: [expect.any(Object)], requiresRefresh: true }, recovery: { documentId: DOC } });
  });
  it("does not read body or archive for an ordinary append", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_append_block", { parent: DOC, markdown: "new" })).toMatchObject({ ok: true });
    expect(f.calls).toHaveLength(2);
    await expect(f.call("siyuan_append_block", { parent: DOC, file: "unvalidated.md" })).rejects.toThrow();
  });
  it("exposes permission-aware capabilities without querying note data", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_health", {})).toMatchObject({ data: { writeCapabilities: { siyuan_rename_document: { status: "available" }, siyuan_replace_document_body: { status: "permission-denied" } } } });
    expect(f.calls).toHaveLength(0);
  });
  it("does not allow attributes or full storage tools to bypass title/content boundaries", async () => {
    const f = await fixture();
    expect(await f.call("siyuan_set_attrs", { id: DOC, attrs: { title: "bypass" } })).toMatchObject({ code: "RESERVED_ATTRIBUTE" });
    expect(await f.call("siyuan_file_write", { path: "data/document.sy", file: "replacement.sy" })).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await f.call("siyuan_import_sy", { notebook: DOC, file: "replacement.zip" })).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("audit failure semantics", () => {
  it("fails before executing if intent cannot be written", async () => {
    const f = await fixture();
    const file = path.join(f.config.logDir, "not-a-directory"); await writeFile(file, "x");
    expect(await runAuditedWrite({ ...f.config, logDir: file }, f.cli, "append", ["block", "append"], {}, false)).toMatchObject({ execution: "not-started", code: "AUDIT_UNAVAILABLE" });
    expect(f.calls).toHaveLength(0);
  });
  it("preserves successful execution when result logging fails", async () => {
    const f = await fixture();
    const cli = new SiyuanCli(f.config, async () => {
      await rm(path.join(f.config.logDir, "writes.jsonl"));
      const { mkdir } = await import("node:fs/promises"); await mkdir(path.join(f.config.logDir, "writes.jsonl"));
      return { stdout: "ok", stderr: "", exitCode: 0, timedOut: false };
    });
    expect(await runAuditedWrite(f.config, cli, "append", ["block", "append"], {}, false)).toMatchObject({ ok: true, execution: "applied", audit: "failed" });
  });
  it("records intent and result without exposing the submitted body", async () => {
    const f = await fixture(); await f.call("siyuan_append_block", { parent: DOC, markdown: "private body" });
    const audit = await readFile(path.join(f.config.logDir, "writes.jsonl"), "utf8");
    expect(audit).not.toContain("private body");
    expect(audit.trim().split("\n").map((line) => JSON.parse(line).input.auditPhase)).toEqual(["intent", "result"]);
  });
});

it("removes CLI-generated block IAL but preserves fenced code literals", () => {
  expect(normalizeMarkdown(`text\n{: id="${BLOCK}" updated="123"}`)).toBe("text");
  const code = `\`\`\`\n{: id="${BLOCK}"}\n\`\`\``;
  expect(normalizeMarkdown(code)).toBe(code);
  expect(normalizeMarkdown(`- {: id="${BLOCK}" updated="123"}item\n  {: id="${CHILD}"}`)).toBe("- item");
});
