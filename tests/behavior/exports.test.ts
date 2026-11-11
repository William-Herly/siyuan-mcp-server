import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod/v4";
import { SiyuanCli } from "../../src/cli/client.js";
import { registerTools } from "../../src/mcp/registerTools.js";
import type { ToolRegistrar } from "../../src/mcp/register.js";
import { baseConfig } from "../helpers/tools.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function fixture(allowWrite = false, text = "/synthetic/archive.zip\n") {
  const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-export-test-"));
  directories.push(logDir);
  const config = { ...baseConfig, toolProfile: "full" as const, allowWrite, logDir };
  const calls: string[][] = [];
  const cli = new SiyuanCli(config, async (_file, args) => { calls.push(args); return { stdout: text, stderr: "", exitCode: 0, timedOut: false }; });
  const tools = new Map<string, { shape: Record<string, z.ZodType>; call: (args: never) => Promise<unknown> }>();
  const registrar: ToolRegistrar = { registerTool(name, definition, handler) { tools.set(name, { shape: definition.inputSchema ?? {}, call: handler as never }); } };
  registerTools(registrar, config, cli);
  return { calls, logDir, async call(name: string, args: unknown = {}) {
    const tool = tools.get(name)!;
    return await tool.call(z.object(tool.shape).parse(args) as never) as { structuredContent: Record<string, any>; isError?: boolean };
  } };
}

it.each(["siyuan_export_data", "siyuan_export_md_zip", "siyuan_repo_file_export"])("denies readonly artifact creation even without output: %s", async name => {
  const f = await fixture();
  expect(await f.call(name, { id: "synthetic" })).toMatchObject({ isError: true, structuredContent: { code: "PERMISSION_DENIED", execution: "not-started" } });
  expect(f.calls).toHaveLength(0);
});
it.each(["siyuan_export_data", "siyuan_export_md_zip", "siyuan_repo_file_export"])("audits artifact creation without output and returns a clean path: %s", async name => {
  const f = await fixture(true);
  expect(await f.call(name, { id: "synthetic" })).toMatchObject({ structuredContent: { ok: true, data: "/synthetic/archive.zip", execution: "applied", warnings: [] } });
  expect(f.calls).toHaveLength(1);
  const log = (await readFile(path.join(f.logDir, "writes.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(log.map(entry => entry.input.auditPhase)).toEqual(["intent", "result"]);
  expect(log[0].requestId).toBe(log[1].requestId);
  expect(log[1].execution).toBe("applied");
});
it("keeps Markdown output read-only and preserves its whitespace", async () => {
  const markdown = "    code  \n\n";
  const f = await fixture(false, markdown);
  expect(await f.call("siyuan_export_md", { id: "synthetic" })).toMatchObject({ structuredContent: { ok: true, data: markdown } });
  expect(f.calls).toHaveLength(1);
  expect(await f.call("siyuan_export_md", { id: "synthetic", output: "/synthetic/output.md" })).toMatchObject({ structuredContent: { code: "PERMISSION_DENIED" } });
  expect(f.calls).toHaveLength(1);
});
it("retains the unsupported sy export name without invoking the CLI", async () => {
  const f = await fixture(true);
  expect(await f.call("siyuan_export_sy", { id: "synthetic" })).toMatchObject({ structuredContent: { ok: false, code: "UNSUPPORTED_CAPABILITY", execution: "not-started" } });
  expect(f.calls).toHaveLength(0);
});
it("aligns the public SQL limit with the backend row cap", async () => {
  const f = await fixture(false, "[]");
  expect(await f.call("siyuan_sql_select", { sql: "SELECT id FROM blocks", limit: 1000 })).toMatchObject({ structuredContent: { ok: true } });
  const args = f.calls[0];
  expect(args[args.indexOf("--limit") + 1]).toBe("1000");
  expect(args.at(-1)).toMatch(/LIMIT 1000$/);
});
