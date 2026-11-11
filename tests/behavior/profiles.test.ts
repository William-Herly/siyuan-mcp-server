import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

import { registeredToolNames, registeredToolSchemas, schemaDescription } from "../helpers/tools.js";

describe("tool profiles", () => {
  it("accepts an optional isolated CLI home without changing defaults", () => {
    expect(loadConfig({}).homeDir).toBeUndefined();
    expect(loadConfig({ SIYUAN_MCP_HOME_DIR: " /synthetic-home " }).homeDir).toBe("/synthetic-home");
  });
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
