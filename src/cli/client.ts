import { spawn } from "node:child_process";
import { ServerConfig } from "../config.js";
import { CliExecutionResult, NormalizedResponse } from "../types.js";

export type CliExecutor = (file: string, args: string[], timeoutMs: number) => Promise<CliExecutionResult>;

export type CliOutputMode = "json" | "text";

export interface CliRunOptions {
  output?: CliOutputMode;
}

export class SiyuanCli {
  private discoveredWorkspace?: string;
  private workspaceDiscovery?: Promise<string | undefined>;
  private discoveredVersion?: string;

  constructor(
    private readonly config: ServerConfig,
    private readonly executor: CliExecutor = execute
  ) {}

  /**
   * Runs one typed SiYuan CLI command and normalizes stdout/stderr into the MCP response shape.
   */
  async run(command: string, args: string[], options: CliRunOptions = {}): Promise<NormalizedResponse> {
    const workspace = await this.resolveWorkspace(command);
    if (!workspace && command !== "workspace_info" && command !== "workspace_list") {
      return { ok: false, command, code: "WORKSPACE_UNAVAILABLE", execution: "not-started", retryable: false,
        warnings: ["Could not determine the workspace. Set SIYUAN_MCP_WORKSPACE or correct workspace discovery and restart the server. No data command was executed."] };
    }
    const cliArgs = this.withCommonArgs(args, workspace);
    const result = await this.executor(this.config.cliPath, cliArgs, this.config.timeoutMs);
    const warnings = result.stderr.trim() ? [bounded(result.stderr.trim())] : [];

    if (result.outputTruncated) {
      return { ok: false, command, code: "CLI_OUTPUT_LIMIT", warnings: [...warnings, "CLI output exceeded the capture limit. Its contents and execution outcome cannot be inferred from partial output."], raw: bounded(result.stdout), truncated: true };
    }

    if (result.timedOut) {
      return {
        ok: false,
        warnings: [...warnings, `Command timed out after ${this.config.timeoutMs}ms.`],
        command,
        raw: bounded(result.stdout)
      };
    }

    if (result.exitCode !== 0) {
      return {
        ok: false,
        warnings,
        command,
        raw: bounded(result.stdout || result.stderr)
      };
    }

    const parsed = options.output === "text" ? parseText(result.stdout) : parseJsonOrText(result.stdout);
    if (command === "workspace_info") this.rememberWorkspace(result.stdout);
    return {
      ok: true,
      data: parsed.data,
      warnings: parsed.warning ? [...warnings, parsed.warning] : warnings,
      command,
      raw: parsed.raw,
      ...(args[0] === "sql" && /Results truncated to \d+ rows/i.test(result.stderr) ? { truncated: true } : {})
    };
  }

  buildArgs(args: string[]): string[] {
    return this.withCommonArgs(args, this.config.workspace);
  }

  /** Cached observations only: health never launches a backend probe. */
  status() {
    return { workspaceStatus: this.config.workspace ? "configured" : this.discoveredWorkspace ? "resolved" : "unknown",
      version: this.discoveredVersion ?? null, versionSource: this.discoveredVersion ? "workspace-info" : "unknown",
      compatibility: "unverified", homeDirConfigured: Boolean(this.config.homeDir) };
  }

  private withCommonArgs(args: string[], workspace: string | undefined): string[] {
    const common = ["--format", "json"];
    if (workspace) {
      common.unshift("--workspace", workspace);
    }
    if (this.config.homeDir) common.unshift("--home-dir", this.config.homeDir);

    return [...common, ...args];
  }

  /**
   * Uses explicit config first; otherwise discovers the current registered workspace once.
   */
  private async resolveWorkspace(command: string): Promise<string | undefined> {
    if (this.config.workspace) {
      return this.config.workspace;
    }

    if (this.discoveredWorkspace) {
      return this.discoveredWorkspace;
    }

    if (command === "workspace_info" || command === "workspace_list") {
      return undefined;
    }

    this.workspaceDiscovery ??= this.discoverWorkspace();
    return this.workspaceDiscovery;
  }

  private async discoverWorkspace(): Promise<string | undefined> {
    const result = await this.executor(this.config.cliPath, this.withCommonArgs(["workspace", "info"], undefined), this.config.timeoutMs);
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) return undefined;
    this.rememberWorkspace(result.stdout);
    return this.discoveredWorkspace;
  }

  private rememberWorkspace(stdout: string): void {
    this.discoveredWorkspace ??= extractWorkspacePath(stdout);
    try {
      const parsed = JSON.parse(stdout.trim());
      const version = parsed?.version ?? parsed?.data?.version;
      if (typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) this.discoveredVersion = version;
    } catch { /* Invalid workspace output is not a version observation. */ }
  }
}

export const MAX_CLI_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Low-level process executor. All command arguments are passed as an array, never shell-interpolated.
 */
export function execute(file: string, args: string[], timeoutMs: number): Promise<CliExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let capturedBytes = 0;
    let outputTruncated = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      resolve({ stdout, stderr, exitCode: null, timedOut: true, outputTruncated });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const capture = (chunk: string, stream: "stdout" | "stderr") => {
      if (settled || outputTruncated) return;
      const bytes = Buffer.byteLength(chunk, "utf8");
      if (capturedBytes + bytes > MAX_CLI_OUTPUT_BYTES) { outputTruncated = true; child.kill(); return; }
      if (stream === "stdout") stdout += chunk; else stderr += chunk;
      capturedBytes += bytes;
    };
    child.stdout.on("data", (chunk: string) => capture(chunk, "stdout"));
    child.stderr.on("data", (chunk: string) => capture(chunk, "stderr"));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: error.message, exitCode: 1, timedOut: false, outputTruncated });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut: false, outputTruncated });
    });
  });
}

function parseJsonOrText(stdout: string): { data: unknown; warning?: string; raw?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { data: null };
  }

  try {
    return { data: JSON.parse(trimmed) };
  } catch {
    if (isKnownPlainSuccess(trimmed)) {
      return { data: trimmed };
    }

    return {
      data: trimmed,
      warning: "CLI output was not valid JSON.",
      raw: bounded(trimmed)
    };
  }
}

function isKnownPlainSuccess(value: string): boolean {
  return (
    value === "ok" ||
    /^\d{14}-[a-z0-9]{7}$/i.test(value) ||
    /^[^\s\\/]+\.md$/i.test(value) ||
    /^\[dry-run\]\s+Would\b/i.test(value)
  );
}

function parseText(stdout: string): { data: unknown; warning?: string; raw?: string } {
  return { data: stdout };
}

function extractWorkspacePath(stdout: string): string | undefined {
  try {
    const data = JSON.parse(stdout.trim());
    if (typeof data?.path === "string" && data.path.trim() && data.valid !== false) {
      return data.path;
    }

    if (typeof data?.data?.path === "string" && data.data.path.trim() && data.data.valid !== false) {
      return data.data.path;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function bounded(value: string, maxLength = 8_000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
