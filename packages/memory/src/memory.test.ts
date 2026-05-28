import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonMemoryLineageStore, JsonMemoryProposalStore, JsonMemoryStore, draftMemoryProposalFromRun } from "./index";

describe("JsonMemoryStore", () => {
  it("adds, searches, and promotes memory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-memory-"));
    const store = new JsonMemoryStore({ file: path.join(dir, "memory.json") });
    const memory = await store.add({ scope: "project", text: "Prefer tool result refs over raw output", kind: "procedure", tags: ["context"] });
    expect((await store.search("tool result refs"))[0].id).toBe(memory.id);
    expect((await store.promote(memory.id)).promoted).toBe(true);
  });

  it("requires review or eval evidence before promoting memory proposals", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-memory-proposal-"));
    const memoryStore = new JsonMemoryStore({ file: path.join(dir, "memory.json") });
    const proposalStore = new JsonMemoryProposalStore({ file: path.join(dir, "proposals.json"), memoryStore });
    const proposal = await proposalStore.propose({
      memory: { scope: "project", text: "Prefer eval-gated memory promotion.", kind: "procedure", tags: ["memory"] },
      rationale: "Observed durable project behavior.",
      evidence: [{ type: "user", summary: "User requested auditable memory promotion." }]
    });

    await expect(proposalStore.promoteProposal(proposal.id)).rejects.toThrow(/reviewed or tested/);
    const reviewed = await proposalStore.reviewProposal(proposal.id, { decision: "approved", reviewedBy: "test", reason: "useful and non-secret" });
    expect(reviewed.status).toBe("reviewed");
    const promoted = await proposalStore.promoteProposal(proposal.id);
    expect(promoted.proposal.status).toBe("promoted");
    expect(promoted.memory.promoted).toBe(true);
    expect(promoted.memory.pinned).toBe(true);
    expect((await memoryStore.search("eval-gated"))[0].id).toBe(promoted.memory.id);
  });

  it("tracks lineage and drafts curate proposals from run events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-memory-lineage-"));
    const lineageStore = new JsonMemoryLineageStore({ file: path.join(dir, "lineage.json") });
    await lineageStore.link({ proposalId: "prop_1", sourceRunId: "run_1", sourceEventId: "evt_1" });
    await lineageStore.markUsed("mem_1", "run_2");
    const superseded = await lineageStore.supersede("mem_1", "mem_2");
    const draft = draftMemoryProposalFromRun(
      [{ id: "evt_1", runId: "run_1", type: "model.completed", ts: new Date().toISOString(), data: { outputPreview: "Reusable evidence from a run." } }],
      "run_1"
    );

    expect((await lineageStore.list({ proposalId: "prop_1" }))[0].sourceRunId).toBe("run_1");
    expect(superseded.supersededBy).toBe("mem_2");
    expect(draft.memory.source).toBe("run_1");
  });
});
