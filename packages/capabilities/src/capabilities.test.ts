import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonCapabilityStore } from "./index";

describe("JsonCapabilityStore", () => {
  it("turns a task run into a promoted reusable capability", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentbase-capabilities-"));
    const store = new JsonCapabilityStore({ file: path.join(workspace, "capabilities.json") });
    const draft = await store.createDraft({
      title: "Repo triage",
      summary: "Inspect files, explain project shape, and cite trace evidence.",
      taskRunId: "run_1",
      suggestedTools: ["list_files", "read_file"],
      evidence: [{ type: "run", ref: "run_1", summary: "Successful repo analysis run" }]
    });
    const promoted = await store.promoteDraft(draft.id, { instructions: "Analyze repositories with evidence." });
    const run = await store.recordRun({ capabilityId: promoted.capability.id, runId: "run_2", input: "summarize", status: "completed" });

    expect(promoted.draft.status).toBe("promoted");
    expect(promoted.capability.sourceDraftId).toBe(draft.id);
    expect(run.capabilityId).toBe(promoted.capability.id);
    await expect(store.promoteDraft(draft.id)).rejects.toThrow(/already promoted/);
  });
});
