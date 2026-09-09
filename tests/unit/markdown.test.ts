import { describe, expect, it } from "vitest";
import { SiyuanCli } from "../../src/cli/client.js";
import { isSingleBlockMarkdown, validateWritableMarkdown } from "../../src/markdown/validate.js";
import { textResult } from "../../src/mcp/results.js";

import { baseConfig } from "../helpers/tools.js";

describe("Markdown formula transport", () => {
  it("preserves logical KaTeX through JSON, normalized results, and CLI arguments", async () => {
    const formula = "$\\sqrt{x}+\\bar{x}+\\mathrm{m}$";
    const decoded = JSON.parse(JSON.stringify({ markdown: formula })).markdown;
    let forwarded = "";
    const cli = new SiyuanCli(baseConfig, async (_file, args) => {
      forwarded = args[args.indexOf("--data") + 1];
      return { stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false };
    });

    await cli.run("block_append", ["block", "append", "--parent", "doc", "--data", decoded]);
    const result = textResult({ ok: true, data: { markdown: decoded } });
    const textMarkdown = JSON.parse((result.content[0] as { text: string }).text).data.markdown;

    expect(decoded).toBe(formula);
    expect(forwarded).toBe(formula);
    expect((result.structuredContent?.data as { markdown: string }).markdown).toBe(formula);
    expect(textMarkdown).toBe(formula);
  });

  it("detects source-string escape damage without rewriting Markdown", () => {
    expect(validateWritableMarkdown("$\\sqrt{x}+\\bar{x}+\\mathrm{m}$")).toEqual([]);
    expect(validateWritableMarkdown("$sqrt{x}+bar{x}+mathrm{m}$")).toEqual([
      expect.stringContaining("likely bare KaTeX command")
    ]);
    expect(validateWritableMarkdown(`$${String.fromCharCode(8)}ar{x}$`)).toEqual(
      expect.arrayContaining([expect.stringContaining("U+0008"), expect.stringContaining("inline formula")])
    );
    expect(validateWritableMarkdown(`$${String.fromCharCode(13)}m{x}$`)).toEqual(
      expect.arrayContaining([expect.stringContaining("standalone carriage return")])
    );
  });

  it("ignores dollar signs in fenced, indented, and inline code", () => {
    const samples = [
      [
        "```cmake",
        "file(GLOB C_SOURCES CONFIGURE_DEPENDS",
        "    \"${CMAKE_CURRENT_SOURCE_DIR}/c/*.c\"",
        ")",
        "add_executable(\"c_${name}\" \"${source}\")",
        "```"
      ].join("\n"),
      ["~~~bash", "echo \"${HOME}\"", "echo \"$PATH\"", "~~~"].join("\n"),
      ["```powershell", "$env:QTDIR = \"C:\\Qt\"", "Write-Output $env:QTDIR", "```"].join("\n"),
      ["```javascript", "const message = `${name}: ${value}`;", "```"].join("\n"),
      "使用 `${sourceDir}` 表示源码目录。",
      "使用 ```${sourceDir} and `code` `` 表示示例。",
      ["    echo \"${HOME}\"", "    echo \"$PATH\""].join("\n"),
      ["````markdown", "```cmake", "message(\"${PROJECT_SOURCE_DIR}\")", "```", "````"].join("\n"),
      ["```cmake\r\n", "message(\"${PROJECT_SOURCE_DIR}\")\r\n", "```\r\n"].join(""),
      ["前置 emoji 🙂", "```cmake", "message(\"${PROJECT_SOURCE_DIR}\")", "```"].join("\n")
    ];

    for (const markdown of samples) {
      expect(validateWritableMarkdown(markdown), markdown).toEqual([]);
    }
  });

  it("still validates formulas outside code while allowing formula-like code", () => {
    const markdown = [
      "```text",
      "$sqrt{x}+bar{x}+mathrm{m}$",
      "```",
      "",
      "正确公式：$\\sqrt{x}+\\bar{x}+\\mathrm{m}$"
    ].join("\n");

    expect(validateWritableMarkdown(markdown)).toEqual([]);
    expect(validateWritableMarkdown("错误公式：$sqrt{x}+bar{x}+mathrm{m}$")).toEqual([
      expect.stringContaining("likely bare KaTeX command")
    ]);
  });

  it("does not pair inline formula delimiters across line breaks", () => {
    expect(validateWritableMarkdown("${FIRST_VALUE}\n普通文本\n${SECOND_VALUE}")).toEqual([]);
  });
});

describe("markdown block update guards", () => {
  it("allows single-block markdown", () => {
    expect(isSingleBlockMarkdown("one paragraph")).toBe(true);
    expect(isSingleBlockMarkdown("## Heading")).toBe(true);
    expect(isSingleBlockMarkdown("- one\n  - nested one\n  - nested two")).toBe(true);
    expect(isSingleBlockMarkdown("```text\n- not a list item\n- still code\n```")).toBe(true);
  });

  it("rejects multi-block markdown for block update", () => {
    expect(isSingleBlockMarkdown("paragraph one\n\nparagraph two")).toBe(false);
    expect(isSingleBlockMarkdown("## Heading\n\nbody")).toBe(false);
    expect(isSingleBlockMarkdown("## Heading\nbody")).toBe(false);
    expect(isSingleBlockMarkdown("- one\n- two")).toBe(false);
    expect(isSingleBlockMarkdown("1. one\n2. two")).toBe(false);
  });
});
