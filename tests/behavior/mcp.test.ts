import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { SiyuanCli } from "../../src/cli/client.js";
import { createToolRegistrar } from "../../src/mcp/register.js";
import { registerTools } from "../../src/mcp/registerTools.js";
import { baseConfig, registeredToolNames } from "../helpers/tools.js";

it("preserves discovery, validation and permission results through the MCP SDK", async () => {
  const logDir = await mkdtemp(path.join(tmpdir(), "siyuan-mcp-protocol-"));
  const config = { ...baseConfig, toolProfile: "standard" as const, logDir };
  const calls: string[][] = [];
  const cli = new SiyuanCli(config, async (_file, args) => {
    calls.push(args);
    return { stdout: JSON.stringify([{ id: "notebook" }]), stderr: "", exitCode: 0, timedOut: false };
  });
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  registerTools(createToolRegistrar(server), config, cli);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual(registeredToolNames(config).sort());
    for (const tool of tools) expect(tool.inputSchema.properties).not.toHaveProperty("dryRun");

    const read = await client.callTool({ name: "siyuan_list_notebooks", arguments: {} });
    expect(read.structuredContent).toMatchObject({ ok: true, data: [{ id: "notebook" }] });
    expect(calls).toHaveLength(1);

    const denied = await client.callTool({ name: "siyuan_update_block", arguments: { id: "20260908154051-8wu6gis", markdown: "text" } });
    expect(denied).toMatchObject({ isError: true, structuredContent: { code: "PERMISSION_DENIED", execution: "not-started" } });
    const invalid = await client.callTool({ name: "siyuan_update_block", arguments: { id: "20260908154051-8wu6gis" } });
    expect(invalid.isError).toBe(true);
    expect(calls).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
    await rm(logDir, { recursive: true, force: true });
  }
});
