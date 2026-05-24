import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonMemoryProposalStore, JsonMemoryStore } from "./index";

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
});
