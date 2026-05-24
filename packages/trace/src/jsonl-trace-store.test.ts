import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTraceExport, JsonlTraceStore, serializeTraceExport } from "./index";

describe("JsonlTraceStore", () => {
  it("writes, lists, reads, and redacts trace events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-trace-"));
    const store = new JsonlTraceStore({ dir });

    await store.write({
      id: "evt_1",
      runId: "run_1",
      ts: "2026-05-20T00:00:00.000Z",
      type: "run.started",
      data: { agent: "test", apiKey: "sk-secretsecretsecret" }
    });
    await store.write({
      id: "evt_2",
      runId: "run_1",
      ts: "2026-05-20T00:00:01.000Z",
      type: "run.completed",
      data: {}
    });

    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");

    const events = await store.readRun("run_1");
    expect(events[0].data.apiKey).toBe("[REDACTED]");
  });

  it("exports redacted observability payloads", () => {
    const events = [
      {
        id: "evt_1",
        runId: "run_1",
        ts: "2026-05-20T00:00:00.000Z",
        type: "model.completed",
        data: { outputPreview: "ok", authorization: "Bearer abcdefghijklmnop" }
      }
    ];
    expect(serializeTraceExport(events, "jsonl")).toContain("[REDACTED]");
    const payload = createTraceExport(events, "openinference") as { data: { spans: Array<{ attributes: Record<string, unknown> }> } };
    expect(payload.data.spans[0].attributes["agentbase.event_type"]).toBe("model.completed");
    expect(JSON.stringify(payload)).not.toContain("abcdefghijklmnop");
  });
});
