import { blockContentArgs, withDryRun } from "../cli/args.js";
import { SiyuanCli } from "../cli/client.js";
import { ServerConfig } from "../config.js";
import { isSingleBlockMarkdown, validateWritableMarkdown } from "../markdown/validate.js";
import { runAuditedWrite } from "../runtime/audit.js";
import { requireWrite } from "../safety/permissions.js";
import { checkInsertion, readTargets, requireTarget, safetyError } from "../safety/targets.js";
import { verifyMarkdown } from "../safety/verification.js";

export async function writeBlockChild(
  config: ServerConfig,
  cli: SiyuanCli,
  command: string,
  subcommand: "append" | "prepend",
  parent: string,
  markdown: string,
  dryRun: boolean
) {
  const permission = requireWrite(config, command);
  if (permission) {
    return permission;
  }
  const content = blockContentArgs(markdown);
  if ("error" in content) {
    return content.error;
  }

  const targets = await readTargets(cli, [parent], command);
  if (!(targets instanceof Map)) return targets;
  const invalid = checkInsertion(targets, parent, undefined, command);
  if (invalid) return invalid;
  return runAuditedWrite(
    config,
    cli,
    command,
    withDryRun(["block", subcommand, "--parent", parent, ...content.args], dryRun),
    { parent, markdown, dryRun },
    dryRun
  );
}

export async function updateBlockDirectly(
  config: ServerConfig,
  cli: SiyuanCli,
  id: string,
  markdown: string,
  dryRun: boolean
) {
  const permission = requireWrite(config, "block_update");
  if (permission) {
    return permission;
  }
  if (!isSingleBlockMarkdown(markdown)) {
    return {
      ok: false,
      warnings: [
        "siyuan_update_block only supports one Markdown block. SiYuan CLI block update keeps only the first block and discards later blocks."
      ],
      command: "block_update"
    };
  }

  const targets = await readTargets(cli, [id], "block_update");
  if (!(targets instanceof Map)) return targets;
  const target = targets.get(id)!;
  const invalid = requireTarget(target, "content", "block_update");
  if (invalid) return invalid;
  const issues = validateWritableMarkdown(markdown);
  if (issues.length) return safetyError("block_update", "INVALID_MARKDOWN", issues.join(" "));
  const result = await runAuditedWrite(config, cli, "block_update",
    withDryRun(["block", "update", "--id", id, "--data", markdown], dryRun),
    { id, markdown, dryRun, reason: "block_update" }, dryRun);
  return verifyMarkdown(cli, id, markdown, result);
}
