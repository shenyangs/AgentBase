import { describe, expect, it } from "vitest";
import { createMockModelProvider, createRuntime, type ApprovalDecision, type ApprovalRequest, type ApprovalStore, type ContextManager, type RuntimeEvent, type TraceStore } from "@agentbase/core";
import { createOrchestrationPlan, createRuntimeWorkflowExecutor, createWorkflowExecutor, defaultAgentSpecs, selectSpecialist, validateSpecialistManifest } from "./index";

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
      return { messages: input.state.messages, snapshot: { messageCount: input.state.messages.length, tokenEstimate: 10, items: [] } };
    },
    async observe() {}
  };
}

class MemoryApprovalStore implements ApprovalStore {
  readonly approvals: ApprovalRequest[] = [];

  async createApproval(request: Omit<ApprovalRequest, "id" | "status" | "requestedAt"> & Partial<Pick<ApprovalRequest, "id" | "status" | "requestedAt">>): Promise<ApprovalRequest> {
    const approval: ApprovalRequest = {
      ...request,
      id: request.id ?? `appr_${this.approvals.length + 1}`,
      status: request.status ?? "pending",
      requestedAt: request.requestedAt ?? new Date().toISOString(),
      permissions: request.permissions ?? []
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

describe("orchestrator", () => {
  it("creates handoffs between dependent tasks", () => {
    const agents = defaultAgentSpecs();
    const plan = createOrchestrationPlan({
      name: "demo",
      agents,
      tasks: [
        { id: "research", input: "research", agent: "researcher" },
        { id: "code", input: "code", agent: "coder", dependsOn: ["research"] }
      ]
    });
    expect(plan.handoffs[0].from).toBe("researcher");
    expect(plan.handoffs[0].to).toBe("coder");
  });

  it("selects specialists from manifest triggers", () => {
    const agents = defaultAgentSpecs();
    const selected = selectSpecialist(agents, { input: "research fresh evidence and cite sources" });
    expect(selected?.agent.name).toBe("researcher");
    expect(selected?.decision.needsFreshInfo).toBe(true);
    expect(validateSpecialistManifest(selected!.agent.specialist!)).toEqual([]);
    const plan = createOrchestrationPlan({ name: "auto-specialist", agents, tasks: [{ id: "research", input: "research fresh evidence and cite sources" }] });
    expect(plan.assignments[0].agent.name).toBe("researcher");
  });

  it("executes flow tasks through a runner", async () => {
    const executor = createWorkflowExecutor({
      async runTask(task, agent, context) {
        return { output: `${agent.name}:${task.input}:${Object.keys(context.dependencyOutputs).join(",")}`, runId: `run_${task.id}` };
      }
    });
    const result = await executor.execute({
      name: "demo",
      mode: "flow",
      agents: defaultAgentSpecs(),
      tasks: [
        { id: "plan", input: "goal", agent: "planner" },
        { id: "code", input: "goal", agent: "coder", dependsOn: ["plan"] }
      ]
    });
    expect(result.status).toBe("completed");
    expect(result.assignments[1].runId).toBe("run_code");
  });

  it("passes dependency artifact refs through the workflow blackboard", async () => {
    const concurrency: number[] = [];
    let active = 0;
    const executor = createWorkflowExecutor({
      maxParallelTasks: 2,
      async runTask(task, agent, context) {
        active += 1;
        concurrency.push(active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          output: `${agent.name}:${task.id}:${Object.keys(context.dependencyArtifacts).join(",")}`,
          runId: `run_${task.id}`,
          artifactRefs: [`tool-result://workflow/${task.id}`]
        };
      }
    });
    const result = await executor.execute({
      name: "artifact-flow",
      mode: "flow",
      agents: defaultAgentSpecs(),
      tasks: [
        { id: "research", input: "research", agent: "researcher" },
        { id: "plan", input: "plan", agent: "planner" },
        { id: "code", input: "code", agent: "coder", dependsOn: ["research", "plan"] }
      ]
    });
    expect(result.status).toBe("completed");
    expect(Math.max(...concurrency)).toBeGreaterThan(1);
    expect(result.assignments.find((assignment) => assignment.taskId === "research")?.artifactRefs).toEqual(["tool-result://workflow/research"]);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        blackboard: expect.arrayContaining([expect.objectContaining({ taskId: "research", artifactRefs: ["tool-result://workflow/research"] })])
      })
    );
  });

  it("cancels pending tasks at task boundaries", async () => {
    let checks = 0;
    const executor = createWorkflowExecutor({
      async shouldCancel() {
        checks += 1;
        return checks > 1;
      },
      async runTask(task) {
        return { output: task.id, runId: `run_${task.id}` };
      }
    });
    const result = await executor.execute({
      name: "cancel-demo",
      mode: "crew",
      agents: defaultAgentSpecs(),
      tasks: [
        { id: "plan", input: "plan", agent: "planner" },
        { id: "review", input: "review", agent: "critic", dependsOn: ["plan"] }
      ]
    });
    expect(result.status).toBe("cancelled");
    expect(result.assignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "plan", status: "completed" }), expect.objectContaining({ taskId: "review", status: "cancelled" })])
    );
  });

  it("executes workflow tasks as runtime child runs with parent trace events", async () => {
    const events: RuntimeEvent[] = [];
    const runtime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([
        { finishReason: "stop", message: { role: "assistant", content: "planned" } },
        { finishReason: "stop", message: { role: "assistant", content: "reviewed" } }
      ]),
      tools: [],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(events)
    });
    const executor = createRuntimeWorkflowExecutor({ runtime, trace: memoryTraceStore(events) });
    const result = await executor.execute(
      {
        name: "runtime-demo",
        mode: "crew",
        agents: defaultAgentSpecs(),
        tasks: [
          { id: "plan", input: "goal", agent: "planner" },
          { id: "review", input: "goal", agent: "critic", dependsOn: ["plan"] }
        ]
      },
      { runId: "workflow_run_test", sessionId: "ses_test" }
    );

    expect(result.status).toBe("completed");
    expect(result.assignments.map((assignment) => assignment.runId)).toEqual(["workflow_run_test_plan", "workflow_run_test_review"]);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["workflow.started", "workflow.step.started", "workflow.step.completed", "workflow.completed"]));
    expect(events.some((event) => event.runId === "workflow_run_test_plan" && event.type === "run.started")).toBe(true);
  });

  it("resumes workflow approval pauses without rerunning completed child tasks", async () => {
    const events: RuntimeEvent[] = [];
    const approvals = new MemoryApprovalStore();
    let writeExecutions = 0;
    const workflow = {
      name: "runtime-resume-demo",
      mode: "crew" as const,
      agents: defaultAgentSpecs(),
      tasks: [
        { id: "plan", input: "goal", agent: "planner" },
        { id: "write", input: "write", agent: "coder", dependsOn: ["plan"] }
      ]
    };
    const writeTool = {
      name: "write_contract",
      description: "Approval-gated write.",
      inputSchema: { type: "object" },
      requiredPermissions: ["fs:write"],
      async execute() {
        writeExecutions += 1;
        return { ok: true as const, output: { written: true } };
      }
    };
    const firstRuntime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([
        { finishReason: "stop", message: { role: "assistant", content: "planned" } },
        { finishReason: "tool-calls", message: { role: "assistant", toolCalls: [{ id: "call_write", name: "write_contract", input: {} }] } }
      ]),
      tools: [writeTool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(events),
      approvals
    });
    const firstExecutor = createRuntimeWorkflowExecutor({
      runtime: firstRuntime,
      trace: memoryTraceStore(events),
      readRun: async (runId) => events.filter((event) => event.runId === runId)
    });

    const paused = await firstExecutor.execute(workflow, { runId: "workflow_run_resume", sessionId: "ses_resume" });

    expect(paused.status).toBe("waiting_approval");
    expect(writeExecutions).toBe(0);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["workflow.step.completed", "workflow.step.waiting_approval", "workflow.checkpoint", "workflow.waiting_approval", "run.waiting_approval"]));
    expect(events.filter((event) => event.type === "workflow.step.started" && event.data.taskId === "plan")).toHaveLength(1);

    await approvals.decideApproval({ approvalId: paused.assignments.find((assignment) => assignment.approvalId)!.approvalId!, decision: "approved", decidedBy: "test" });
    const secondRuntime = createRuntime({
      workspaceRoot: process.cwd(),
      model: createMockModelProvider([{ finishReason: "stop", message: { role: "assistant", content: "written" } }]),
      tools: [writeTool],
      context: passthroughContext(),
      policy: "read-only",
      trace: memoryTraceStore(events),
      approvals
    });
    const resumedExecutor = createRuntimeWorkflowExecutor({
      runtime: secondRuntime,
      trace: memoryTraceStore(events),
      readRun: async (runId) => events.filter((event) => event.runId === runId)
    });

    const completed = await resumedExecutor.execute(workflow, { runId: "workflow_run_resume", sessionId: "ses_resume", resume: true });

    expect(completed.status).toBe("completed");
    expect(writeExecutions).toBe(1);
    expect(completed.assignments.map((assignment) => assignment.taskId)).toEqual(["plan", "write"]);
    expect(events.filter((event) => event.type === "workflow.step.started" && event.data.taskId === "plan")).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["workflow.resumed", "workflow.step.resumed", "approval.used", "workflow.completed"]));
  });
});
