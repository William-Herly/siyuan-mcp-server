import { describe, expect, it } from "vitest";
import { buildBatchKramdownArgs, buildCreateDocumentArgs, buildDatabaseItemAddArgs, buildDatabaseItemUpdateArgs, buildDatabaseRenderArgs, buildDocumentListArgs, buildDocumentMoveArgs, buildHistoryListArgs, buildHistorySearchArgs, buildInsertBlockArgs, buildRepoListArgs, buildSearchArgs, buildSetAttrsArgs, withDryRun } from "../../src/cli/args.js";


describe("buildSearchArgs", () => {
  it("builds search args with filters", () => {
    expect(
      buildSearchArgs({
        query: "mcp",
        notebooks: ["nb1"],
        paths: ["/daily"],
        types: ["d"],
        subtypes: ["u"],
        method: 1,
        orderBy: 2,
        page: 2,
        pageSize: 30,
        groupBy: 0
      })
    ).toEqual([
      "search",
      "mcp",
      "--page",
      "2",
      "--page-size",
      "30",
      "--notebook",
      "nb1",
      "--path",
      "/daily",
      "--type",
      "d",
      "--subtype",
      "u",
      "--method",
      "1",
      "--order-by",
      "2",
      "--group-by",
      "0"
    ]);
  });
});

describe("withDryRun", () => {
  it("prepends global dry-run flag when enabled", () => {
    expect(withDryRun(["block", "append", "--parent", "p1"], true)).toEqual([
      "--dry-run",
      "block",
      "append",
      "--parent",
      "p1"
    ]);
  });

  it("keeps args unchanged when disabled", () => {
    expect(withDryRun(["block", "append", "--parent", "p1"], false)).toEqual([
      "block",
      "append",
      "--parent",
      "p1"
    ]);
  });
});

describe("document and block arg builders", () => {
  it("builds batch kramdown args without unsupported mode flag", () => {
    expect(buildBatchKramdownArgs(["id1", "id2"])).toEqual([
      "block",
      "batch-kramdown",
      "--ids",
      "id1,id2"
    ]);
  });

  it("builds document list args with optional paths", () => {
    expect(
      buildDocumentListArgs({
        notebook: "nb1",
        path: "/projects",
        hpath: "/Projects"
      })
    ).toEqual(["document", "list", "--notebook", "nb1", "--path", "/projects", "--hpath", "/Projects"]);
  });

  it("builds create document args", () => {
    expect(
      buildCreateDocumentArgs({
        notebook: "nb1",
        title: "MCP Test",
        path: "/inbox",
        markdown: "Body with an [example](https://example.com)."
      })
    ).toEqual([
      "document",
      "create",
      "--notebook",
      "nb1",
      "--title",
      "MCP Test",
      "--path",
      "/inbox",
      "--markdown",
      "Body with an [example](https://example.com)."
    ]);
  });

  it("builds insert block args with previous sibling", () => {
    expect(
      buildInsertBlockArgs({
        parent: "parent1",
        markdown: "- child",
        previous: "sibling1"
      })
    ).toEqual([
      "block",
      "insert",
      "--parent",
      "parent1",
      "--data",
      "- child",
      "--previous",
      "sibling1"
    ]);
  });

  it("builds database render args with optional filters", () => {
    expect(
      buildDatabaseRenderArgs({
        av: "db1",
        view: "view1",
        query: "open",
        page: 2,
        size: 25
      })
    ).toEqual([
      "database",
      "render",
      "--av",
      "db1",
      "--page",
      "2",
      "--size",
      "25",
      "--view",
      "view1",
      "--query",
      "open"
    ]);
  });

  it("builds attr set args with repeated attr flags", () => {
    expect(
      buildSetAttrsArgs({
        id: "block1",
        attrs: {
          icon: "1f4ca",
          tags: "mcp,test"
        }
      })
    ).toEqual(["attr", "set", "--id", "block1", "--attr", "icon=1f4ca", "--attr", "tags=mcp,test"]);
  });

  it("builds database item add args with optional flags", () => {
    expect(
      buildDatabaseItemAddArgs({
        av: "db1",
        block: "block1",
        content: "row content",
        view: "view1",
        previous: "item0",
        detached: true,
        ignoreDefaultFill: true
      })
    ).toEqual([
      "database",
      "item",
      "add",
      "--av",
      "db1",
      "--block",
      "block1",
      "--content",
      "row content",
      "--view",
      "view1",
      "--previous",
      "item0",
      "--detached",
      "--ignore-default-fill"
    ]);
  });

  it("builds detached database item add args without a block", () => {
    expect(
      buildDatabaseItemAddArgs({
        av: "db1",
        content: "detached row",
        detached: true
      })
    ).toEqual(["database", "item", "add", "--av", "db1", "--content", "detached row", "--detached"]);
  });

  it("builds database item update args with serialized JSON value", () => {
    expect(
      buildDatabaseItemUpdateArgs({
        av: "db1",
        key: "key1",
        item: "item1",
        value: { content: "done" }
      })
    ).toEqual([
      "database",
      "item",
      "update",
      "--av",
      "db1",
      "--key",
      "key1",
      "--item",
      "item1",
      "--value",
      "{\"content\":\"done\"}"
    ]);
  });

  it("builds document move args", () => {
    expect(
      buildDocumentMoveArgs({
        id: "doc1",
        notebook: "nb2",
        hpath: "/Archive"
      })
    ).toEqual(["document", "move", "--id", "doc1", "--notebook", "nb2", "--hpath", "/Archive"]);
  });

  it("builds history list and search args", () => {
    expect(buildHistoryListArgs({ notebook: "nb1", op: "update", type: 0, page: 2 })).toEqual([
      "history",
      "list",
      "--notebook",
      "nb1",
      "--op",
      "update",
      "--type",
      "0",
      "--page",
      "2"
    ]);

    expect(buildHistorySearchArgs({ query: "mcp", notebook: "nb1", op: "create", page: 1 })).toEqual([
      "history",
      "search",
      "mcp",
      "--notebook",
      "nb1",
      "--op",
      "create",
      "--page",
      "1"
    ]);
  });

  it("builds repo list args", () => {
    expect(buildRepoListArgs({ tag: true, page: 3 })).toEqual(["repo", "list", "--tag", "--page", "3"]);
  });
});
