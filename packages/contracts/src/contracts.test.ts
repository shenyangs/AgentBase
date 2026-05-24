import { describe, expect, it } from "vitest";
import { createMockModelProvider, type ToolResultEnvelope } from "@agentbase/core";
import { assertContractReport, runContractSuite, validateProviderContract, validateToolContract, validateToolResultEnvelope, validateTraceContract, validateWorkflowResultContract } from "./index";

describe("contract validators", () => {
  it("accepts stable provider, tool, envelope, trace, and workflow shapes", () => {
    const toolReport = validateToolContract({
      name: "read_contract",
      description: "Read a contract fixture.",
      risk: "low",
      requiredPermissions: ["fs:read"],
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      async execute() {
        return { ok: true, output: { path: "README.md" } };
      }
    });
    const envelope: ToolResultEnvelope = {
      ok: true,
      ref: "artifact://tool-result/1",
      toolCallId: "call_1",
      toolName: "read_contract",
      summary: "read README",
      preview: "README",
      artifacts: [],
      metadata: { durationMs: 1, truncated: false }
    };
    const suite = runContractSuite([
      validateProviderContract(createMockModelProvider()),
      toolReport,
      validateToolResultEnvelope(envelope),
      validateTraceContract([
        { id: "evt_1", runId: "run_1", type: "run.started", ts: "2026-01-01T00:00:00.000Z", data: {} },
        { id: "evt_2", runId: "run_1", type: "run.completed", ts: "2026-01-01T00:00:01.000Z", data: {} }
      ]),
      validateWorkflowResultContract({
        workflow: "contract",
        status: "completed",
        assignments: [{ taskId: "task_1", agent: "agent", status: "completed", artifactRefs: ["artifact://1"] }],
        handoffs: []
      })
    ]);

    expect(() => assertContractReport(suite)).not.toThrow();
  });

  it("rejects missing tool metadata", () => {
    const report = validateToolContract({
      name: "",
      description: "",
      inputSchema: { type: "string" },
      async execute() {
        return { ok: true };
      }
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["name", "description", "inputSchema.type"]));
  });
});
