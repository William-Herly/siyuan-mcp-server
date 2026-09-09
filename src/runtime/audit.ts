import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { SiyuanCli } from "../cli/client.js";
import { ServerConfig } from "../config.js";
import { NormalizedResponse } from "../types.js";

export interface WriteAuditEntry {
  timestamp: string;
  workspace?: string;
  command: string;
  dryRun: boolean;
  input: Record<string, unknown>;
  ok: boolean;
  warnings: string[];
}

export async function auditWrite(
  config: ServerConfig,
  command: string,
  input: Record<string, unknown>,
  dryRun: boolean,
  result: NormalizedResponse
): Promise<void> {
  const entry: WriteAuditEntry = {
    timestamp: new Date().toISOString(),
    workspace: config.workspace,
    command,
    dryRun,
    input: sanitizeAuditInput(input),
    ok: result.ok,
    warnings: result.warnings
  };

  await mkdir(config.logDir, { recursive: true });
  await appendFile(path.join(config.logDir, "writes.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

/** Redacts Markdown bodies while retaining enough metadata to identify a write. */
export function sanitizeAuditInput(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(input) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (key?.toLowerCase() === "markdown" && typeof value === "string") {
    return {
      redacted: true,
      length: value.length,
      bytes: Buffer.byteLength(value, "utf8"),
      sha256: createHash("sha256").update(value, "utf8").digest("hex")
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey)])
    );
  }

  return value;
}

/**
 * Runs a write-like command and appends a compact audit record. Dry-run output is text by design.
 */
export async function runAuditedWrite(
  config: ServerConfig,
  cli: SiyuanCli,
  command: string,
  args: string[],
  input: Record<string, unknown>,
  dryRun: boolean | undefined
): Promise<NormalizedResponse> {
  const effectiveDryRun = dryRun === true;
  try {
    await auditWrite(config, command, { ...input, auditPhase: "intent" }, effectiveDryRun, { ok: true, command, warnings: [] });
  } catch {
    return { ok: false, command, code: "AUDIT_UNAVAILABLE", execution: "not-started", retryable: false, warnings: ["Could not record write intent. No command was executed."] };
  }
  const result = await cli.run(command, args, effectiveDryRun ? { output: "text" } : {});
  const outcome = { ...result, execution: effectiveDryRun ? "not-started" : result.ok ? "applied" : "unknown", verification: "not-required", retryable: false,
    ...(!result.ok ? { code: "WRITE_STATE_UNKNOWN" } : {}) };
  try {
    await auditWrite(config, command, { ...input, auditPhase: "result" }, effectiveDryRun, outcome);
    return outcome;
  } catch {
    return { ...outcome, audit: "failed", warnings: [...result.warnings, "The command already ran, but its audit result could not be saved. Do not repeat the write solely because logging failed."] };
  }
}
