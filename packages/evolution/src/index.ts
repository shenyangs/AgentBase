import { createId, type EvalResult, type EvolutionProposal, type RuntimeEvent } from "@agentbase/core";

export function proposeEvolutionFromTrace(events: RuntimeEvent[], options: { title?: string } = {}): EvolutionProposal {
  const failures = events.filter((event) => event.type === "tool.failed" || event.type === "run.failed");
  const contextEvents = events.filter((event) => event.type === "context.prepared");
  const rationale =
    failures.length > 0
      ? `Found ${failures.length} failure event(s); propose adding a regression eval and memory note before changing runtime behavior.`
      : `No failure event found; propose preserving observed successful pattern as a project memory candidate.`;
  return {
    id: createId("evo"),
    kind: failures.length > 0 ? "policy" : "memory",
    title: options.title ?? (failures.length > 0 ? "Add regression guard for failed run" : "Promote successful run pattern"),
    rationale: `${rationale} Context snapshots observed: ${contextEvents.length}.`,
    status: "proposed",
    createdAt: new Date().toISOString(),
    metadata: { eventCount: events.length, failureCount: failures.length }
  };
}

export function gateEvolutionProposal(proposal: EvolutionProposal, evalResults: EvalResult[]): EvolutionProposal {
  const passed = evalResults.length > 0 && evalResults.every((result) => result.passed);
  return {
    ...proposal,
    status: passed ? "tested" : "rejected",
    evalResults
  };
}
