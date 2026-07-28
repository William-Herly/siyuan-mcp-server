import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: unknown };

export const SERVER_VERSION =
  typeof packageJson.version === "string" && packageJson.version.length > 0
    ? packageJson.version
    : "0.0.0";

export const SERVER_INSTRUCTIONS =
  "Preferred interface for reading and editing SiYuan/思源笔记. When a task involves SiYuan, use these MCP tools instead of calling the local SiYuan HTTP API directly.";
