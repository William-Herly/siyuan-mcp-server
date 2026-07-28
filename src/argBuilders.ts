import { appendNumber, appendRepeated } from "./toolHelpers.js";

export function buildSearchArgs(args: {
  query: string;
  notebooks?: string[];
  paths?: string[];
  types?: string[];
  subtypes?: string[];
  method?: number;
  orderBy?: number;
  page: number;
  pageSize: number;
  groupBy?: number;
}): string[] {
  const cliArgs = ["search", args.query, "--page", String(args.page), "--page-size", String(args.pageSize)];
  appendRepeated(cliArgs, "--notebook", args.notebooks);
  appendRepeated(cliArgs, "--path", args.paths);
  appendRepeated(cliArgs, "--type", args.types);
  appendRepeated(cliArgs, "--subtype", args.subtypes);
  appendNumber(cliArgs, "--method", args.method);
  appendNumber(cliArgs, "--order-by", args.orderBy);
  appendNumber(cliArgs, "--group-by", args.groupBy);
  return cliArgs;
}

export function buildDocumentListArgs(args: {
  notebook: string;
  path?: string;
  hpath?: string;
}): string[] {
  const cliArgs = ["document", "list", "--notebook", args.notebook];
  if (args.path) {
    cliArgs.push("--path", args.path);
  }
  if (args.hpath) {
    cliArgs.push("--hpath", args.hpath);
  }
  return cliArgs;
}

export function buildBatchKramdownArgs(ids: string[]): string[] {
  return ["block", "batch-kramdown", "--ids", ids.join(",")];
}

export function buildCreateDocumentArgs(args: {
  notebook: string;
  title: string;
  path?: string;
  markdown?: string;
}): string[] {
  const cliArgs = ["document", "create", "--notebook", args.notebook, "--title", args.title];
  if (args.path) {
    cliArgs.push("--path", args.path);
  }
  if (args.markdown) {
    cliArgs.push("--markdown", args.markdown);
  }
  return cliArgs;
}

export function buildInsertBlockArgs(args: {
  parent: string;
  markdown: string;
  previous?: string;
}): string[] {
  const cliArgs = ["block", "insert", "--parent", args.parent, "--data", args.markdown];
  if (args.previous) {
    cliArgs.push("--previous", args.previous);
  }
  return cliArgs;
}

export function buildDatabaseRenderArgs(args: {
  av: string;
  view?: string;
  query?: string;
  page: number;
  size: number;
}): string[] {
  const cliArgs = ["database", "render", "--av", args.av, "--page", String(args.page), "--size", String(args.size)];
  if (args.view) {
    cliArgs.push("--view", args.view);
  }
  if (args.query) {
    cliArgs.push("--query", args.query);
  }
  return cliArgs;
}

export function buildSetAttrsArgs(args: {
  id: string;
  attrs: Record<string, string>;
}): string[] {
  const cliArgs = ["attr", "set", "--id", args.id];
  for (const [key, value] of Object.entries(args.attrs)) {
    cliArgs.push("--attr", `${key}=${value}`);
  }
  return cliArgs;
}

export function buildDatabaseItemAddArgs(args: {
  av: string;
  block?: string;
  content?: string;
  view?: string;
  group?: string;
  previous?: string;
  detached?: boolean;
  ignoreDefaultFill?: boolean;
}): string[] {
  const cliArgs = ["database", "item", "add", "--av", args.av];
  if (args.block) {
    cliArgs.push("--block", args.block);
  }
  if (args.content) {
    cliArgs.push("--content", args.content);
  }
  if (args.view) {
    cliArgs.push("--view", args.view);
  }
  if (args.group) {
    cliArgs.push("--group", args.group);
  }
  if (args.previous) {
    cliArgs.push("--previous", args.previous);
  }
  if (args.detached) {
    cliArgs.push("--detached");
  }
  if (args.ignoreDefaultFill) {
    cliArgs.push("--ignore-default-fill");
  }
  return cliArgs;
}

export function buildDatabaseItemUpdateArgs(args: {
  av: string;
  key: string;
  item: string;
  value: Record<string, unknown>;
}): string[] {
  return [
    "database",
    "item",
    "update",
    "--av",
    args.av,
    "--key",
    args.key,
    "--item",
    args.item,
    "--value",
    JSON.stringify(args.value)
  ];
}

export function buildDocumentMoveArgs(args: {
  id: string;
  notebook: string;
  path?: string;
  hpath?: string;
}): string[] {
  const cliArgs = ["document", "move", "--id", args.id, "--notebook", args.notebook];
  if (args.path) {
    cliArgs.push("--path", args.path);
  }
  if (args.hpath) {
    cliArgs.push("--hpath", args.hpath);
  }
  return cliArgs;
}

export function buildHistoryListArgs(args: {
  notebook?: string;
  op?: string;
  type?: number;
  page?: number;
}): string[] {
  const cliArgs = ["history", "list"];
  if (args.notebook) {
    cliArgs.push("--notebook", args.notebook);
  }
  if (args.op) {
    cliArgs.push("--op", args.op);
  }
  if (args.type !== undefined) {
    cliArgs.push("--type", String(args.type));
  }
  if (args.page !== undefined) {
    cliArgs.push("--page", String(args.page));
  }
  return cliArgs;
}

export function buildHistorySearchArgs(args: {
  query: string;
  notebook?: string;
  op?: string;
  type?: number;
  page?: number;
}): string[] {
  const cliArgs = ["history", "search", args.query];
  if (args.notebook) {
    cliArgs.push("--notebook", args.notebook);
  }
  if (args.op) {
    cliArgs.push("--op", args.op);
  }
  if (args.type !== undefined) {
    cliArgs.push("--type", String(args.type));
  }
  if (args.page !== undefined) {
    cliArgs.push("--page", String(args.page));
  }
  return cliArgs;
}

export function buildRepoListArgs(args: {
  tag?: boolean;
  page?: number;
}): string[] {
  const cliArgs = ["repo", "list"];
  if (args.tag) {
    cliArgs.push("--tag");
  }
  if (args.page !== undefined) {
    cliArgs.push("--page", String(args.page));
  }
  return cliArgs;
}
