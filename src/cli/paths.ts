
export function normalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  return trimmed === "" || trimmed === "/" || trimmed === "\\" ? "." : trimmed;
}

export function normalizeDataRelativeAssetPath(path: string): string {
  return path.trim().replace(/^data[\\/]+/i, "");
}

export function normalizeCreateDocumentParentPath(path: string | undefined): string | undefined {
  const trimmed = path?.trim();
  if (!trimmed || trimmed === "/") {
    return trimmed;
  }

  return trimmed.replace(/\.sy$/i, "");
}

export function createDocumentPathWarning(path: string | undefined, normalizedPath: string | undefined): string | undefined {
  if (!path || !normalizedPath || path === normalizedPath) {
    return undefined;
  }

  return `Normalized create-document parent path from "${path}" to "${normalizedPath}". The create tool expects a parent path, not a target .sy file path.`;
}
