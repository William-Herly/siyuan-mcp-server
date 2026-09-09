import { describe, expect, it } from "vitest";
import { SiyuanCli, type CliExecutor } from "../../src/cli/client.js";

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
});
