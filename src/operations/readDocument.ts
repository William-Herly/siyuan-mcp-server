import { SiyuanCli } from "../cli/client.js";
import { normalizeDataRelativeAssetPath } from "../cli/paths.js";
import { NormalizedResponse } from "../types.js";

export function extractAssetRefs(markdown: string): string[] {
  const refs = new Set<string>();
  const assetPattern = /(?:^|[\s("'`])((?:data[\\/]+)?assets[\\/][^\s)"'`<>]+)/g;
  let match: RegExpExecArray | null;

  while ((match = assetPattern.exec(markdown)) !== null) {
    refs.add(normalizeDataRelativeAssetPath(match[1]));
  }

  return [...refs].sort();
}

export async function documentKramdownWithAssets(cli: SiyuanCli, id: string, mode: "kramdown" | "md" = "kramdown"): Promise<NormalizedResponse> {
  const args = ["block", "kramdown", "--id", id];
  if (mode) {
    args.push("--mode", mode);
  }

  const result = await cli.run("document_kramdown", args, { output: "text" });
  if (!result.ok || typeof result.data !== "string") {
    return result;
  }

  return {
    ...result,
    data: {
      id,
      mode,
      markdown: result.data,
      assets: extractAssetRefs(result.data)
    }
  };
}

/**
 * Works around SiYuan CLI document-info path resolution issues by falling back to document get.
 */
export async function documentInfoWithFallback(cli: SiyuanCli, id: string): Promise<NormalizedResponse> {
  const info = await cli.run("document_info", ["document", "info", "--id", id]);
  if (info.ok) {
    return info;
  }

  const fallback = await cli.run("document_info", ["document", "get", "--id", id]);
  return {
    ...fallback,
    warnings: [
      `SiYuan CLI document info failed; returned document get fallback output instead. ${summarizeCliFailure(info)}`,
      ...fallback.warnings
    ],
    data: {
      fallback: "document_get",
      originalErrorSummary: summarizeCliFailure(info),
      document: fallback.data
    }
  };
}

export async function outlineWithEmptyFallback(cli: SiyuanCli, id: string): Promise<NormalizedResponse> {
  const result = await cli.run("outline_get", ["outline", "get", "--id", id]);
  const raw = `${result.raw ?? ""}\n${result.warnings.join("\n")}`;
  if (!result.ok && /has no headings/i.test(raw)) {
    return {
      ok: true,
      data: [],
      warnings: [],
      command: "outline_get"
    };
  }

  return result;
}

function summarizeCliFailure(result: NormalizedResponse): string {
  const text = String(result.raw || result.warnings[0] || "Unknown CLI error.");
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() || "Unknown CLI error.";
}
