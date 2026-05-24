import { describe, expect, it } from "vitest";
import { diffReplay, extractReplayOutput, replayRun, summarizeReplay } from "./index";

describe("summarizeReplay", () => {
  it("summarizes tool result artifacts", () => {
    const summary = summarizeReplay([
      { id: "1", runId: "run", ts: "now", type: "run.started", data: {} },
      { id: "2", runId: "run", ts: "now", type: "model.completed", data: { outputPreview: "done", usage: { costUsd: 0.01 } } },
      { id: "3", runId: "run", ts: "now", type: "artifact.created", data: { kind: "tool_result", toolName: "read_file", ok: true, summary: "read ok" } },
      { id: "4", runId: "run", ts: "now", type: "run.completed", data: { steps: 2 } }
    ]);
    expect(summary.toolResults[0].summary).toBe("read ok");
    expect(summary.deterministic).toBe(true);
    expect(summary.status).toBe("completed");
    expect(summary.costUsd).toBe(0.01);
  });

  it("diffs replay summaries", () => {
    const diff = diffReplay(
      [
        { id: "1", runId: "left", ts: "now", type: "run.started", data: {} },
        { id: "2", runId: "left", ts: "now", type: "model.completed", data: { outputPreview: "old" } }
      ],
      [
        { id: "3", runId: "right", ts: "now", type: "run.started", data: {} },
        { id: "4", runId: "right", ts: "now", type: "model.completed", data: { outputPreview: "new" } }
      ]
    );
    expect(diff.sameFinalAnswer).toBe(false);
    expect(diff.notes).toContain("final answer changed");
    expect(diff.changedModelCalls).toHaveLength(1);
  });

  it("creates deterministic replay results and extracts eval metadata", () => {
    const events = [
      { id: "1", runId: "run", ts: "2026-05-20T00:00:00.000Z", type: "run.started", data: {} },
      { id: "2", runId: "run", ts: "2026-05-20T00:00:01.000Z", type: "tool.started", data: {} },
      { id: "3", runId: "run", ts: "2026-05-20T00:00:02.000Z", type: "model.completed", data: { outputPreview: "final" } },
      { id: "4", runId: "run", ts: "2026-05-20T00:00:03.000Z", type: "run.completed", data: { steps: 1 } }
    ];
    expect(replayRun(events).status).toBe("completed");
    expect(extractReplayOutput(events)).toEqual(expect.objectContaining({ output: "final" }));
  });
});
