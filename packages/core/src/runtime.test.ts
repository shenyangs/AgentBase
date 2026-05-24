import { describe, expect, it } from "vitest";
import { createMockModelProvider } from "./mock-model-provider";
import { createRuntime } from "./runtime";
import type { Agent, ApprovalDecision, ApprovalRequest, ApprovalStore, ContextManager, RuntimeEvent, Tool, TraceStore } from "./types";

function memoryTraceStore(events: RuntimeEvent[]): TraceStore {
  return {
    async write(event) {
      events.push(event);
    }
  };
}

function passthroughContext(): ContextManager {
  return {
    async prepare(input) {
      return {
        messages: input.state.messages,
        snapshot: {
          messageCount: input.state.messages.length,
          tokenEstimate: 10,
          items: []
        }
      };
    },
    async observe() {}
  };
}

class MemoryApprovalStore implements ApprovalStore {
  readonly approvals: ApprovalRequest[] = [];

  async createApproval(request: Omit<ApprovalRequest, "id" | "status" | "requestedAt"> & Partial<Pick<ApprovalRequest, "id" | "status" | "requestedAt">>): Promise<ApprovalRequest> {
    const approval: ApprovalRequest = {
      ...request,
      id: request.id ?? "appr_1",
      status: request.status ?? "pending",
      requestedAt: request.requestedAt ?? new Date().toISOString()
    };
    this.approvals.push(approval);
    return approval;
  }

  async getApproval(id: string): Promise<ApprovalRequest | undefined> {
    return this.approvals.find((approval) => approval.id === id);
  }

  async listApprovals(filter: { runId?: string; status?: ApprovalRequest["status"]; limit?: number } = {}): Promise<ApprovalRequest[]> {
    return this.approvals
      .filter((approval) => (!filter.runId || approval.runId === filter.runId) && (!filter.status || approval.status === filter.status))
      .slice(0, filter.limit ?? this.approvals.length);
  }

  async decideApproval(decision: ApprovalDecision): Promise<ApprovalRequest> {
    const approval = await this.getApproval(decision.approvalId);
    if (!approval) throw new Error("approval missing");
    approval.status = decision.decision === "approved" ? "approved" : "denied";
    approval.decidedAt = decision.decidedAt ?? new Date().toISOString();
    approval.decidedBy = decision.decidedBy;
    approval.decisionReason = decision.reason;
    return approval;
  }
}

