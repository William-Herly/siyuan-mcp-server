import { withDryRun } from "../cli/args.js";
import { SiyuanCli } from "../cli/client.js";
import { ServerConfig } from "../config.js";
import { runAuditedWrite } from "../runtime/audit.js";
import { requireDangerous, requireWrite } from "../safety/permissions.js";

export async function guardedWrite(
  config: ServerConfig,
  cli: SiyuanCli,
  command: string,
  args: string[],
  input: Record<string, unknown>,
  dryRun: boolean
) {
  const permission = ["file_write", "file_rename", "file_copy", "import_sy", "import_data", "sync_pull"].includes(command)
    ? requireDangerous(config, command) : requireWrite(config, command);
  if (permission) {
    return permission;
  }

  return runAuditedWrite(config, cli, command, withDryRun(args, dryRun), input, dryRun);
}
