import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

assert.ok(process.env.SIYUAN_TEST_WORKSPACE, "Set SIYUAN_TEST_WORKSPACE to an isolated test workspace; no default workspace is allowed.");
assert.ok(process.env.SIYUAN_TEST_NOTEBOOK_ID, "Set SIYUAN_TEST_NOTEBOOK_ID explicitly; no automatic notebook selection is allowed.");
const testDangerous = process.env.SIYUAN_TEST_DANGEROUS === "true";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageVersion = packageJson.version;
assert.equal(typeof packageVersion, "string", "package.json version must be a string");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "");
const title = `MCP Standard Integration Test ${runId}`;
const dailyMarker = `MCP standard integration test ${runId}`;
const report = {
  runId,
  profile: "maintain (standard alias)",
  startedAt: new Date().toISOString(),
  tools: [],
  writes: {},
  stderr: []
};

const expectedTools = new Set([
  "siyuan_health",
  "siyuan_list_notebooks",
  "siyuan_search",
  "siyuan_document_list",
  "siyuan_get_document_kramdown",
  "siyuan_get_outline",
  "siyuan_get_block_kramdown",
  "siyuan_get_block_children",
  "siyuan_batch_get_kramdown",
  "siyuan_block_breadcrumb",
  "siyuan_get_backlinks",
  "siyuan_create_document",
  "siyuan_rename_document",
  "siyuan_append_block",
  "siyuan_insert_block",
  "siyuan_update_block",
  "siyuan_patch_blocks",
  "siyuan_replace_document_body",
  "siyuan_append_daily_note",
  "siyuan_document_info",
  "siyuan_document_search",
  "siyuan_get_block",
  "siyuan_batch_get_blocks",
  "siyuan_block_stat"
]);

const env = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
env.SIYUAN_MCP_PROFILE = "maintain";
env.SIYUAN_MCP_ALLOW_WRITE = "true";
env.SIYUAN_MCP_ALLOW_DANGEROUS = String(testDangerous);
if (process.env.SIYUAN_TEST_WORKSPACE) {
  env.SIYUAN_MCP_WORKSPACE = process.env.SIYUAN_TEST_WORKSPACE;
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist", "index.js")],
  cwd: root,
  env,
  stderr: "pipe"
});
transport.stderr?.on("data", (chunk) => report.stderr.push(String(chunk).trim()));

const client = new Client({ name: "siyuan-standard-integration-test", version: "1.0.0" });

function normalizedResult(result) {
  assert.equal(result.isError, result.structuredContent?.ok === false ? true : undefined, "MCP error flag disagrees with execution result");
  assert.ok(result.structuredContent && typeof result.structuredContent === "object", "Missing structuredContent");
  const textBlock = result.content?.find((item) => item.type === "text");
  assert.ok(textBlock, "Missing text compatibility result");
  assert.deepEqual(JSON.parse(textBlock.text), result.structuredContent, "Text and structured results differ");
  return result.structuredContent;
}

async function call(name, args = {}, expectFailure = false) {
  const started = performance.now();
  const result = normalizedResult(await client.callTool({ name, arguments: args }));
  const elapsedMs = Math.round(performance.now() - started);
  report.tools.push({ name, ok: result.ok === !expectFailure, elapsedMs, warnings: result.warnings ?? [] });
  assert.equal(result.ok, !expectFailure, `${name} failed: ${JSON.stringify(result.warnings ?? result.raw ?? result)}`);
  return result;
}

function findId(value) {
  if (typeof value === "string" && /^\d{14}-[a-z0-9]{7}$/i.test(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findId(item);
      if (id) return id;
    }
  }
  if (value && typeof value === "object") {
    if (typeof value.id === "string" && /^\d{14}-[a-z0-9]{7}$/i.test(value.id)) return value.id;
    for (const child of Object.values(value)) {
      const id = findId(child);
      if (id) return id;
    }
  }
  return undefined;
}

function collectIds(value, output = new Set()) {
  if (typeof value === "string" && /^\d{14}-[a-z0-9]{7}$/i.test(value)) output.add(value);
  if (Array.isArray(value)) value.forEach((item) => collectIds(item, output));
  if (value && typeof value === "object") {
    if (typeof value.id === "string" && /^\d{14}-[a-z0-9]{7}$/i.test(value.id)) output.add(value.id);
    Object.values(value).forEach((item) => collectIds(item, output));
  }
  return [...output];
}

