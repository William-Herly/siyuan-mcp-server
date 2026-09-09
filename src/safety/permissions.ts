import { ServerConfig } from "../config.js";
import { NormalizedResponse } from "../types.js";

/**
 * Returns a normalized permission failure when a write tool is called in readonly mode.
 */
export function requireWrite(config: ServerConfig, command: string): NormalizedResponse | undefined {
  if (config.allowWrite || config.allowDangerous) {
    return undefined;
  }

  return {
    ok: false,
    code: "PERMISSION_DENIED",
    execution: "not-started",
    retryable: false,
    warnings: ["Write tools require SIYUAN_MCP_ALLOW_WRITE=true."],
    command,
    data: {
      requiredPermission: "safe-write",
      currentPermission: "readonly"
    }
  };
}

/**
 * Returns a normalized permission failure for destructive tools unless dangerous mode is explicit.
 */
export function requireDangerous(config: ServerConfig, command: string): NormalizedResponse | undefined {
  if (config.allowDangerous) {
    return undefined;
  }

  return {
    ok: false,
    code: "PERMISSION_DENIED",
    execution: "not-started",
    retryable: false,
    warnings: ["Dangerous tools require SIYUAN_MCP_ALLOW_DANGEROUS=true."],
    command,
    data: {
      requiredPermission: "dangerous",
      currentPermission: config.allowWrite ? "safe-write" : "readonly"
    }
  };
}
