import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeAuditInput } from "../src/audit.js";
import { SiyuanCli, type CliExecutor } from "../src/cli.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { runAuditedWrite, textResult } from "../src/toolHelpers.js";
import {
  buildBatchKramdownArgs,
  buildCreateDocumentArgs,
  buildDatabaseItemAddArgs,
  buildDatabaseItemUpdateArgs,
  buildDatabaseRenderArgs,
  buildDocumentListArgs,
  buildDocumentMoveArgs,
  buildHistoryListArgs,
  buildHistorySearchArgs,
  buildInsertBlockArgs,
  buildRepoListArgs,
  buildSearchArgs,
  buildSetAttrsArgs,
  createDocumentPathWarning,
  documentInfoWithFallback,
  documentKramdownWithAssets,
  extractAssetRefs,
  isSingleBlockMarkdown,
  normalizeCreateDocumentParentPath,
  normalizeDataRelativeAssetPath,
  normalizeWorkspacePath,
  outlineWithEmptyFallback,
  replaceDocumentBodyDirectly,
  registerTools,
  validateWritableMarkdown,
  withDryRun
} from "../src/tools.js";
import { SERVER_INSTRUCTIONS, SERVER_VERSION } from "../src/serverMetadata.js";

const baseConfig: ServerConfig = {
  workspace: "E:\\SiYuan Data",
  cliPath: "siyuan",
  allowWrite: false,
  allowDangerous: false,
  toolProfile: "minimal",
  logDir: "logs",
  timeoutMs: 30_000
};

function registeredToolNames(config: Partial<ServerConfig> = {}): string[] {
  const names: string[] = [];
  const server = {
    registerTool(name: string) {
      names.push(name);
    }
  };

  registerTools(server as never, { ...baseConfig, ...config });
  return names;
}

function registeredToolSchemas(config: Partial<ServerConfig> = {}): Map<string, Record<string, unknown>> {
  const schemas = new Map<string, Record<string, unknown>>();
  const server = {
    registerTool(name: string, meta: { inputSchema?: Record<string, unknown> }) {
      schemas.set(name, meta.inputSchema ?? {});
    }
  };

  registerTools(server as never, { ...baseConfig, ...config });
  return schemas;
}

function schemaDescription(schema: unknown): string | undefined {
  let current = schema as { description?: string; _def?: { innerType?: unknown } } | undefined;
  while (current) {
    if (typeof current.description === "string") {
      return current.description;
    }
    current = current._def?.innerType as typeof current;
  }
  return undefined;
}

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