function newlyAdded(before, after) {
  const known = new Set(before);
  return after.filter((id) => !known.has(id));
}

async function saveReport() {
  report.finishedAt = new Date().toISOString();
  report.passed = report.tools.every((item) => item.ok);
  const directory = path.join(root, ".siyuan-mcp", "test-reports");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `standard-${runId}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

let reportFile;
try {
  await client.connect(transport);
  assert.match(client.getInstructions() ?? "", /SiYuan\/思源笔记/);
  assert.equal(client.getServerVersion()?.version, packageVersion);

  const listed = await client.listTools();
  const actualTools = new Set(listed.tools.map((tool) => tool.name));
  assert.deepEqual([...actualTools].sort(), [...expectedTools].sort(), "Standard tool exposure mismatch");
  report.exposedTools = [...actualTools].sort();

  const health = await call("siyuan_health");
  assert.equal(health.data.toolProfile, "standard");
  assert.equal(health.data.permissionMode, testDangerous ? "dangerous" : "safe-write");

  const notebooks = await call("siyuan_list_notebooks");
  const notebookList = Array.isArray(notebooks.data) ? notebooks.data : notebooks.data?.notebooks;
  assert.ok(Array.isArray(notebookList) && notebookList.length > 0, "No open notebook available for integration testing");
  const notebook = notebookList.find((item) => item.id === process.env.SIYUAN_TEST_NOTEBOOK_ID);
  assert.ok(notebook, "Requested test notebook was not found");
  report.notebook = { id: notebook.id, name: notebook.name };

  const initialMarkdown = [
    "## 初始章节",
    "",
    "中文与 emoji 🙂 integration baseline.",
    "",
    "- parent item",
    "  - nested item",
    "",
    "## 第二章节",
    "",
    "A paragraph for block operations."
  ].join("\n");
  const created = await call("siyuan_create_document", { notebook: notebook.id, title, markdown: initialMarkdown });
  const documentId = findId(created.data ?? created.raw);
  assert.ok(documentId, `Could not extract created document ID: ${JSON.stringify(created)}`);
  report.writes.testDocument = { id: documentId, title };

  await call("siyuan_document_list", { notebook: notebook.id });
  await call("siyuan_search", { query: title, page: 1, pageSize: 20 });
  await call("siyuan_document_search", { keyword: title });
  await call("siyuan_document_info", { id: documentId });
  const initialDocument = await call("siyuan_get_document_kramdown", { id: documentId, mode: "md" });
  assert.match(initialDocument.data.markdown, /中文与 emoji/);
  const beforeRename = await call("siyuan_get_document_kramdown", { id: documentId });
  const renamed = await call("siyuan_rename_document", { id: documentId, title: title + " renamed" });
  assert.equal(renamed.verification, "passed");
  const afterRename = await call("siyuan_get_document_kramdown", { id: documentId });
  // Root IAL carries the title; preserve the full body including child IDs.
  const body = (value) => value.split("\n").filter((line) => !line.startsWith('{: id="' + documentId + '"')).join("\n").trim();
  assert.equal(body(afterRename.data.markdown), body(beforeRename.data.markdown));
  const rootGuard = await call("siyuan_update_block", { id: documentId, markdown: "must never replace body" }, true);
  assert.equal(rootGuard.code, "TARGET_TYPE_MISMATCH");
  const patchRootGuard = await call("siyuan_patch_blocks", { documentId, operations: [{ op: "delete", id: documentId }] }, true);
  assert.equal(patchRootGuard.code, "TARGET_TYPE_MISMATCH");
  await call("siyuan_get_outline", { id: documentId });
  await call("siyuan_get_block_kramdown", { id: documentId, mode: "md" });
  let children = await call("siyuan_get_block_children", { id: documentId });
  let childIds = collectIds(children.data);
  assert.ok(childIds.length > 0, "Created document has no child blocks");
  await call("siyuan_block_breadcrumb", { id: childIds[0] });
  await call("siyuan_get_backlinks", { id: documentId });
  await call("siyuan_get_block", { id: childIds[0] });
  await call("siyuan_batch_get_blocks", { ids: [documentId, childIds[0]] });
  await call("siyuan_batch_get_kramdown", { ids: [documentId, childIds[0]] });
  await call("siyuan_block_stat", { id: documentId });

  const beforeAppend = childIds;
  await call("siyuan_append_block", { parent: documentId, markdown: "Appended paragraph.\n\n第二个追加段落。" });
  children = await call("siyuan_get_block_children", { id: documentId });
  childIds = collectIds(children.data);
  assert.ok(newlyAdded(beforeAppend, childIds).length >= 1, "Append did not add a child block");

  const beforeInsert = childIds;
  await call("siyuan_insert_block", { parent: documentId, markdown: "Inserted paragraph for update." });
  children = await call("siyuan_get_block_children", { id: documentId });
  childIds = collectIds(children.data);
  const insertedIds = newlyAdded(beforeInsert, childIds);
  assert.ok(insertedIds.length >= 1, "Insert did not add a child block");
  await call("siyuan_update_block", { id: insertedIds[0], markdown: "Updated single paragraph 中文🙂." });

  children = await call("siyuan_get_block_children", { id: documentId });
  childIds = collectIds(children.data);
  const beforeDisposable = childIds;
  await call("siyuan_append_block", { parent: documentId, markdown: "Disposable patch target." });
  children = await call("siyuan_get_block_children", { id: documentId });
  childIds = collectIds(children.data);
  const disposableId = newlyAdded(beforeDisposable, childIds)[0];
  assert.ok(disposableId, "Could not identify disposable patch target");
  const updateTarget = children.data.find((item) => item.type === "p" && item.id !== disposableId)?.id;
  assert.ok(updateTarget, "Could not select patch update target");
  const patched = await call("siyuan_patch_blocks", {
    documentId,
    operations: [
      { op: "delete", id: disposableId },
      { op: "append", parent: documentId, markdown: "Patch appended paragraph." },
      { op: "insert", parent: documentId, markdown: "Patch inserted paragraph." },
      { op: "update", id: updateTarget, markdown: "Patch updated single block." }
    ]
  });
  assert.equal(patched.data.appliedCount, 4);
  assert.equal(patched.verification, "passed");
  assert.equal(patched.data.requiresRefresh, false);

  const replacementMarkdown = [
    "## 最终测试结果",
    "",
    `Standard profile integration completed: ${runId}`,
    "",
    "- create, append, insert, update and patch passed",
    "- whole-body replacement passed",
    "- 中文与 emoji 🙂 preserved"
  ].join("\n");
  const replaced = await call("siyuan_replace_document_body", { id: documentId, markdown: replacementMarkdown }, !testDangerous);
  if (testDangerous) {
    assert.equal(replaced.data.appended, true);
    assert.equal(replaced.verification, "passed");
    assert.ok(replaced.recovery?.archive);
    const finalDocument = await call("siyuan_get_document_kramdown", { id: documentId, mode: "md" });
    assert.match(finalDocument.data.markdown, new RegExp(runId));
    assert.match(finalDocument.data.markdown, /中文与 emoji/);
  } else {
    assert.equal(replaced.code, "PERMISSION_DENIED");
  }

  const dailyMarkdown = `- ${dailyMarker}: standard tools passed; test document ((` + documentId + " 'integration test')).";
  await call("siyuan_append_daily_note", { notebook: notebook.id, markdown: dailyMarkdown });
  const dailySearch = await call("siyuan_search", { query: dailyMarker, page: 1, pageSize: 10 });
  assert.match(JSON.stringify(dailySearch.data), new RegExp(runId), "Daily-note marker was not found after append");
  report.writes.dailyNoteMarker = dailyMarker;

  const calledTools = new Set(report.tools.map((item) => item.name));
  assert.deepEqual([...calledTools].sort(), [...expectedTools].sort(), "Not every exposed standard tool was called");

  reportFile = await saveReport();
  process.stdout.write(`${JSON.stringify({ passed: true, toolCalls: report.tools.length, exposedTools: actualTools.size, documentId, title, dailyMarker, reportFile }, null, 2)}\n`);
} catch (error) {
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  reportFile = await saveReport();
  process.stderr.write(`${JSON.stringify({ passed: false, error: report.error, reportFile }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
