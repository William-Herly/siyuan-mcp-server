import { SiyuanCli } from "../cli/client.js";
import { normalizeMarkdown } from "../markdown/normalize.js";
import { NormalizedResponse } from "../types.js";

export async function verifyMarkdown(cli: SiyuanCli, id: string, markdown: string, result: NormalizedResponse): Promise<NormalizedResponse> {
  if (!result.ok || result.execution === "not-started") return result;
  const read = await cli.run("write_verify", ["block", "kramdown", "--id", id, "--mode", "md"], { output: "text" });
  const passed = read.ok && typeof read.data === "string" && normalizeMarkdown(read.data) === normalizeMarkdown(markdown);
  return {
    ...result, ok: passed, execution: "applied", verification: passed ? "passed" : read.ok ? "failed" : "unknown",
    ...(passed ? {} : { code: "VERIFICATION_FAILED", retryable: false }),
    warnings: [...result.warnings, ...(passed ? [] : ["Write completed, but its content could not be verified (Markdown normalization may differ). Do not blindly retry; inspect the affected scope."])],
    data: { ...(typeof result.data === "object" && result.data !== null && !Array.isArray(result.data) ? result.data : { result: result.data }), id, requiresRefresh: !passed }
  };
}
