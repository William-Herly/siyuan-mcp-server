import { describe, expect, it } from "vitest";
import { createDocumentPathWarning, normalizeCreateDocumentParentPath, normalizeDataRelativeAssetPath, normalizeWorkspacePath } from "../../src/cli/paths.js";
import { extractAssetRefs } from "../../src/operations/readDocument.js";


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