describe("runtime", () => {
  it("runs a tool call and records trace events", async () => {
    const events: RuntimeEvent[] = [];
    const tool: Tool = {
      name: "read_file",
      description: "fake read",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } }
      },
      requiredPermissions: ["fs:read"],
      async execute(input) {
        return { ok: true, output: { path: (input as { path: string }).path, content: "hello" } };
      }
    };

    const agent: Agent = { name: "test-agent", instructions: "test" };
    const runtime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([
        {
          finishReason: "tool-calls",
          message: { role: "assistant", toolCalls: [{ id: "call_1", name: "read_file", input: { path: "README.md" } }] }
        },
        {
          finishReason: "stop",
          message: { role: "assistant", content: "done" }
        }
      ]),
      tools: [tool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(events)
    });

    const result = await runtime.run(agent, "read");
    expect(result.status).toBe("completed");
    expect(result.finalMessage).toBe("done");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.started", "context.prepared", "model.completed", "tool.started", "tool.completed", "run.completed"])
    );
    expect(events.filter((event) => event.type === "run.checkpoint").map((event) => event.data.phase)).toEqual(
      expect.arrayContaining(["context_prepared", "model_completed", "tools_completed"])
    );
  });

  it("resumes from a model-completed final checkpoint without calling the model again", async () => {
    const events: RuntimeEvent[] = [];
    let modelCalls = 0;
    const runtime = createRuntime({
      workspaceRoot: process.cwd(),
      model: {
        name: "counting-model",
        async complete() {
          modelCalls += 1;
          return { finishReason: "stop", message: { role: "assistant", content: "already done" } };
        }
      },
      tools: [],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(events)
    });

    const first = await runtime.run({ name: "agent", instructions: "test" }, "finish", { runId: "run_final_resume" });
    expect(first.status).toBe("completed");
    const checkpoint = [...events].reverse().find((event) => event.type === "run.checkpoint" && event.data.phase === "model_completed");
    expect(checkpoint?.data.state).toBeTruthy();

    const resumedEvents: RuntimeEvent[] = [];
    const resumed = createRuntime({
      workspaceRoot: process.cwd(),
      model: {
        name: "should-not-call",
        async complete() {
          modelCalls += 1;
          return { finishReason: "stop", message: { role: "assistant", content: "called again" } };
        }
      },
      tools: [],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(resumedEvents)
    });
    const second = await resumed.run({ name: "agent", instructions: "test" }, "finish", { runId: "run_final_resume", resumeState: checkpoint!.data.state as never });

    expect(second.status).toBe("completed");
    expect(second.finalMessage).toBe("already done");
    expect(modelCalls).toBe(1);
    expect(resumedEvents.some((event) => event.type === "model.completed")).toBe(false);
  });

  it("stops at maxSteps", async () => {
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([
        {
          finishReason: "tool-calls",
          message: { role: "assistant", toolCalls: [{ id: "call_1", name: "missing", input: {} }] }
        }
      ]),
      tools: [],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(events),
      limits: { maxSteps: 1 }
    });

    const result = await runtime.run({ name: "test", instructions: "test" }, "loop");
    expect(result.status).toBe("failed");
    expect(events.at(-1)?.type).toBe("run.failed");
  });

  it("pauses on approval-required tools and can reuse an approved request on resume", async () => {
    const approvals = new MemoryApprovalStore();
    const firstEvents: RuntimeEvent[] = [];
    const writeTool: Tool = {
      name: "write_file",
      description: "fake write",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } }
      },
      requiredPermissions: ["fs:write"],
      async execute(input) {
        return { ok: true, output: { path: (input as { path: string }).path, written: true } };
      }
    };
    const toolCall = { id: "call_write", name: "write_file", input: { path: "README.md" } };
    const agent: Agent = { name: "test-agent", instructions: "test" };

    const firstRuntime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "tool-calls", message: { role: "assistant", toolCalls: [toolCall] } }]),
      tools: [writeTool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(firstEvents),
      approvals
    });

    const paused = await firstRuntime.run(agent, "write", { runId: "run_approval" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.approvalId).toBe(approvals.approvals[0].id);
    expect(firstEvents.map((event) => event.type)).toEqual(expect.arrayContaining(["approval.required", "run.checkpoint", "run.waiting_approval"]));
    const resumeState = [...firstEvents].reverse().find((event) => event.type === "run.checkpoint" && event.data.phase === "waiting_approval")?.data.state;

    await approvals.decideApproval({ approvalId: approvals.approvals[0].id, decision: "approved", decidedBy: "test" });
    const resumedEvents: RuntimeEvent[] = [];
    const resumedRuntime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "stop", message: { role: "assistant", content: "resumed" } }]),
      tools: [writeTool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(resumedEvents),
      approvals
    });

    const completed = await resumedRuntime.run(agent, "write", { runId: "run_approval", resumeState: resumeState as never });
    expect(completed.status).toBe("completed");
    expect(completed.finalMessage).toBe("resumed");
    expect(resumedEvents.map((event) => event.type)).toEqual(expect.arrayContaining(["run.resumed", "approval.used", "tool.completed", "run.completed"]));
    expect(resumedEvents.filter((event) => event.type === "model.completed")).toHaveLength(1);
  });

  it("cancels a checkpointed run when approval is denied", async () => {
    const approvals = new MemoryApprovalStore();
    const firstEvents: RuntimeEvent[] = [];
    const tool: Tool = {
      name: "write_file",
      description: "fake write",
      inputSchema: { type: "object" },
      requiredPermissions: ["fs:write"],
      async execute() {
        return { ok: true, output: { written: true } };
      }
    };
    const runtime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "tool-calls", message: { role: "assistant", toolCalls: [{ id: "call_write", name: "write_file", input: {} }] } }]),
      tools: [tool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(firstEvents),
      approvals
    });
    const paused = await runtime.run({ name: "agent", instructions: "test" }, "write", { runId: "run_denied" });
    const resumeState = [...firstEvents].reverse().find((event) => event.type === "run.checkpoint" && event.data.phase === "waiting_approval")?.data.state;
    await approvals.decideApproval({ approvalId: paused.approvalId!, decision: "denied", reason: "nope" });

    const resumedEvents: RuntimeEvent[] = [];
    const resumed = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "stop", message: { role: "assistant", content: "should not happen" } }]),
      tools: [tool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(resumedEvents),
      approvals
    });
    const result = await resumed.run({ name: "agent", instructions: "test" }, "write", { runId: "run_denied", resumeState: resumeState as never });
    expect(result.status).toBe("cancelled");
    expect(resumedEvents.map((event) => event.type)).toEqual(expect.arrayContaining(["tool.rejected", "run.cancelled"]));
    expect(resumedEvents.some((event) => event.type === "model.completed")).toBe(false);
  });

  it("checkpoints completed parallel tool results before waiting for approval", async () => {
    const approvals = new MemoryApprovalStore();
    const firstEvents: RuntimeEvent[] = [];
    let readCount = 0;
    let writeCount = 0;
    const readTool: Tool = {
      name: "read_file",
      description: "fake read",
      inputSchema: { type: "object" },
      requiredPermissions: ["fs:read"],
      async execute() {
        readCount += 1;
        return { ok: true, output: { content: "already read" } };
      }
    };
    const writeTool: Tool = {
      name: "write_file",
      description: "fake write",
      inputSchema: { type: "object" },
      requiredPermissions: ["fs:write"],
      async execute() {
        writeCount += 1;
        return { ok: true, output: { written: true } };
      }
    };
    const agent: Agent = { name: "agent", instructions: "test" };
    const toolCalls = [
      { id: "call_write", name: "write_file", input: {} },
      { id: "call_read", name: "read_file", input: {} }
    ];

    const runtime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "tool-calls", message: { role: "assistant", toolCalls } }]),
      tools: [readTool, writeTool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(firstEvents),
      approvals
    });

    const paused = await runtime.run(agent, "parallel approval", { runId: "run_parallel_approval" });
    expect(paused.status).toBe("waiting_approval");
    expect(readCount).toBe(1);
    expect(writeCount).toBe(0);
    expect(firstEvents.map((event) => event.type)).toEqual(expect.arrayContaining(["tool.completed", "artifact.created", "run.checkpoint", "run.waiting_approval"]));
    const checkpoint = [...firstEvents].reverse().find((event) => event.type === "run.checkpoint" && event.data.phase === "waiting_approval");
    const resumeState = checkpoint?.data.state;
    expect(JSON.stringify(resumeState)).toContain("call_read");
    expect(checkpoint?.data.completedToolCallIds).toEqual(["call_read"]);

    await approvals.decideApproval({ approvalId: paused.approvalId!, decision: "approved", decidedBy: "test" });
    const resumedEvents: RuntimeEvent[] = [];
    const resumed = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "stop", message: { role: "assistant", content: "done" } }]),
      tools: [readTool, writeTool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(resumedEvents),
      approvals
    });

    const completed = await resumed.run(agent, "parallel approval", { runId: "run_parallel_approval", resumeState: resumeState as never });
    expect(completed.status).toBe("completed");
    expect(readCount).toBe(1);
    expect(writeCount).toBe(1);
    expect(resumedEvents.filter((event) => event.type === "tool.completed" && event.data.id === "call_read")).toHaveLength(0);
    expect(resumedEvents.filter((event) => event.type === "tool.completed" && event.data.id === "call_write")).toHaveLength(1);
  });

  it("cancels tool execution when the run aborts even if the tool ignores its signal", async () => {
    const events: RuntimeEvent[] = [];
    const slowTool: Tool = {
      name: "slow_tool",
      description: "slow",
      inputSchema: { type: "object" },
      requiredPermissions: ["fs:read"],
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return { ok: true, output: { late: true } };
      }
    };
    const runtime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "tool-calls", message: { role: "assistant", toolCalls: [{ id: "call_slow", name: "slow_tool", input: {} }] } }]),
      tools: [slowTool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(events),
      limits: { maxRunMs: 10 }
    });

    const result = await runtime.run({ name: "agent", instructions: "test" }, "slow");
    expect(result.status).toBe("cancelled");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["tool.failed", "run.cancelled"]));
    expect(events.some((event) => event.type === "tool.failed" && event.data.error && JSON.stringify(event.data.error).includes("TOOL_CANCELLED"))).toBe(true);
  });
});
