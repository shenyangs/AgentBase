import { describe, expect, it } from "vitest";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import type { RuntimeEventInput, Tool, TraceWriter } from "./types";

function memoryTrace(events: RuntimeEventInput[]): TraceWriter {
  return {
    async write(event) {
      events.push(event);
      return { id: "evt", runId: "run", type: event.type, ts: new Date().toISOString(), data: event.data ?? {} };
    }
  };
}

describe("ToolExecutor", () => {
  it("rejects approval-required tools clearly when no approval store is configured", async () => {
    const events: RuntimeEventInput[] = [];
    const writeTool: Tool = {
      name: "write_file",
      description: "fake write",
      inputSchema: { type: "object" },
      requiredPermissions: ["fs:write"],
      async execute() {
        return { ok: true, output: { written: true } };
      }
    };
    const executor = new ToolExecutor({
      registry: new ToolRegistry([writeTool]),
      workspaceRoot: process.cwd(),
      policy: { name: "read-only" },
      trace: memoryTrace(events),
      env: {},
      signal: new AbortController().signal
    });

    const result = await executor.execute({ id: "call_write", name: "write_file", input: {} }, "run_no_approval_store");

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "APPROVAL_UNAVAILABLE" })
      })
    );
    expect(events.map((event) => event.type)).toEqual(["policy.checked", "tool.rejected"]);
    expect(events.some((event) => event.type === "approval.required")).toBe(false);
  });
});
