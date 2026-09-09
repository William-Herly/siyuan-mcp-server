const FORBIDDEN_SQL_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "vacuum",
  "pragma",
  "replace",
  "create",
  "attach",
  "detach"
];

export function validateSelectSql(sql: string): string {
  const trimmed = sql.trim();
  const normalized = stripSqlComments(trimmed).trim();

  if (!normalized) {
    throw new Error("SQL must not be empty.");
  }

  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error("Only SELECT statements are allowed.");
  }

  if (hasMultipleStatements(normalized)) {
    throw new Error("Multiple SQL statements are not allowed.");
  }

  const lowered = normalized.toLowerCase();
  for (const keyword of FORBIDDEN_SQL_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(lowered)) {
      throw new Error(`SQL keyword is not allowed: ${keyword.toUpperCase()}.`);
    }
  }

  return normalized.replace(/;+\s*$/, "");
}

export function ensureLimit(sql: string, limit: number): string {
  if (/\blimit\s+\d+\b/i.test(sql)) {
    return sql;
  }

  return `${sql} LIMIT ${limit}`;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasMultipleStatements(sql: string): boolean {
  const withoutTrailingSemicolon = sql.replace(/;+\s*$/, "");
  return withoutTrailingSemicolon.includes(";");
}