describe("tool profiles", () => {
  it("defaults to the minimal tool profile", () => {
    expect(loadConfig({}).toolProfile).toBe("minimal");
    expect(loadConfig({ SIYUAN_MCP_PROFILE: "unknown" }).toolProfile).toBe("minimal");
    expect(loadConfig({ SIYUAN_MCP_PROFILE: "standard" }).toolProfile).toBe("standard");
    expect(loadConfig({ SIYUAN_MCP_PROFILE: "maintain" }).toolProfile).toBe("standard");
    expect(loadConfig({ SIYUAN_MCP_PROFILE: "note-maintain" }).toolProfile).toBe("standard");
    expect(loadConfig({ SIYUAN_MCP_PROFILE: "full" }).toolProfile).toBe("full");
    expect(loadConfig({ SIYUAN_MCP_PROFILE: "advanced" }).toolProfile).toBe("full");
    expect(loadConfig({ SIYUAN_MCP_PROFILE: "admin" }).toolProfile).toBe("full");
  });

  it("registers only the minimal read-only note tools by default", () => {
    const names = registeredToolNames();

    expect(names).toEqual([
      "siyuan_health",
      "siyuan_list_notebooks",
      "siyuan_search",
      "siyuan_get_document_kramdown",
      "siyuan_document_list",
      "siyuan_get_block_kramdown",
      "siyuan_get_block_children",
      "siyuan_block_breadcrumb",
      "siyuan_batch_get_kramdown",
      "siyuan_get_outline",
      "siyuan_get_backlinks"
    ]);
    expect(names).not.toContain("siyuan_append_block");
    expect(names).not.toContain("siyuan_move_document");
    expect(names).not.toContain("siyuan_delete_block");
  });

  it("registers normal maintenance tools without structural organization extras", () => {
    const names = registeredToolNames({ toolProfile: "standard" });

    expect(names).toContain("siyuan_get_document_kramdown");
    expect(names).toContain("siyuan_insert_block");
    expect(names).toContain("siyuan_update_block");
    expect(names).toContain("siyuan_patch_blocks");
    expect(names).toContain("siyuan_replace_document_body");
    expect(names).not.toContain("siyuan_sql_select");
    expect(names).not.toContain("siyuan_set_attrs");
    expect(names).toContain("siyuan_rename_document");
    expect(names).not.toContain("siyuan_move_document");
    expect(names).not.toContain("siyuan_create_snapshot");
    expect(names).not.toContain("siyuan_reorganize_document");
    expect(names).not.toContain("siyuan_get_document");
    expect(names).not.toContain("siyuan_delete_block");
  });

  it("registers every tool for the full profile", () => {
    const names = registeredToolNames({ toolProfile: "full" });

    expect(names).toContain("siyuan_sql_select");
    expect(names).toContain("siyuan_database_get");
    expect(names).toContain("siyuan_move_document");
    expect(names).toContain("siyuan_reorganize_document");
    expect(names).toContain("siyuan_get_document");
    expect(names).toContain("siyuan_delete_block");
  });

  it("does not expose human-readable parent path fields for document creation tools", () => {
    const standardSchemas = registeredToolSchemas({ toolProfile: "standard" });
    const fullSchemas = registeredToolSchemas({ toolProfile: "full" });

    expect(standardSchemas.get("siyuan_create_document")).not.toHaveProperty("parentHPath");
    expect(fullSchemas.get("siyuan_reorganize_document")).not.toHaveProperty("parentHPath");
  });

  it("does not expose dryRun as an MCP tool argument", () => {
    const schemas = registeredToolSchemas({ toolProfile: "full" });

    for (const [name, schema] of schemas) {
      expect(schema, `${name} should not expose dryRun`).not.toHaveProperty("dryRun");
    }
  });

  it("describes SiYuan inline formula syntax on standard Markdown inputs", () => {
    const schemas = registeredToolSchemas({ toolProfile: "standard" });
    const toolsWithDirectMarkdown = [
      "siyuan_create_document",
      "siyuan_append_block",
      "siyuan_insert_block",
      "siyuan_update_block",
      "siyuan_replace_document_body",
      "siyuan_append_daily_note"
    ];

    for (const name of toolsWithDirectMarkdown) {
      const description = schemaDescription(schemas.get(name)?.markdown);
      expect(description, `${name}.markdown should describe inline formulas`).toContain("$...$");
      expect(description, `${name}.markdown should reject parenthesized LaTeX delimiters`).toContain("\\(...\\)");
      expect(description, `${name}.markdown should distinguish source escaping from final content`).toContain(
        "must decode to"
      );
    }
  });

  it("validates formula escaping before invoking a standard write tool", () => {
    const schemas = registeredToolSchemas({ toolProfile: "standard" });
    const markdown = schemas.get("siyuan_append_block")?.markdown as {
      safeParse(value: unknown): { success: boolean };
    };

    expect(markdown.safeParse("Valid $\\sqrt{x}+\\bar{x}+\\mathrm{m}$ formula.").success).toBe(true);
    expect(markdown.safeParse("Broken $sqrt{x}+bar{x}+mathrm{m}$ formula.").success).toBe(false);
    expect(markdown.safeParse(`Broken $${String.fromCharCode(8)}ar{x}$ formula.`).success).toBe(false);
    expect(markdown.safeParse(`Broken $${String.fromCharCode(13)}m{x}$ formula.`).success).toBe(false);
  });

  it("treats dollar signs in code contexts as literal across standard write schemas", () => {
    const schemas = registeredToolSchemas({ toolProfile: "standard" });
    const cmake = [
      "```cmake",
      "set(FIRST \"${FIRST_VALUE}\")",
      "set(SECOND \"${SECOND_VALUE}\")",
      "message(\"${PROJECT_SOURCE_DIR}\")",
      "```",
      "",
      "使用 `${sourceDir}` 表示源码目录。"
    ].join("\n");
    const directTools = [
      "siyuan_create_document",
      "siyuan_append_block",
      "siyuan_replace_document_body",
      "siyuan_append_daily_note"
    ];

    for (const name of directTools) {
      const markdown = schemas.get(name)?.markdown as {
        safeParse(value: unknown): { success: boolean };
      };
      expect(markdown.safeParse(cmake).success, `${name}.markdown should accept code dollars`).toBe(true);
    }

    const operations = schemas.get("siyuan_patch_blocks")?.operations as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(operations.safeParse([{ op: "append", parent: "doc", markdown: cmake }]).success).toBe(true);
  });

  it("does not expose file input for single-block updates", () => {
    const schemas = registeredToolSchemas({ toolProfile: "standard" });

    expect(schemas.get("siyuan_update_block")).toHaveProperty("markdown");
    expect(schemas.get("siyuan_update_block")).not.toHaveProperty("file");
  });

  it("exposes a minimal whole-document replacement schema", () => {
    const schemas = registeredToolSchemas({ toolProfile: "standard" });

    expect(schemas.get("siyuan_replace_document_body")).toEqual({
      id: expect.anything(),
      markdown: expect.anything()
    });
  });

  it("accepts content-block deletion in standard patch operations", () => {
    const schemas = registeredToolSchemas({ toolProfile: "standard" });
    const operations = schemas.get("siyuan_patch_blocks")?.operations as {
      safeParse(value: unknown): { success: boolean };
    };

    expect(operations.safeParse([{ op: "delete", id: "20260709120000-abcdefg" }]).success).toBe(true);
    expect(operations.safeParse([{ op: "delete" }]).success).toBe(false);
  });
});

