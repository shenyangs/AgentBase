import { describe, expect, it } from "vitest";
import { gateEvolutionProposal, proposeEvolutionFromTrace } from "./index";

describe("evolution", () => {
  it("proposes and gates evolution", () => {
    const proposal = proposeEvolutionFromTrace([{ id: "1", runId: "run", ts: "now", type: "run.failed", data: {} }]);
    expect(proposal.status).toBe("proposed");
    expect(gateEvolutionProposal(proposal, [{ id: "case", passed: true, score: 1, details: [] }]).status).toBe("tested");
  });
});
