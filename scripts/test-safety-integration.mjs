import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { normalizeMarkdown } from "../dist/writeSafety.js";

// Boots only a newly created disposable workspace. All data operations go through MCP.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(path.join(tmpdir(), "siyuan-mcp-validation-"));
const logDir = path.join(workspace, "mcp-logs");
const report = { startedAt: new Date().toISOString(), workspace, logDir, cases: [], calls: [], limits: ["Does not test host isolation or production writes", "No automatic rollback or conditional version writes"] };
const clients = [];
const cliPath = process.env.SIYUAN_MCP_CLI_PATH || "siyuan";
const kernel = spawn(cliPath, ["--workspace", workspace, "serve", "--port", "0", "--accessAuthCode", randomUUID()], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let startup = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Disposable kernel startup timed out")), 45000);
  const output = (chunk) => { startup = (startup + String(chunk)).slice(-16000); if (startup.includes("kernel booted")) { clearTimeout(timer); resolve(); } };
  kernel.stdout.on("data", output); kernel.stderr.on("data", output);
  kernel.once("error", (error) => { clearTimeout(timer); reject(error); });
  kernel.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Disposable kernel exited: ${code}`)); });
});

async function connect(profile, write, dangerous) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string"));
  Object.assign(env, { SIYUAN_MCP_WORKSPACE: workspace, SIYUAN_MCP_LOG_DIR: logDir, SIYUAN_MCP_PROFILE: profile, SIYUAN_MCP_ALLOW_WRITE: String(write), SIYUAN_MCP_ALLOW_DANGEROUS: String(dangerous), SIYUAN_MCP_CLI_PATH: cliPath });
  const client = new Client({ name: "safety-validation", version: "1.0.0" });
  clients.push(client);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist/index.js")], cwd: root, env, stderr: "pipe" }));
  return client;
}

async function call(client, name, args = {}, code) {
  const start = performance.now();
  const response = await client.callTool({ name, arguments: args });
  const result = response.structuredContent;
  report.calls.push({ name, elapsedMs: Math.round(performance.now() - start), ok: result?.ok, isError: response.isError, code: result?.code, verification: result?.verification, recovery: result?.recovery });
  if (code === "SCHEMA") { assert.equal(response.isError, true); return response; }
  assert.ok(result, `Missing structured content: ${JSON.stringify(response)}`);
  if (!code && result.code === "BACKUP_FAILED") {
    assert.equal(result.execution, "not-started");
    assert.equal(result.retryable, false);
    throw Object.assign(new Error(`${name}: native backup unavailable; success path not exercised`), { blocked: true });
  }
  assert.equal(result.ok, !code, `${name}: ${JSON.stringify(result)}`);
  assert.equal(response.isError, code ? true : undefined);
  if (code) assert.equal(result.code, code);
  return result;
}

async function test(name, action) {
  const start = performance.now();
  try { const evidence = await action(); report.cases.push({ name, passed: true, elapsedMs: Math.round(performance.now() - start), evidence }); }
  catch (error) { report.cases.push({ name, passed: false, blocked: error.blocked === true, elapsedMs: Math.round(performance.now() - start), error: String(error.stack || error) }); }
  console.log(`${report.cases.at(-1).passed ? "PASS" : report.cases.at(-1).blocked ? "BLOCKED" : "FAIL"} ${name}`);
}

function idOf(value) {
  if (typeof value === "string" && /^\d{14}-[a-z0-9]{7}$/.test(value)) return value;
  if (value && typeof value === "object") { if (value.id) return idOf(value.id); for (const item of Object.values(value)) { const id = idOf(item); if (id) return id; } }
}

let admin, standard, readonly, notebook;
const create = async (markdown = "Original paragraph\n\nSecond paragraph") => idOf((await call(admin, "siyuan_create_document", { notebook, title: `Validation ${randomUUID()}`, markdown })).data);
const children = async (id) => (await call(admin, "siyuan_get_block_children", { id })).data;
const body = async (id) => (await call(admin, "siyuan_get_document_kramdown", { id, mode: "md" })).data.markdown;
const archives = async () => { try { return await readdir(path.join(logDir, "recovery")); } catch { return []; } };

try {
  await ready;
  console.log(`Disposable workspace: ${workspace}`);
  admin = await connect("full", true, true);
  standard = await connect("standard", true, false);
  readonly = await connect("standard", false, false);
  notebook = idOf((await call(admin, "siyuan_create_notebook", { name: "Disposable safety validation" })).data);
  assert.ok(notebook);
  await test("profiles, instructions and capability states", async () => {
    const minimal = await connect("minimal", false, false);
    assert.equal((await standard.listTools()).tools.length, 24);
    assert.ok(!(await minimal.listTools()).tools.some((t) => t.name === "siyuan_update_block"));
    assert.match(standard.getInstructions(), /Do not substitute direct HTTP/);
    const health = await call(standard, "siyuan_health");
    assert.equal(health.data.writeCapabilities.siyuan_rename_document.status, "available");
    assert.equal(health.data.writeCapabilities.siyuan_replace_document_body.status, "permission-denied");
  });
  await test("root updates/deletes rejected without changing document or creating archives", async () => {
    const id = await create(), before = await body(id), count = (await archives()).length;
    for (const client of [standard, admin]) {
      await call(client, "siyuan_update_block", { id, markdown: "wrong title" }, "TARGET_TYPE_MISMATCH");
      for (const op of ["update", "delete"]) await call(client, "siyuan_patch_blocks", { documentId: id, operations: [{ op, id, ...(op === "update" ? { markdown: "wrong title" } : {}) }] }, "TARGET_TYPE_MISMATCH");
    }
    await call(admin, "siyuan_delete_block", { id }, "TARGET_TYPE_MISMATCH");
    assert.equal(await body(id), before); assert.equal((await archives()).length, count);
  });
  await test("rename preserves body IDs and custom attributes", async () => {
    const id = await create(), block = (await children(id))[0].id;
    await call(admin, "siyuan_set_attrs", { id: block, attrs: { "custom-safety": "keep" } });
    const before = await body(id), count = (await archives()).length;
    const result = await call(standard, "siyuan_rename_document", { id, title: "Renamed 中文🙂" });
    const withoutRoot = (md) => md.split("\n").filter((line) => !line.startsWith(`{: id="${id}"`)).join("\n");
    assert.equal(withoutRoot(await body(id)), withoutRoot(before));
    assert.equal(result.verification, "passed"); assert.equal(result.data.requiresRefresh, false);
    assert.equal((await archives()).length, count);
  });
  await test("wrong target types, missing IDs and readonly permissions", async () => {
    const id = await create(), block = (await children(id))[0].id, before = await body(id);
    await call(admin, "siyuan_rename_document", { id: block, title: "wrong" }, "TARGET_TYPE_MISMATCH");
    await call(admin, "siyuan_replace_document_body", { id: block, markdown: "wrong" }, "TARGET_TYPE_MISMATCH");
    await call(standard, "siyuan_update_block", { id: "20200101000000-missing", markdown: "wrong" }, "TARGET_NOT_FOUND");
    await call(readonly, "siyuan_append_block", { parent: id, markdown: "wrong" }, "PERMISSION_DENIED");
    await call(standard, "siyuan_replace_document_body", { id, markdown: "wrong" }, "PERMISSION_DENIED");
    assert.equal(await body(id), before);
  });
  await test("schema and missing tools never become fallback execution", async () => {
    const id = await create(), before = await body(id);
    await call(standard, "siyuan_append_block", { parent: id, file: "bypass.md" }, "SCHEMA");
    await call(standard, "siyuan_patch_blocks", { operations: [{ op: "append", parent: id, markdown: "wrong" }] }, "SCHEMA");
    await call(standard, "siyuan_patch_blocks", { documentId: id, operations: Array.from({ length: 21 }, () => ({ op: "append", parent: id, markdown: "wrong" })) }, "SCHEMA");
    await call(standard, "siyuan_execute_http", { url: "http://127.0.0.1/unused" }, "SCHEMA");
    assert.equal(await body(id), before);
  });
  await test("cross-document and previous sibling scope rejected", async () => {
    const id = await create(), other = await create(), block = (await children(other))[0].id, before = await body(id);
    await call(standard, "siyuan_patch_blocks", { documentId: id, operations: [{ op: "update", id: block, markdown: "wrong" }] }, "TARGET_NOT_FOUND");
    await call(standard, "siyuan_insert_block", { parent: id, previous: block, markdown: "wrong" }, "DOCUMENT_SCOPE_MISMATCH");
    assert.equal(await body(id), before);
  });
  await test("duplicate and ancestor dependencies rejected before any step", async () => {
    const id = await create("- Parent\n  - Child"), list = (await children(id))[0].id, descendants = (await children(list)), child = descendants[0].id, before = await body(id);
    for (const operations of [[{ op: "delete", id: list }, { op: "update", id: child, markdown: "wrong" }], [{ op: "update", id: child, markdown: "wrong" }, { op: "delete", id: list }], [{ op: "delete", id: child }, { op: "delete", id: child }]]) {
      await call(standard, "siyuan_patch_blocks", { documentId: id, operations }, "CONFLICTING_OPERATIONS");
    }
    assert.equal(await body(id), before);
  });
  await test("append/insert need no recovery archive", async () => {
    const id = await create(), block = (await children(id))[0].id, count = (await archives()).length;
    await call(standard, "siyuan_append_block", { parent: id, markdown: "Append one\n\nAppend two" });
    await call(standard, "siyuan_insert_block", { parent: id, previous: block, markdown: "Inserted 🙂" });
    assert.equal((await archives()).length, count); assert.match(await body(id), /Inserted 🙂/);
  });
  await test("current incompatible export blocks all destructive paths before changing content", async () => {
    const id = await create(), block = (await children(id))[0].id, before = await body(id);
    for (const [name, args] of [
      ["siyuan_update_block", {id:block,markdown:"wrong"}],
      ["siyuan_patch_blocks", {documentId:id,operations:[{op:"append",parent:id,markdown:"wrong"},{op:"delete",id:block}]}],
      ["siyuan_replace_document_body", {id,markdown:"wrong"}],
      ["siyuan_delete_block", {id:block}],
      ["siyuan_remove_document", {id}]
    ]) {
      await call(admin,name,args,"BACKUP_FAILED");
      assert.equal(await body(id),before);
    }
  });
  for (const [label, markdown] of [["paragraph and formulas", "中文🙂 $\\sqrt{x}+\\bar{x}$"], ["fenced code", "```cmake\nset(X \"${VALUE}\")\n```"], ["single nested list item", "- Parent changed\n  - Child changed"]]) {
    await test(`single-block update: ${label}`, async () => {
      const id = await create(), block = (await children(id))[0].id, count = (await archives()).length;
      const result = await call(standard, "siyuan_update_block", { id: block, markdown });
      assert.equal(result.verification, "passed"); assert.equal(result.data.requiresRefresh, false); assert.equal((await archives()).length, count + 1);
      assert.ok(result.recovery.archive); return { recovery: result.recovery };
    });
  }
  await test("independent mixed batch uses one backup and one verification", async () => {
    const id = await create(), blocks = await children(id), count = (await archives()).length;
    const result = await call(standard, "siyuan_patch_blocks", { documentId: id, operations: [{ op: "update", id: blocks[0].id, markdown: "Updated" }, { op: "delete", id: blocks[1].id }, { op: "append", parent: id, markdown: "Appended" }] });
    assert.equal(result.data.appliedCount, 3); assert.equal(result.verification, "passed"); assert.equal(result.data.requiresRefresh, false); assert.equal((await archives()).length, count + 1);
  });
  await test("20-operation limit succeeds without repeated full reads or backups", async () => {
    const id = await create(), count = (await archives()).length;
    const result = await call(standard, "siyuan_patch_blocks", { documentId: id, operations: Array.from({ length: 20 }, (_, i) => ({ op: "append", parent: id, markdown: `Item ${i}` })) });
    assert.equal(result.data.appliedCount, 20); assert.equal(result.verification, "not-required"); assert.equal((await archives()).length, count); assert.equal((await children(id)).length, 22);
  });
  for (const [label, markdown] of [["empty body", ""], ["nested lists and code", "## 标题\n\n正文🙂 $x$\n\n- Parent\n  - Child\n\n```js\nconst x = '$value';\n```"], ["table and blockquote", "| A | B |\n| --- | --- |\n| 中文 | 🙂 |\n\n> Quoted paragraph"]]) {
    await test(`whole replacement: ${label}`, async () => {
      const id = await create(), count = (await archives()).length;
      const result = await call(admin, "siyuan_replace_document_body", { id, markdown });
      assert.equal(result.verification, "passed"); assert.equal(result.data.requiresRefresh, false); assert.equal((await archives()).length, count + 1);
      assert.equal(normalizeMarkdown(await body(id)), normalizeMarkdown(markdown));
    });
  }
  await test("full storage/attributes cannot bypass standard write permission", async () => {
    const safeFull = await connect("full", true, false), id = await create();
    await call(safeFull, "siyuan_set_attrs", { id, attrs: { title: "wrong" } }, "RESERVED_ATTRIBUTE");
    await call(safeFull, "siyuan_file_write", { path: "data/unused.sy", file: "unused.sy" }, "PERMISSION_DENIED");
    await call(safeFull, "siyuan_import_sy", { file: "unused.zip", notebook }, "PERMISSION_DENIED");
    await call(safeFull, "siyuan_sync_pull", {}, "PERMISSION_DENIED");
  });
  await test("independent dangerous block and document deletion create backups", async () => {
    const id = await create(), block = (await children(id))[0].id, count = (await archives()).length;
    assert.ok((await call(admin, "siyuan_delete_block", { id: block })).recovery.archive);
    assert.ok(!(await children(id)).some((b) => b.id === block));
    assert.ok((await call(admin, "siyuan_remove_document", { id })).recovery.archive);
    assert.equal((await archives()).length, count + 2);
  });
  await test("serialized concurrent calls preserve both appends", async () => {
    const id = await create();
    await Promise.all([call(standard, "siyuan_append_block", { parent: id, markdown: "Concurrent A" }), call(standard, "siyuan_append_block", { parent: id, markdown: "Concurrent B" })]);
    const markdown = await body(id); assert.match(markdown, /Concurrent A/); assert.match(markdown, /Concurrent B/);
  });
  await test("document recovery archive can be imported after deletion in disposable notebook", async () => {
    const id = await create("Recovery 中文🙂\n\n- Original item"), block = (await children(id))[0].id;
    await call(admin, "siyuan_set_attrs", { id: block, attrs: { "custom-recovery": "preserve" } });
    const before = await body(id);
    const title = (await call(admin, "siyuan_get_block", { id })).data.ial.title;
    const removed = await call(admin, "siyuan_remove_document", { id });
    await call(admin, "siyuan_import_sy", { file: removed.recovery.archive, notebook });
    const found = (await call(admin, "siyuan_document_search", { keyword: title })).data;
    assert.equal(found.length, 1);
    const restoredId = path.basename(found[0].path, ".sy");
    assert.equal(normalizeMarkdown(await body(restoredId)), normalizeMarkdown(before));
    const restoredBlocks = await children(restoredId);
    const restored = (await call(admin, "siyuan_get_block", { id: restoredBlocks[0].id })).data;
    assert.equal(restored.ial["custom-recovery"], "preserve");
    return { originalId: id, restoredId, preservedDocumentId: id === restoredId, preservedFirstBlockId: block === restoredBlocks[0].id };
  });
  await test("audit contains intent/result/rejection with Markdown redacted", async () => {
    const entries = (await readFile(path.join(logDir, "writes.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    for (const phase of ["intent", "result", "rejected"]) assert.ok(entries.some((entry) => entry.input.auditPhase === phase));
    for (const entry of entries) if (entry.input.markdown) assert.equal(entry.input.markdown.redacted, true);
    return { entries: entries.length, archives: (await archives()).length };
  });
} catch (error) { report.fatal = String(error.stack || error); }
finally {
  for (const client of clients.reverse()) await client.close().catch(() => {});
  kernel.kill();
  report.finishedAt = new Date().toISOString();
  report.passed = !report.fatal && report.cases.length > 0 && report.cases.every((c) => c.passed);
  const directory = path.join(root, ".siyuan-mcp/test-reports"); await mkdir(directory, { recursive: true });
  const file = path.join(directory, `safety-${Date.now()}.json`); await writeFile(file, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, passedCount: report.cases.filter(c=>c.passed).length, blockedCount: report.cases.filter(c=>c.blocked).length, failures: report.cases.filter((c) => !c.passed && !c.blocked).map((c) => ({ name: c.name, error: c.error })), fatal: report.fatal, reportFile: file, workspace }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
