import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SiyuanCli } from "../../src/cli/client.js";
import { replaceDocumentBodyDirectly } from "../../src/operations/replaceDocumentBody.js";

import { baseConfig } from "../helpers/tools.js";

describe("document body replacement", () => {
  it("deletes the initial IDs, appends once, and removes SiYuan's generated placeholder", async () => {
    const calls: string[][] = [];
    let childrenCall = 0;
    const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-mcp-test-"));
    const markdown = "# 中文标题\n\n正文🙂\n\n" + "长文本".repeat(4_000);
    const cli = new SiyuanCli(
      { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
      async (_file, args) => {
        if (args.includes("sql")) return { stdout: JSON.stringify([{id:"20260908154051-h3ysj72",root_id:"20260908154051-h3ysj72",parent_id:"",type:"d",markdown:"",ial:"",updated:""}]), stderr:"",exitCode:0,timedOut:false };
        if (args.includes("kramdown")) return {stdout: markdown,stderr:"",exitCode:0,timedOut:false};
        calls.push(args);
        if (args.includes("children")) {
          childrenCall += 1;
          return {
            stdout: JSON.stringify(
              childrenCall === 1
                ? [{ id: "20260908154051-firstaa" }, { id: "20260908154051-seconda" }]
                : [{ id: "20260908154051-placeho", type: "p", content: "", markdown: "" }]
            ),
            stderr: "",
            exitCode: 0,
            timedOut: false
          };
        }
        return { stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false };
      }
    );

    try {
      const result = await replaceDocumentBodyDirectly(
        { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
        cli,
        "20260908154051-h3ysj72",
        markdown
      );

      expect(result).toMatchObject({
        ok: true,
        command: "document_replace_body",
        data: { deletedCount: 2, appended: true, placeholderCleanupComplete: true, requiresRefresh: false }
      });
      expect(calls.filter((args) => args.includes("children"))).toHaveLength(2);
      expect(calls.filter((args) => args.includes("delete")).map((args) => args.at(-1))).toEqual([
        "20260908154051-seconda",
        "20260908154051-firstaa",
        "20260908154051-placeho"
      ]);
      const appendCalls = calls.filter((args) => args.includes("append"));
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]).toContain(markdown);
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it("keeps a successful replacement and reports a placeholder cleanup failure", async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-mcp-test-"));
    let childrenCall = 0;
    const cli = new SiyuanCli(
      { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
      async (_file, args) => {
        if (args.includes("sql")) return { stdout: JSON.stringify([{id:"20260908154051-h3ysj72",root_id:"20260908154051-h3ysj72",parent_id:"",type:"d",markdown:"",ial:"",updated:""}]), stderr:"",exitCode:0,timedOut:false };
        if (args.includes("kramdown")) return {stdout: "replacement",stderr:"",exitCode:0,timedOut:false};
        if (args.includes("children")) {
          childrenCall += 1;
          return {
            stdout: JSON.stringify(childrenCall === 1 ? [{ id: "20260908154051-oldaaaa" }] : [{ id: "20260908154051-placeho", type: "p", content: "", markdown: "" }]),
            stderr: "",
            exitCode: 0,
            timedOut: false
          };
        }
        if (args.includes("20260908154051-placeho")) {
          return { stdout: "", stderr: "cleanup failed", exitCode: 1, timedOut: false };
        }
        return { stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false };
      }
    );

    try {
      const result = await replaceDocumentBodyDirectly(
        { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
        cli,
        "20260908154051-h3ysj72",
        "replacement"
      );

      expect(result).toMatchObject({
        ok: true,
        warnings: expect.arrayContaining([expect.stringContaining("placeholder could not be removed")]),
        data: { appended: true, placeholderCleanupComplete: false }
      });
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it("does not delete the generated placeholder when appending the replacement fails", async () => {
    const calls: string[][] = [];
    const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-mcp-test-"));
    let childrenCall = 0;
    const cli = new SiyuanCli(
      { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
      async (_file, args) => {
        if (args.includes("sql")) return { stdout: JSON.stringify([{id:"20260908154051-h3ysj72",root_id:"20260908154051-h3ysj72",parent_id:"",type:"d",markdown:"",ial:"",updated:""}]), stderr:"",exitCode:0,timedOut:false };
        if (args.includes("kramdown")) return {stdout: "replacement",stderr:"",exitCode:0,timedOut:false};
        calls.push(args);
        if (args.includes("children")) {
          childrenCall += 1;
          return {
            stdout: JSON.stringify(childrenCall === 1 ? [{ id: "20260908154051-oldaaaa" }] : [{ id: "20260908154051-placeho", type: "p", content: "", markdown: "" }]),
            stderr: "",
            exitCode: 0,
            timedOut: false
          };
        }
        if (args.includes("append")) {
          return { stdout: "", stderr: "append failed", exitCode: 1, timedOut: false };
        }
        return { stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false };
      }
    );

    try {
      const result = await replaceDocumentBodyDirectly(
        { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
        cli,
        "20260908154051-h3ysj72",
        "replacement"
      );

      expect(result).toMatchObject({ ok: false, data: { appended: false } });
      expect(calls.filter((args) => args.includes("delete")).map((args) => args.at(-1))).toEqual(["20260908154051-oldaaaa"]);
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it("stops after a delete failure and reports the partial result without appending", async () => {
    const calls: string[][] = [];
    const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-mcp-test-"));
    const cli = new SiyuanCli(
      { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
      async (_file, args) => {
        if (args.includes("sql")) return { stdout: JSON.stringify([{id:"20260908154051-h3ysj72",root_id:"20260908154051-h3ysj72",parent_id:"",type:"d",markdown:"",ial:"",updated:""}]), stderr:"",exitCode:0,timedOut:false };
        if (args.includes("kramdown")) return {stdout: "replacement",stderr:"",exitCode:0,timedOut:false};
        calls.push(args);
        if (args.includes("children")) {
          return { stdout: JSON.stringify([{ id: "20260908154051-firstaa" }, { id: "20260908154051-seconda" }]), stderr: "", exitCode: 0, timedOut: false };
        }
        if (args.includes("20260908154051-firstaa")) {
          return { stdout: "", stderr: "delete failed", exitCode: 1, timedOut: false };
        }
        return { stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false };
      }
    );

    try {
      const result = await replaceDocumentBodyDirectly(
        { ...baseConfig, allowWrite: true, allowDangerous: true, toolProfile: "standard", logDir },
        cli,
        "20260908154051-h3ysj72",
        "replacement"
      );

      expect(result).toMatchObject({
        ok: false,
        data: { deletedCount: 1, failedId: "20260908154051-firstaa", appended: false, requiresRefresh: true }
      });
      expect(calls.some((args) => args.includes("append"))).toBe(false);
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});
