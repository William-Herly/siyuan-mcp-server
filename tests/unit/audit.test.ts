import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SiyuanCli } from "../../src/cli/client.js";
import { runAuditedWrite, sanitizeAuditInput } from "../../src/runtime/audit.js";

import { baseConfig } from "../helpers/tools.js";

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
