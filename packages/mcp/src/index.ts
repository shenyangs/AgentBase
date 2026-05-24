import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpServerConfig, Tool, ToolDefinition } from "@agentbase/core";

export type McpToolDescriptor = ToolDefinition & {
  server: string;
};

export type McpBridgeManifest = {
  name: string;
  tools: McpToolDescriptor[];
};

export type McpToolListResult = {
  tools: Array<{ name: string; description?: string; inputSchema?: ToolDefinition["inputSchema"] }>;
};

export function createMcpBridgeManifest(name: string, tools: Tool[], server = "agentbase"): McpBridgeManifest {
  return {
    name,
    tools: tools.map((tool) => ({
      server,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  };
}

export function adaptMcpTool(descriptor: McpToolDescriptor, execute: (input: unknown) => Promise<unknown>): Tool {
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    requiredPermissions: ["mcp:tool"],
    risk: "medium",
    async execute(input) {
      try {
        return { ok: true, output: await execute(input), metadata: { mcpServer: descriptor.server } };
      } catch (error) {
        return { ok: false, error: { code: "MCP_TOOL_FAILED", message: error instanceof Error ? error.message : String(error) }, metadata: { mcpServer: descriptor.server } };
      }
    }
  };
}

export async function listMcpServerTools(config: McpServerConfig): Promise<McpToolDescriptor[]> {
  const result = (await sendMcpRequest(config, "tools/list", {})) as McpToolListResult;
  return (result.tools ?? []).map((tool) => ({
    server: config.name,
    name: tool.name,
    description: tool.description ?? `MCP tool ${tool.name}`,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} }
  }));
}

export async function loadMcpServerTools(config: McpServerConfig): Promise<Tool[]> {
  const descriptors = await listMcpServerTools(config);
  return descriptors.map((descriptor) =>
    adaptMcpTool(descriptor, async (input) => sendMcpRequest(config, "tools/call", { name: descriptor.name, arguments: input }))
  );
}

export async function sendMcpRequest(config: McpServerConfig, method: string, params: unknown): Promise<unknown> {
  const request = { jsonrpc: "2.0", id: 1, method, params };
  if (config.transport === "http") {
    if (!config.url) throw new Error(`MCP HTTP server requires url: ${config.name}`);
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    if (!response.ok) throw new Error(`MCP HTTP request failed: ${response.status}`);
    return parseMcpResponse(await response.json());
  }

  if (!config.command) throw new Error(`MCP stdio server requires command: ${config.name}`);
  return sendStdioRequest(config.command, config.args ?? [], request);
}

async function sendStdioRequest(command: string, args: string[], request: unknown): Promise<unknown> {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const response = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP stdio request timed out")), 10_000);
    lines.once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve(parseMcpResponse(JSON.parse(line)));
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code && code !== 0) {
        reject(new Error(`MCP stdio server exited ${code}: ${Buffer.concat(stderrChunks).toString("utf8")}`));
      }
    });
  });
  child.stdin.end(`${JSON.stringify(request)}\n`);
  try {
    return await response;
  } finally {
    child.kill();
  }
}

function parseMcpResponse(response: unknown): unknown {
  if (!isRecord(response)) {
    throw new Error("Invalid MCP response");
  }
  if (isRecord(response.error)) {
    throw new Error(typeof response.error.message === "string" ? response.error.message : "MCP error");
  }
  return response.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
