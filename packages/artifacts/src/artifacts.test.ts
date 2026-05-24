import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileArtifactStore, createMaterializeRefTool } from "./index";

describe("FileArtifactStore", () => {
  it("stores and materializes refs", async () => {
    const store = new FileArtifactStore({ dir: await mkdtemp(path.join(tmpdir(), "agentbase-artifacts-")) });
    await store.put({ ref: "tool-result://run/call", kind: "tool_result", content: { ok: true }, summary: "ok" });
    const materialized = await store.materialize("tool-result://run/call");
    expect(materialized?.summary).toBe("ok");

    const tool = createMaterializeRefTool(store);
    const result = await tool.execute(
      { ref: "tool-result://run/call" },
      { runId: "run", workspaceRoot: process.cwd(), signal: new AbortController().signal, trace: fakeTrace(), policy: { name: "read-only" }, env: {} }
    );
    expect(result.ok).toBe(true);
  });
});

function fakeTrace() {
  return {
    async write(input: { type: string; data?: Record<string, unknown> }) {
      return { id: "evt", runId: "run", type: input.type, ts: new Date().toISOString(), data: input.data ?? {} };
    }
  };
}
