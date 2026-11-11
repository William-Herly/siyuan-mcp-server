/** In-memory executor support for fixed target queries; never accesses SiYuan. */
export function selectTargetRows<T extends { id: string; root_id: string; parent_id: string; markdown: string; ial: string }>(query: string, rows: T[]): T[] {
  const seed = query.split(" UNION SELECT")[0];
  const ids = new Set([...(seed.match(/id IN \(([^)]+)\)/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map(match => match[1]));
  const documentId = seed.match(/AND root_id = '([^']+)'/)?.[1];
  const selected = new Map(rows.filter(row => ids.has(row.id) && (!documentId || row.root_id === documentId)).map(row => [row.id, row]));
  if (query.startsWith("WITH RECURSIVE")) {
    let frontier = [...selected.values()];
    for (let depth = 0; depth < 64 && frontier.length; depth += 1) {
      const parents = new Set(frontier.map(row => row.parent_id));
      frontier = rows.filter(row => parents.has(row.id) && !selected.has(row.id));
      for (const row of frontier) selected.set(row.id, row);
    }
  }
  return [...selected.values()].map(row => query.includes("'' AS markdown") ? { ...row, markdown: "", ial: "" } : row);
}
