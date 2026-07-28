import { mkdir, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import type { NormalizedResponse } from "./types.js";

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
