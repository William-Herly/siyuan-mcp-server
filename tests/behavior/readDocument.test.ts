import { describe, expect, it } from "vitest";
import { SiyuanCli } from "../../src/cli/client.js";
import { documentInfoWithFallback, documentKramdownWithAssets, outlineWithEmptyFallback } from "../../src/operations/readDocument.js";

import { baseConfig } from "../helpers/tools.js";

describe("read tool fallbacks", () => {
  it("returns an empty outline for documents with no headings", async () => {
    const cli = new SiyuanCli(
      {
        ...baseConfig,
        workspace: "E:\\SiYuan Data",
        cliPath: "siyuan"
      },
      async () => ({
        stdout: "Error: document not found or has no headings\nUsage:\n  siyuan outline get",
        stderr: "",
        exitCode: 1,
        timedOut: false
      })
    );

    const result = await outlineWithEmptyFallback(cli, "doc1");

    expect(result).toMatchObject({
      ok: true,
      data: [],
      warnings: [],
      command: "outline_get"
    });
  });

  it("keeps document info fallback warnings compact", async () => {
    let call = 0;
    const cli = new SiyuanCli(
      {
        ...baseConfig,
        workspace: "E:\\SiYuan Data",
        cliPath: "siyuan"
      },
      async () => {
        call += 1;
        if (call === 1) {
          return {
            stdout: "Error: open E:\\SiYuan Data\\data\\box\\docid: The system cannot find the file specified.\nUsage:\n  siyuan document info --id <id>",
            stderr: "",
            exitCode: 1,
            timedOut: false
          };
        }

        return {
          stdout: JSON.stringify({ id: "docid", path: "/docid.sy" }),
          stderr: "",
          exitCode: 0,
          timedOut: false
        };
      }
    );

    const result = await documentInfoWithFallback(cli, "docid");

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("document info failed");
    expect(result.warnings[0]).toContain("The system cannot find the file specified");
    expect(result.warnings[0]).not.toContain("Usage:");
    expect(result.data).toMatchObject({
      fallback: "document_get",
      originalErrorSummary: expect.stringContaining("The system cannot find the file specified"),
      document: { id: "docid", path: "/docid.sy" }
    });
  });

  it("returns document kramdown with extracted assets", async () => {
    const cli = new SiyuanCli(
      {
        ...baseConfig,
        workspace: "E:\\SiYuan Data",
        cliPath: "siyuan"
      },
      async () => ({
        stdout: "# Doc\n\n![image](assets/image.png)\n\n[file](data/assets/file.pdf)",
        stderr: "",
        exitCode: 0,
        timedOut: false
      })
    );

    const result = await documentKramdownWithAssets(cli, "doc1", "md");

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      id: "doc1",
      mode: "md",
      markdown: expect.stringContaining("# Doc"),
      assets: ["assets/file.pdf", "assets/image.png"]
    });
  });
});
