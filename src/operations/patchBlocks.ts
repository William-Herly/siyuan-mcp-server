import { blockContentArgs, withDryRun } from "../cli/args.js";
import { SiyuanCli } from "../cli/client.js";
import { ServerConfig } from "../config.js";
import { normalizeMarkdown } from "../markdown/normalize.js";
import { isSingleBlockMarkdown } from "../markdown/validate.js";
import { runAuditedWrite } from "../runtime/audit.js";
import { requireWrite } from "../safety/permissions.js";
import { checkInsertion, readTargets, requireTarget, safetyError } from "../safety/targets.js";

export type PatchOperation =
  | { op: "append"; parent: string; markdown: string }
  | { op: "insert"; parent: string; previous?: string; markdown: string }
  | { op: "update"; id: string; markdown: string }
  | { op: "delete"; id: string };

export async function patchBlocksDirectly(config: ServerConfig, cli: SiyuanCli, documentId: string, operations: PatchOperation[], dryRun: boolean) {
  const command = "block_patch";
  const permission = requireWrite(config, command);
  if (permission) return permission;
  const prepared = operations.map((operation, index) => ({ index, operation, built: buildPatchOperationArgs(operation) }));
  const invalid = prepared.find((item) => "error" in item.built);
  if (invalid && "error" in invalid.built) return { ...invalid.built.error, execution: "not-started", data: { failedIndex: invalid.index, applied: [] } };
  const targetIds = operations.flatMap((op) => "id" in op ? [op.id] : [op.parent, ...(op.op === "insert" && op.previous ? [op.previous] : [])]);
  const targets = await readTargets(cli, [documentId, ...targetIds], command, documentId);
  if (!(targets instanceof Map)) return targets;
  const invalidDocument = requireTarget(targets.get(documentId)!, "document", command);
  if (invalidDocument) return invalidDocument;
  const destructive = operations.filter((op) => op.op === "update" || op.op === "delete");
  for (const op of operations) {
    if ("id" in op) {
      const invalidTarget = requireTarget(targets.get(op.id)!, "content", command);
      if (invalidTarget) return invalidTarget;
    } else {
      const invalidTarget = checkInsertion(targets, op.parent, op.op === "insert" ? op.previous : undefined, command);
      if (invalidTarget) return invalidTarget;
    }
  }
  // Reject dependencies on any destructive target, in either order, before the first write.
  for (const op of destructive) {
    const duplicate = destructive.filter((item) => item.id === op.id).length > 1;
    if (duplicate) return safetyError(command, "CONFLICTING_OPERATIONS", "A block cannot be updated/deleted twice in one batch.");
    for (const other of operations) {
      if (other === op) continue;
      const refs = "id" in other ? [other.id] : [other.parent, ...(other.op === "insert" && other.previous ? [other.previous] : [])];
      for (const ref of refs) {
        let current = ref;
        const visited = new Set<string>();
        while (current && current !== documentId) {
          if (current === op.id || visited.has(current)) return safetyError(command, "CONFLICTING_OPERATIONS", "A batch cannot depend on a block/subtree that it updates or deletes. Split the dependent work and use fresh target IDs.");
          visited.add(current);
          const ancestor = targets.get(current);
          if (!ancestor) return safetyError(command, "TARGET_LOOKUP_FAILED", "Could not verify the target ancestry.");
          current = ancestor.parent_id;
        }
      }
    }
    // Heading updates can affect section ownership beyond parent_id relationships.
    if (targets.get(op.id)!.type === "h" && operations.length > 1) return safetyError(command, "CONFLICTING_OPERATIONS", "Edit or delete a heading in a separate call before composing changes to its section.");
  }
  const applied: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  for (const { index, operation, built } of prepared) {
    if ("error" in built) throw new Error("Invalid prepared operation");
    const result = await runAuditedWrite(config, cli, built.command, withDryRun(built.args, dryRun), { operation, index, documentId, dryRun }, dryRun);
    warnings.push(...result.warnings);
    if (!result.ok) return { ok: false, command, code: "PARTIAL_FAILURE", execution: result.execution === "unknown" ? "unknown" : applied.length ? "partial" : "not-started", retryable: false, warnings, data: { applied, failed: { index, op: operation.op, ...result }, requiresRefresh: true } };
    applied.push({ index, op: operation.op, id: "id" in operation ? operation.id : undefined, result: result.data });
  }
  let verified = true;
  if (destructive.length) {
    const remaining = await readTargets(cli, destructive.map((op) => op.id), command, undefined, true);
    verified = remaining instanceof Map && destructive.every((op) => op.op === "delete"
      ? !remaining.has(op.id)
      : remaining.has(op.id) && normalizeMarkdown(remaining.get(op.id)!.markdown) === normalizeMarkdown(op.markdown));
  }
  return { ok: verified, command, execution: "applied", verification: destructive.length ? verified ? "passed" : "unknown" : "not-required",
    ...(verified ? {} : { code: "VERIFICATION_FAILED", retryable: false }),
    warnings: [...warnings, ...(verified ? [] : ["The batch ran, but final targets could not be verified. Inspect the affected scope; do not repeat the batch."])],
    data: { documentId, applied, appliedCount: applied.length, requiresRefresh: !verified } };
}

function buildPatchOperationArgs(operation: PatchOperation):
  | { command: string; args: string[] }
  | { error: { ok: false; warnings: string[]; command: string } } {
  if (operation.op === "delete") {
    return {
      command: "block_delete",
      args: ["block", "delete", "--id", operation.id]
    };
  }

  const content = blockContentArgs(operation.markdown);
  if ("error" in content) {
    return content;
  }

  if (operation.op === "append") {
    return {
      command: "block_append",
      args: ["block", "append", "--parent", operation.parent, ...content.args]
    };
  }

  if (operation.op === "insert") {
    return {
      command: "block_insert",
      args: ["block", "insert", "--parent", operation.parent, ...content.args, ...(operation.previous ? ["--previous", operation.previous] : [])]
    };
  }

  if (!isSingleBlockMarkdown(operation.markdown)) {
    return {
      error: {
        ok: false,
        warnings: [
          "update operations only support one Markdown block. Use insert/append operations for multi-block content."
        ],
        command: "block_patch"
      }
    };
  }

  return {
    command: "block_update",
    args: ["block", "update", "--id", operation.id, ...content.args]
  };
}
