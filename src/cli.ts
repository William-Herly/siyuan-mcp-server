import { spawn } from "node:child_process";
import type { CliExecutionResult, NormalizedResponse } from "./types.js";
import type { ServerConfig } from "./config.js";

export type CliExecutor = (file: string, args: string[], timeoutMs: number) => Promise<CliExecutionResult>;
export type CliOutputMode = "json" | "text";

export interface CliRunOptions {
  output?: CliOutputMode;
}

export class SiyuanCli {
  private discoveredWorkspace?: string;

  constructor(
    private readonly config: ServerConfig,
    private readonly executor: CliExecutor = execute
  ) {}

  /**
   * Runs one typed SiYuan CLI command and normalizes stdout/stderr into the MCP response shape.
   */
  async run(command: string, args: string[], options: CliRunOptions = {}): Promise<NormalizedResponse> {
    const workspace = await this.resolveWorkspace(command);
    const cliArgs = this.withCommonArgs(args, workspace);
    const result = await this.executor(this.config.cliPath, cliArgs, this.config.timeoutMs);
    const warnings = result.stderr.trim() ? [result.stderr.trim()] : [];

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
    return {
      ok: true,
      data: parsed.data,
      warnings: parsed.warning ? [...warnings, parsed.warning] : warnings,
      command,
      raw: parsed.raw
    };
  }

  buildArgs(args: string[]): string[] {
    return this.withCommonArgs(args, this.config.workspace);
  }

  private withCommonArgs(args: string[], workspace: string | undefined): string[] {
    const common = ["--format", "json"];
    if (workspace) {
      common.unshift("--workspace", workspace);
    }

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

    if (command === "workspace_info") {
      return undefined;
    }

    const result = await this.executor(this.config.cliPath, ["--format", "json", "workspace", "info"], this.config.timeoutMs);
    if (result.exitCode !== 0 || result.timedOut) {
      return undefined;
    }

    const workspace = extractWorkspacePath(result.stdout);
    this.discoveredWorkspace = workspace;
    return workspace;
  }
}

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

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      resolve({ stdout, stderr, exitCode: null, timedOut: true });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: error.message, exitCode: 1, timedOut: false });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut: false });
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
  return { data: stdout.trim() };
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
