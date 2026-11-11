import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { SiyuanCli, type CliRunOptions } from "../cli/client.js";
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
  requestId?: string;
  code?: string;
  execution?: string;
  verification?: string;
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
    warnings: result.warnings,
    requestId: typeof input.requestId === "string" ? input.requestId : randomUUID(),
    code: typeof result.code === "string" ? result.code : undefined,
    execution: typeof result.execution === "string" ? result.execution : undefined,
    verification: typeof result.verification === "string" ? result.verification : undefined
  };

  await mkdir(config.logDir, { recursive: true });
  await appendFile(path.join(config.logDir, "writes.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

/** Redacts content payloads while retaining IDs and operation metadata. */
export function sanitizeAuditInput(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(input) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (key && ["markdown", "content", "title", "memo", "value", "values", "attrs", "data"].includes(key.toLowerCase()) && value !== undefined) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return {
      redacted: true,
      length: text.length,
      bytes: Buffer.byteLength(text, "utf8"),
      sha256: createHash("sha256").update(text, "utf8").digest("hex")
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
  dryRun: boolean | undefined,
  options: CliRunOptions = {}
): Promise<NormalizedResponse> {
  const effectiveDryRun = dryRun === true;
  const requestId = randomUUID();
  try {
    await auditWrite(config, command, { ...input, requestId, auditPhase: "intent" }, effectiveDryRun, { ok: true, command, warnings: [] });
  } catch {
    return { ok: false, command, code: "AUDIT_UNAVAILABLE", execution: "not-started", retryable: false, warnings: ["Could not record write intent. No command was executed."] };
  }
  const result = await cli.run(command, args, effectiveDryRun ? { output: "text" } : options);
  const createdId = result.ok && !effectiveDryRun && ["block_append", "block_prepend", "block_insert", "document_create", "dailynote_create"].includes(command)
    ? extractCreatedId(result.data) : undefined;
  const outcome = { ...result, requestId, execution: effectiveDryRun || result.execution === "not-started" ? "not-started" : result.ok ? "applied" : "unknown", verification: "not-required", retryable: false,
    ...(createdId ? { createdId } : {}), ...(!result.ok ? { code: result.code ?? "WRITE_STATE_UNKNOWN" } : {}) };
  try {
    await auditWrite(config, command, { ...input, requestId, auditPhase: "result" }, effectiveDryRun, outcome);
    return outcome;
  } catch {
    return { ...outcome, audit: "failed", warnings: [...result.warnings, "The command already ran, but its audit result could not be saved. Do not repeat the write solely because logging failed."] };
  }
}

function extractCreatedId(data: unknown): string | undefined {
  const id = typeof data === "string" ? data : data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).id : undefined;
  return typeof id === "string" && /^\d{14}-[a-z0-9]{7}$/.test(id) ? id : undefined;
}
