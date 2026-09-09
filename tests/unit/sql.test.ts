import { describe, expect, it } from "vitest";
import { ensureLimit, validateSelectSql } from "../../src/cli/sql.js";

describe("validateSelectSql", () => {
  it("accepts SELECT statements", () => {
    expect(validateSelectSql("SELECT id, content FROM blocks")).toBe("SELECT id, content FROM blocks");
  });

  it("accepts CTE SELECT statements", () => {
    expect(validateSelectSql("WITH recent AS (SELECT id FROM blocks) SELECT * FROM recent")).toContain("SELECT * FROM recent");
  });

  it("rejects non-select statements", () => {
    expect(() => validateSelectSql("DELETE FROM blocks")).toThrow("Only SELECT");
  });

  it("rejects multiple statements", () => {
    expect(() => validateSelectSql("SELECT * FROM blocks; SELECT * FROM refs")).toThrow("Multiple");
  });

  it("rejects forbidden keywords inside CTEs", () => {
    expect(() => validateSelectSql("WITH x AS (DELETE FROM blocks RETURNING id) SELECT * FROM x")).toThrow("DELETE");
  });
});

describe("ensureLimit", () => {
  it("adds a default limit when missing", () => {
    expect(ensureLimit("SELECT * FROM blocks", 100)).toBe("SELECT * FROM blocks LIMIT 100");
  });

  it("keeps an existing limit", () => {
    expect(ensureLimit("SELECT * FROM blocks LIMIT 10", 100)).toBe("SELECT * FROM blocks LIMIT 10");
  });
});
