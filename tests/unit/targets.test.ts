import { describe, expect, it } from "vitest";
import { SiyuanCli } from "../../src/cli/client.js";
import { readTargets } from "../../src/safety/targets.js";
import { baseConfig } from "../helpers/tools.js";

// This checks generated SQL against SQLite, not SiYuan. Older development runtimes
// lacking node:sqlite skip this suite; Node 22.13+ or 24 is required for full checks.
const [major, minor] = process.versions.node.split(".").map(Number);
describe.skipIf(major < 22 || (major === 22 && minor < 13))("target SQL on isolated in-memory SQLite", () => {
  it("selects only targets and heading ancestors in a large document", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    const doc = "20261111120000-doc0000", heading = "20261111120000-head000", target = "20261111120000-para000";
    try {
      db.exec("CREATE TABLE blocks(id TEXT PRIMARY KEY, root_id TEXT, parent_id TEXT, type TEXT, markdown TEXT, ial TEXT, updated TEXT)");
      const insert = db.prepare("INSERT INTO blocks VALUES(?,?,?,?,?,?,?)");
      insert.run(doc, doc, "", "d", "", "", "");
      insert.run(heading, doc, doc, "h", "# Heading", "", "");
      for (let index = 0; index < 500; index++) insert.run(`20261111120000-${index.toString(36).padStart(7, "0")}`, doc, doc, "future_type", "Unrelated", "", "");
      insert.run(target, doc, heading, "p", "body", "", "");
      let calls = 0;
      const cli = new SiyuanCli(baseConfig, async (_file, args) => {
        calls++;
        const rows = db.prepare(args.at(-1)!).all();
        const limit = Number(args[args.indexOf("--limit") + 1]);
        expect(limit).toBeGreaterThan(rows.length);
        return { stdout: JSON.stringify(rows), stderr: "", exitCode: 0, timedOut: false };
      });
      const result = await readTargets(cli, [doc, target], "block_patch", doc);
      expect(result).toBeInstanceOf(Map);
      const scope = result as Map<string, { markdown: string }>;
      expect([...scope.keys()].sort()).toEqual([doc, heading, target].sort());
      expect([...scope.values()].every(row => row.markdown === "")).toBe(true);
      expect(calls).toBe(1);
    } finally { db.close(); }
  });
  it.each(["cycle", "deep", "missing"])("fails closed on %s ancestry", async kind => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    const doc = "20261111120000-doc0000";
    const block = (index: number) => `20261111120000-${index.toString(36).padStart(7, "0")}`;
    try {
      db.exec("CREATE TABLE blocks(id TEXT PRIMARY KEY, root_id TEXT, parent_id TEXT, type TEXT, markdown TEXT, ial TEXT, updated TEXT)");
      const insert = db.prepare("INSERT INTO blocks VALUES(?,?,?,?,?,?,?)");
      insert.run(doc, doc, "", "d", "", "", "");
      if (kind === "deep") {
        for (let index = 0; index < 70; index++) insert.run(block(index), doc, index ? block(index - 1) : doc, "b", "", "", "");
      } else insert.run(block(69), doc, kind === "cycle" ? block(69) : block(68), "b", "", "", "");
      const cli = new SiyuanCli(baseConfig, async (_file, args) => ({ stdout: JSON.stringify(db.prepare(args.at(-1)!).all()), stderr: "", exitCode: 0, timedOut: false }));
      expect(await readTargets(cli, [doc, block(69)], "block_patch", doc)).toMatchObject({ ok: false, code: "TARGET_LOOKUP_INCOMPLETE", execution: "not-started" });
    } finally { db.close(); }
  });
});
