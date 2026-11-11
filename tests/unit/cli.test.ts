import { describe, expect, it } from "vitest";
import { execute, MAX_CLI_OUTPUT_BYTES, SiyuanCli, type CliExecutor } from "../../src/cli/client.js";

import { baseConfig } from "../helpers/tools.js";

describe("SiyuanCli", () => {
  it("builds common args with workspace and json format", () => {
    const cli = new SiyuanCli({
      ...baseConfig,
      workspace: "F:\\SiYuan",
      cliPath: "siyuan"
    });

    expect(cli.buildArgs(["notebook", "list"])).toEqual([
      "--workspace",
      "F:\\SiYuan",
      "--format",
      "json",
      "notebook",
      "list"
    ]);
  });

  it("auto-discovers workspace when none is configured", async () => {
    const calls: string[][] = [];
    const executor: CliExecutor = async (_file, args) => {
      calls.push(args);
      if (args.includes("workspace") && args.includes("info")) {
        return {
          stdout: JSON.stringify({ path: "E:\\SiYuan Data", valid: true, version: "3.7.0" }),
          stderr: "",
          exitCode: 0,
          timedOut: false
        };
      }

      return {
        stdout: JSON.stringify({ notebooks: [] }),
        stderr: "",
        exitCode: 0,
        timedOut: false
      };
    };
    const cli = new SiyuanCli(
      {
        ...baseConfig,
        cliPath: "siyuan",
        workspace: undefined
      },
      executor
    );

    const result = await cli.run("notebook_list", ["notebook", "list"]);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["--format", "json", "workspace", "info"],
      ["--workspace", "E:\\SiYuan Data", "--format", "json", "notebook", "list"]
    ]);
  });

  it("does not warn when text output is expected", async () => {
    const executor: CliExecutor = async () => ({
      stdout: "# Heading\n\nBody",
      stderr: "",
      exitCode: 0,
      timedOut: false
    });
    const cli = new SiyuanCli(
      {
        ...baseConfig,
        workspace: "E:\\SiYuan Data",
        cliPath: "siyuan"
      },
      executor
    );

    const result = await cli.run("block_kramdown", ["block", "kramdown", "--id", "20260706170000-abcdefg"], {
      output: "text"
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBe("# Heading\n\nBody");
    expect(result.warnings).toEqual([]);
    expect(result.raw).toBeUndefined();
  });

  it("does not warn for known plain success output", async () => {
    const cli = new SiyuanCli(
      {
        ...baseConfig,
        workspace: "E:\\SiYuan Data",
        cliPath: "siyuan"
      },
      async () => ({
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
        timedOut: false
      })
    );

    const result = await cli.run("block_append", ["block", "append", "--parent", "doc1", "--data", "body"]);

    expect(result).toMatchObject({
      ok: true,
      data: "ok",
      warnings: []
    });
    expect(result.raw).toBeUndefined();
  });

  it("does not warn for id-like plain success output", async () => {
    const cli = new SiyuanCli(
      {
        ...baseConfig,
        workspace: "E:\\SiYuan Data",
        cliPath: "siyuan"
      },
      async () => ({
        stdout: "20260707105057-gml3uim\n",
        stderr: "",
        exitCode: 0,
        timedOut: false
      })
    );

    const result = await cli.run("document_create", ["document", "create", "--notebook", "nb", "--title", "Title"]);

    expect(result).toMatchObject({
      ok: true,
      data: "20260707105057-gml3uim",
      warnings: []
    });
  });
  it.each([
    { stdout: "", stderr: "discovery failed", exitCode: 1, timedOut: false },
    { stdout: "", stderr: "", exitCode: null, timedOut: true },
    { stdout: '{"path":"/synthetic","valid":false}', stderr: "", exitCode: 0, timedOut: false },
    { stdout: "invalid JSON", stderr: "", exitCode: 0, timedOut: false }
  ])("stops data commands and caches failed discovery: %j", async (failure) => {
    const calls: string[][] = [];
    const cli = new SiyuanCli({ ...baseConfig, workspace: undefined }, async (_file, args) => { calls.push(args); return failure; });
    expect(await cli.run("block_append", ["block", "append"])).toMatchObject({ ok: false, code: "WORKSPACE_UNAVAILABLE", execution: "not-started" });
    expect(await cli.run("notebook_list", ["notebook", "list"])).toMatchObject({ ok: false, code: "WORKSPACE_UNAVAILABLE" });
    expect(calls).toEqual([["--format", "json", "workspace", "info"]]);
  });
  it("passes an isolated home consistently and caches successful discovery", async () => {
    const calls: string[][] = [];
    const cli = new SiyuanCli({ ...baseConfig, workspace: undefined, homeDir: "/synthetic-home" }, async (_file, args) => {
      calls.push(args);
      return { stdout: JSON.stringify(args.includes("workspace") ? { path: "/synthetic-workspace", valid: true, version: "3.8.10" } : []), stderr: "", exitCode: 0, timedOut: false };
    });
    expect(cli.status()).toMatchObject({ workspaceStatus: "unknown", version: null });
    await cli.run("notebook_list", ["notebook", "list"]);
    await cli.run("notebook_list", ["notebook", "list"]);
    expect(calls).toHaveLength(3);
    expect(calls.every(args => args[0] === "--home-dir" && args[1] === "/synthetic-home")).toBe(true);
    expect(calls.slice(1).every(args => args.includes("/synthetic-workspace"))).toBe(true);
    expect(cli.status()).toMatchObject({ workspaceStatus: "resolved", version: "3.8.10", compatibility: "unverified" });
  });
  it("allows explicit workspace diagnostics to recover failed discovery", async () => {
    let discoveryCalls = 0;
    const calls: string[][] = [];
    const cli = new SiyuanCli({ ...baseConfig, workspace: undefined }, async (_file, args) => {
      calls.push(args);
      return { stdout: args.includes("workspace") ? JSON.stringify(++discoveryCalls === 1 ? {} : { path: "/synthetic-workspace", valid: true }) : "[]", stderr: "", exitCode: 0, timedOut: false };
    });
    expect((await cli.run("notebook_list", ["notebook", "list"])).ok).toBe(false);
    await cli.run("workspace_info", ["workspace", "info"]);
    expect((await cli.run("notebook_list", ["notebook", "list"])).ok).toBe(true);
    expect(calls.at(-1)).toContain("/synthetic-workspace");
  });
  it("keeps the resolved workspace pinned when a later diagnostic reports another path", async () => {
    let discoveryCalls = 0;
    const calls: string[][] = [];
    const cli = new SiyuanCli({ ...baseConfig, workspace: undefined }, async (_file, args) => {
      calls.push(args);
      return { stdout: args.includes("workspace") ? JSON.stringify({ path: ++discoveryCalls === 1 ? "/first-workspace" : "/second-workspace", valid: true }) : "[]", stderr: "", exitCode: 0, timedOut: false };
    });
    await cli.run("notebook_list", ["notebook", "list"]);
    await cli.run("workspace_info", ["workspace", "info"]);
    await cli.run("notebook_list", ["notebook", "list"]);
    expect(calls.at(-1)).toContain("/first-workspace");
    expect(calls.at(-1)).not.toContain("/second-workspace");
  });
  it("reports SQL truncation separately from command success", async () => {
    const cli = new SiyuanCli(baseConfig, async () => ({ stdout: "[]", stderr: "Results truncated to 100 rows; use LIMIT and OFFSET to paginate.", exitCode: 0, timedOut: false }));
    expect(await cli.run("sql_select", ["sql", "SELECT id FROM blocks"])).toMatchObject({ ok: true, truncated: true });
  });
  it("preserves all whitespace in explicitly requested text output", async () => {
    const markdown = "    code  \r\n\tsecond\n\n";
    const cli = new SiyuanCli(baseConfig, async () => ({ stdout: markdown, stderr: "", exitCode: 0, timedOut: false }));
    expect((await cli.run("block_kramdown", ["block", "kramdown"], { output: "text" })).data).toBe(markdown);
  });
  it("rejects partial process output instead of parsing it as a complete response", async () => {
    const cli = new SiyuanCli(baseConfig, async () => ({ stdout: "[]", stderr: "", exitCode: 0, timedOut: false, outputTruncated: true }));
    expect(await cli.run("notebook_list", ["notebook", "list"])).toMatchObject({ ok: false, code: "CLI_OUTPUT_LIMIT", truncated: true });
  });
  it("bounds stdout capture in a real synthetic child process", async () => {
    const result = await execute(process.execPath, ["-e", `process.stdout.write('x'.repeat(${MAX_CLI_OUTPUT_BYTES + 100_000}))`], 5000);
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(MAX_CLI_OUTPUT_BYTES);
  });
});
