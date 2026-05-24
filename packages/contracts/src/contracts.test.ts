import { describe, expect, it } from "vitest";
import { createMockModelProvider, type ToolResultEnvelope } from "@agentbase/core";
import {
  assertContractReport,
  runContractSuite,
  validateContextSnapshotContract,
  validateLocalRuntimeSecurityContract,
  validateProviderContract,
  validateRelayMessageContract,
  validateSpecialistManifestContract,
  validateToolContract,
  validateToolResultEnvelope,
  validateTraceContract,
  validateWorkflowResultContract
} from "./index";

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
      }),
      validateSpecialistManifestContract({
        name: "researcher",
        role: "researcher",
        trigger: { keywords: ["research", "source"], description: "Find fresh evidence." },
        confidence: 0.8,
        needsFreshInfo: true,
        riskFlags: ["untrusted-web"],
        result: { format: "markdown" }
      }),
      validateContextSnapshotContract({
        messageCount: 2,
        tokenEstimate: 24,
        items: [
          { id: "stable-prefix", type: "stable_prefix", included: true, reason: "stable contract" },
          { id: "message-1", type: "user", included: true, reason: "dynamic suffix" }
        ],
        layers: [
          { id: "stable-prefix", label: "Stable Prefix", purpose: "stable context", itemTypes: ["stable_prefix"], includedItems: 1, skippedItems: 0, tokenEstimate: 10 },
          { id: "dynamic-suffix", label: "Dynamic Suffix", purpose: "latest turn", itemTypes: ["user"], includedItems: 1, skippedItems: 0, tokenEstimate: 14 }
        ]
      }),
      validateRelayMessageContract({
        id: "relay_1",
        channel: "contract",
        type: "external",
        payload: { ok: true },
        status: "queued",
        attempts: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
      validateLocalRuntimeSecurityContract({
        bindHost: "127.0.0.1",
        port: 0,
        token: "generated-contract-token",
        tokenHash: "a".repeat(64),
        headerName: "x-agentbase-runtime-token",
        authHeaders: {
          authorization: "Bearer generated-contract-token",
          "x-agentbase-runtime-token": "generated-contract-token"
        },
        corsAllowlist: ["http://127.0.0.1", "http://localhost"],
        tokenKind: "per-launch"
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

  it("rejects context snapshots without stable layers", () => {
    const report = validateContextSnapshotContract({
      messageCount: 1,
      tokenEstimate: 10,
      items: [{ id: "message-0", type: "user", included: true, reason: "input" }],
      layers: [{ id: "dynamic-suffix", label: "Dynamic Suffix", purpose: "latest turn", itemTypes: ["user"], includedItems: 1, skippedItems: 0 }]
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.path)).toContain("layers");
  });
});