describe("server metadata", () => {
  it("uses the package version and advertises SiYuan MCP as the preferred interface", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(SERVER_INSTRUCTIONS).toContain("SiYuan/思源笔记");
    expect(SERVER_INSTRUCTIONS).toContain("MUST ask in chat and WAIT");
    expect(SERVER_INSTRUCTIONS).toContain("Silence is not approval");
    expect(SERVER_INSTRUCTIONS).toContain("instead of calling the local SiYuan HTTP API directly");
  });
});

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

describe("audit input sanitization", () => {
  it("redacts Markdown recursively while keeping operation metadata", () => {
    const sanitized = sanitizeAuditInput({
      documentId: "doc",
      operation: { op: "append", markdown: "中文正文🙂" }
    });

    expect(sanitized).toMatchObject({
      documentId: "doc",
      operation: {
        op: "append",
        markdown: {
          redacted: true,
          length: 6,
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      }
    });
    expect(JSON.stringify(sanitized)).not.toContain("中文正文");
  });

  it("keeps dry-run state in the audit log without returning it to MCP clients", async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-mcp-audit-test-"));
    const config = { ...baseConfig, allowWrite: true, logDir };
    const cli = new SiyuanCli(config, async () => ({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false
    }));

    try {
      const result = await runAuditedWrite(
        config,
        cli,
        "block_append",
        ["block", "append", "--parent", "doc", "--data", "$x$"],
        { parent: "doc", markdown: "$x$", dryRun: false },
        false
      );

      expect(result).not.toHaveProperty("dryRun");
      const auditEntry = JSON.parse(readFileSync(path.join(logDir, "writes.jsonl"), "utf8").trim().split("\n").at(-1)!);
      expect(auditEntry).toMatchObject({ command: "block_append", dryRun: false, ok: true });
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });
});

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

describe("buildSearchArgs", () => {
  it("builds search args with filters", () => {
    expect(
      buildSearchArgs({
        query: "mcp",
        notebooks: ["nb1"],
        paths: ["/daily"],
        types: ["d"],
        subtypes: ["u"],
        method: 1,
        orderBy: 2,
        page: 2,
        pageSize: 30,
        groupBy: 0
      })
    ).toEqual([
      "search",
      "mcp",
      "--page",
      "2",
      "--page-size",
      "30",
      "--notebook",
      "nb1",
      "--path",
      "/daily",
      "--type",
      "d",
      "--subtype",
      "u",
      "--method",
      "1",
      "--order-by",
      "2",
      "--group-by",
      "0"
    ]);
  });
});

describe("withDryRun", () => {
  it("prepends global dry-run flag when enabled", () => {
    expect(withDryRun(["block", "append", "--parent", "p1"], true)).toEqual([
      "--dry-run",
      "block",
      "append",
      "--parent",
      "p1"
    ]);
  });

  it("keeps args unchanged when disabled", () => {
    expect(withDryRun(["block", "append", "--parent", "p1"], false)).toEqual([
      "block",
      "append",
      "--parent",
      "p1"
    ]);
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

describe("path normalization helpers", () => {
  it("normalizes root-like workspace paths for file tools", () => {
    expect(normalizeWorkspacePath("/")).toBe(".");
    expect(normalizeWorkspacePath("\\")).toBe(".");
    expect(normalizeWorkspacePath(" data ")).toBe("data");
  });

  it("normalizes asset paths to be relative to the data directory", () => {
    expect(normalizeDataRelativeAssetPath("data\\assets\\image.png")).toBe("assets\\image.png");
    expect(normalizeDataRelativeAssetPath("data/assets/image.png")).toBe("assets/image.png");
    expect(normalizeDataRelativeAssetPath("assets/image.png")).toBe("assets/image.png");
  });

  it("normalizes create-document parent paths without changing root", () => {
    expect(normalizeCreateDocumentParentPath("/")).toBe("/");
    expect(normalizeCreateDocumentParentPath("/20251202114556-gg58mg7.sy")).toBe("/20251202114556-gg58mg7");
    expect(normalizeCreateDocumentParentPath("/相关企业与产品")).toBe("/相关企业与产品");
  });

  it("explains create-document parent path normalization", () => {
    expect(createDocumentPathWarning("/parent.sy", "/parent")).toContain("parent path");
    expect(createDocumentPathWarning("/parent", "/parent")).toBeUndefined();
  });

  it("extracts SiYuan asset references from markdown and kramdown", () => {
    expect(
      extractAssetRefs(
        "![a](assets/a.png)\n![b](data/assets/b.jpg)\n<span data-href=\"assets/c.pdf\">c</span>\n![a](assets/a.png)"
      )
    ).toEqual(["assets/a.png", "assets/b.jpg", "assets/c.pdf"]);
  });
});

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

describe("document and block arg builders", () => {
  it("builds batch kramdown args without unsupported mode flag", () => {
    expect(buildBatchKramdownArgs(["id1", "id2"])).toEqual([
      "block",
      "batch-kramdown",
      "--ids",
      "id1,id2"
    ]);
  });

  it("builds document list args with optional paths", () => {
    expect(
      buildDocumentListArgs({
        notebook: "nb1",
        path: "/projects",
        hpath: "/Projects"
      })
    ).toEqual(["document", "list", "--notebook", "nb1", "--path", "/projects", "--hpath", "/Projects"]);
  });

  it("builds create document args", () => {
    expect(
      buildCreateDocumentArgs({
        notebook: "nb1",
        title: "MCP Test",
        path: "/inbox",
        markdown: "Body with an [example](https://example.com)."
      })
    ).toEqual([
      "document",
      "create",
      "--notebook",
      "nb1",
      "--title",
      "MCP Test",
      "--path",
      "/inbox",
      "--markdown",
      "Body with an [example](https://example.com)."
    ]);
  });

  it("builds insert block args with previous sibling", () => {
    expect(
      buildInsertBlockArgs({
        parent: "parent1",
        markdown: "- child",
        previous: "sibling1"
      })
    ).toEqual([
      "block",
      "insert",
      "--parent",
      "parent1",
      "--data",
      "- child",
      "--previous",
      "sibling1"
    ]);
  });

  it("builds database render args with optional filters", () => {
    expect(
      buildDatabaseRenderArgs({
        av: "db1",
        view: "view1",
        query: "open",
        page: 2,
        size: 25
      })
    ).toEqual([
      "database",
      "render",
      "--av",
      "db1",
      "--page",
      "2",
      "--size",
      "25",
      "--view",
      "view1",
      "--query",
      "open"
    ]);
  });

  it("builds attr set args with repeated attr flags", () => {
    expect(
      buildSetAttrsArgs({
        id: "block1",
        attrs: {
          icon: "1f4ca",
          tags: "mcp,test"
        }
      })
    ).toEqual(["attr", "set", "--id", "block1", "--attr", "icon=1f4ca", "--attr", "tags=mcp,test"]);
  });

  it("builds database item add args with optional flags", () => {
    expect(
      buildDatabaseItemAddArgs({
        av: "db1",
        block: "block1",
        content: "row content",
        view: "view1",
        previous: "item0",
        detached: true,
        ignoreDefaultFill: true
      })
    ).toEqual([
      "database",
      "item",
      "add",
      "--av",
      "db1",
      "--block",
      "block1",
      "--content",
      "row content",
      "--view",
      "view1",
      "--previous",
      "item0",
      "--detached",
      "--ignore-default-fill"
    ]);
  });

  it("builds detached database item add args without a block", () => {
    expect(
      buildDatabaseItemAddArgs({
        av: "db1",
        content: "detached row",
        detached: true
      })
    ).toEqual(["database", "item", "add", "--av", "db1", "--content", "detached row", "--detached"]);
  });

  it("builds database item update args with serialized JSON value", () => {
    expect(
      buildDatabaseItemUpdateArgs({
        av: "db1",
        key: "key1",
        item: "item1",
        value: { content: "done" }
      })
    ).toEqual([
      "database",
      "item",
      "update",
      "--av",
      "db1",
      "--key",
      "key1",
      "--item",
      "item1",
      "--value",
      "{\"content\":\"done\"}"
    ]);
  });

  it("builds document move args", () => {
    expect(
      buildDocumentMoveArgs({
        id: "doc1",
        notebook: "nb2",
        hpath: "/Archive"
      })
    ).toEqual(["document", "move", "--id", "doc1", "--notebook", "nb2", "--hpath", "/Archive"]);
  });

  it("builds history list and search args", () => {
    expect(buildHistoryListArgs({ notebook: "nb1", op: "update", type: 0, page: 2 })).toEqual([
      "history",
      "list",
      "--notebook",
      "nb1",
      "--op",
      "update",
      "--type",
      "0",
      "--page",
      "2"
    ]);

    expect(buildHistorySearchArgs({ query: "mcp", notebook: "nb1", op: "create", page: 1 })).toEqual([
      "history",
      "search",
      "mcp",
      "--notebook",
      "nb1",
      "--op",
      "create",
      "--page",
      "1"
    ]);
  });

  it("builds repo list args", () => {
    expect(buildRepoListArgs({ tag: true, page: 3 })).toEqual(["repo", "list", "--tag", "--page", "3"]);
  });
});
