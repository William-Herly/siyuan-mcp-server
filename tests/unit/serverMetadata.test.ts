import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS, SERVER_VERSION } from "../../src/serverMetadata.js";


describe("server metadata", () => {
  it("uses the package version and advertises SiYuan MCP as the preferred interface", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(SERVER_INSTRUCTIONS).toContain("SiYuan/思源笔记");
    expect(SERVER_INSTRUCTIONS).toContain("MUST ask in chat and WAIT");
    expect(SERVER_INSTRUCTIONS).toContain("Silence is not approval");
    expect(SERVER_INSTRUCTIONS).toContain("instead of calling the local SiYuan HTTP API directly");
  });
});
