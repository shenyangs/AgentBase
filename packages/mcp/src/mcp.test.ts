import { describe, expect, it } from "vitest";
import { adaptMcpTool, createMcpBridgeManifest, listMcpServerTools, loadMcpServerTools } from "./index";

describe("mcp", () => {
  it("creates tool manifest", () => {
    const manifest = createMcpBridgeManifest("agentbase", [{ name: "x", description: "x", inputSchema: {}, async execute() { return { ok: true }; } }]);
    expect(manifest.tools[0].name).toBe("x");
  });

  it("adapts tool failures", async () => {
    const tool = adaptMcpTool({ server: "fixture", name: "boom", description: "boom", inputSchema: {} }, async () => {
      throw new Error("nope");
    });
    const result = await tool.execute({}, {} as never);
    expect(result.ok).toBe(false);
  });

  it("loads tools from a stdio json-rpc MCP fixture", async () => {
    const script = `
      process.stdin.once('data', (chunk) => {
        const request = JSON.parse(String(chunk));
        if (request.method === 'tools/list') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] } }) + '\\n');
        } else {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(request.params) }] } }) + '\\n');
        }
      });
    `;
    const config = { name: "fixture", transport: "stdio" as const, command: process.execPath, args: ["-e", script] };
    expect((await listMcpServerTools(config))[0].name).toBe("echo");
    const [tool] = await loadMcpServerTools(config);
    const result = await tool.execute({ text: "hi" }, {} as never);
    expect(result.ok).toBe(true);
  });
});
