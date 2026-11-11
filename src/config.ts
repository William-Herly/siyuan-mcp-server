import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export type PermissionMode = "readonly" | "safe-write" | "dangerous";
export type ToolProfile = "minimal" | "standard" | "full";

export interface ServerConfig {
  workspace?: string;
  homeDir?: string;
  cliPath: string;
  allowWrite: boolean;
  allowDangerous: boolean;
  toolProfile: ToolProfile;
  logDir: string;
  timeoutMs: number;
}

const DEFAULT_CLI_PATH = "siyuan";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Loads server configuration from environment variables. Defaults are intentionally readonly.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const allowWrite = env.SIYUAN_MCP_ALLOW_WRITE === "true";
  const allowDangerous = env.SIYUAN_MCP_ALLOW_DANGEROUS === "true";

  return {
    workspace: nonEmpty(env.SIYUAN_MCP_WORKSPACE),
    homeDir: nonEmpty(env.SIYUAN_MCP_HOME_DIR),
    cliPath: nonEmpty(env.SIYUAN_MCP_CLI_PATH) ?? DEFAULT_CLI_PATH,
    allowWrite,
    allowDangerous,
    toolProfile: parseToolProfile(env.SIYUAN_MCP_PROFILE),
    logDir:
      nonEmpty(env.SIYUAN_MCP_LOG_DIR) ??
      path.join(process.cwd(), ".siyuan-mcp", "logs"),
    timeoutMs: parsePositiveInt(env.SIYUAN_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  };
}

/**
 * Presents the effective permission tier used by health checks and agent diagnostics.
 */
export function permissionMode(config: ServerConfig): PermissionMode {
  if (config.allowDangerous) {
    return "dangerous";
  }

  if (config.allowWrite) {
    return "safe-write";
  }

  return "readonly";
}

export function publicConfigSummary(config: ServerConfig) {
  return {
    workspaceConfigured: Boolean(config.workspace),
    workspace: config.workspace,
    homeDir: config.homeDir,
    cliPath: config.cliPath,
    permissionMode: permissionMode(config),
    toolProfile: config.toolProfile,
    logDir: config.logDir,
    timeoutMs: config.timeoutMs
  };
}

export async function validateConfig(config: ServerConfig): Promise<string[]> {
  const warnings: string[] = [];

  if (!config.workspace) {
    warnings.push("SIYUAN_MCP_WORKSPACE is not set; data commands require successful workspace discovery. Discovery failure stops the command.");
  } else {
    try {
      await access(config.workspace, constants.R_OK);
    } catch {
      warnings.push(`Workspace path is not readable: ${config.workspace}`);
    }
  }

  return warnings;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseToolProfile(value: string | undefined): ToolProfile {
  const trimmed = value?.trim();
  if (trimmed === "note-maintain" || trimmed === "maintain") {
    return "standard";
  }

  if (trimmed === "standard" || trimmed === "full") {
    return trimmed;
  }

  if (trimmed === "organize" || trimmed === "advanced" || trimmed === "admin") {
    return "full";
  }

  return "minimal";
}
