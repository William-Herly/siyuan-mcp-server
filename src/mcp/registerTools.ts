import { SiyuanCli } from "../cli/client.js";
import { ServerConfig } from "../config.js";
import { auditWrite } from "../runtime/audit.js";
import { serializeOperation } from "../runtime/queue.js";
import { registerDangerousTools } from "../tools/dangerous.js";
import { registerDatabaseTools } from "../tools/database.js";
import { registerReadTools } from "../tools/read.js";
import { registerWriteTools } from "../tools/write.js";
import { NormalizedResponse } from "../types.js";
import { isToolExposed } from "./profiles.js";
import type { ToolRegistrar } from "./register.js";
import { textResult } from "./results.js";

/**
 * Registers SiYuan MCP tools according to the configured profile.
 *
 * Profiles:
 * - minimal: smallest read-only note lookup surface
 * - standard: normal note maintenance with safe content updates
 * - full: every tool, including dangerous-gated tools
 */
export function registerTools(server: ToolRegistrar, config: ServerConfig, cli = new SiyuanCli(config)): void {
  const filteredServer = filterServerForProfile(server, config);

  registerReadTools(filteredServer, config, cli);
  registerDatabaseTools(filteredServer, config, cli);
  registerWriteTools(filteredServer, config, cli);

  if (config.toolProfile === "full") {
    registerDangerousTools(filteredServer, config, cli);
  }
}

function filterServerForProfile(server: ToolRegistrar, config: ServerConfig): ToolRegistrar {
  return {
    registerTool(name, definition, handler) {
      if (!isToolExposed(name, config.toolProfile)) return;
      // One queue also prevents reads from observing this server's half-finished batch.
      server.registerTool(name, definition, (input) => serializeOperation(async () => {
        const result = await handler(input);
        const response = result.structuredContent;
        if (response?.ok === false && response.execution === "not-started" && response.code !== "AUDIT_UNAVAILABLE") {
          try {
            await auditWrite(config, String(response.command), { ...input, auditPhase: "rejected" }, false, response as NormalizedResponse);
          } catch {
            return textResult({ ...response, audit: "failed", warnings: [...(response.warnings as string[] ?? []), "The rejected write could not be recorded in the audit log."] });
          }
        }
        return result;
      }));
    }
  };
}
