import type { ServerConfig } from "../../src/config.js";
import { registerTools } from "../../src/mcp/registerTools.js";

export const baseConfig: ServerConfig = {
  workspace: "E:\\SiYuan Data",
  cliPath: "siyuan",
  allowWrite: false,
  allowDangerous: false,
  toolProfile: "minimal",
  logDir: "logs",
  timeoutMs: 30_000
};

export function registeredToolNames(config: Partial<ServerConfig> = {}): string[] {
  const names: string[] = [];
  const server = {
    registerTool(name: string) {
      names.push(name);
    }
  };

  registerTools(server, { ...baseConfig, ...config });
  return names;
}

export function registeredToolSchemas(config: Partial<ServerConfig> = {}): Map<string, Record<string, unknown>> {
  const schemas = new Map<string, Record<string, unknown>>();
  const server = {
    registerTool(name: string, meta: { inputSchema?: Record<string, unknown> }) {
      schemas.set(name, meta.inputSchema ?? {});
    }
  };

  registerTools(server, { ...baseConfig, ...config });
  return schemas;
}

export function schemaDescription(schema: unknown): string | undefined {
  let current = schema as { description?: string; _def?: { innerType?: unknown } } | undefined;
  while (current) {
    if (typeof current.description === "string") {
      return current.description;
    }
    current = current._def?.innerType as typeof current;
  }
  return undefined;
}

