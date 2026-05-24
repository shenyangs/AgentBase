import {
  createId,
  type AgentSpec,
  type Handoff,
  type RunState,
  type Runtime,
  type RuntimeEvent,
  type RuntimeEventType,
  type SpecialistHandoffDecision,
  type SpecialistManifest,
  type TaskSpec,
  type TraceStore,
  type WorkflowExecutionResult,
  type WorkflowExecutor,
  type WorkflowResumeState,
  type WorkflowSpec
} from "@agentbase/core";

export type BlackboardEntry = {
  id: string;
  taskId: string;
  agent: string;
  content: string;
  artifactRefs?: string[];
  createdAt: string;
};

export type OrchestrationPlan = {
  workflow: string;
  mode: "crew" | "flow";
  assignments: Array<Omit<TaskSpec, "agent"> & { agent: AgentSpec; requestedAgent?: string }>;
  handoffs: Handoff[];
  blackboard: BlackboardEntry[];
};

export type WorkflowTaskRunResult = {
  output?: string;
  runId?: string;
  status?: "completed" | "failed" | "waiting_approval" | "cancelled";
  approvalId?: string;
  artifactRefs?: string[];
};

export type WorkflowTaskRunner = (
  task: TaskSpec,
  agent: AgentSpec,
  context: { workflow: WorkflowSpec; dependencyOutputs: Record<string, string>; dependencyArtifacts: Record<string, string[]>; sessionId?: string; signal?: AbortSignal; resumeState?: RunState }
) => Promise<WorkflowTaskRunResult>;

export function createOrchestrationPlan(workflow: WorkflowSpec): OrchestrationPlan {
  const agents = new Map(workflow.agents.map((agent) => [agent.name, agent]));
  const fallback = workflow.agents[0];
  if (!fallback) {
    throw new Error("Workflow requires at least one agent");
  }
  const assignments = workflow.tasks.map(({ agent, ...task }) => {
    const selected = agent ? agents.get(agent) ?? fallback : selectSpecialist(workflow.agents, task)?.agent ?? fallback;
    return { ...task, requestedAgent: agent, agent: selected };
  });
  const handoffs: Handoff[] = [];
  for (const task of assignments) {
    for (const dep of task.dependsOn ?? []) {
      const from = assignments.find((candidate) => candidate.id === dep)?.agent.name;
      if (from && from !== task.agent.name) {
        const decision = specialistHandoffDecision(task.agent, `Task ${task.id} depends on ${dep}`, from);
        handoffs.push({ from, to: task.agent.name, reason: decision.reason, payload: { taskId: task.id, dependsOn: dep, specialist: decision } });
      }
    }
  }
  return { workflow: workflow.name, mode: workflow.mode ?? "crew", assignments, handoffs, blackboard: [] };
}

export function defaultAgentSpecs(): AgentSpec[] {
  return [
    withSpecialist({ name: "supervisor", role: "supervisor", instructions: "Coordinate agents, assign tasks, and synthesize final output." }, ["coordinate", "supervise", "synthesize"]),
    withSpecialist({ name: "planner", role: "planner", instructions: "Break goals into concrete steps and acceptance criteria." }, ["plan", "steps", "roadmap"]),
    withSpecialist({ name: "researcher", role: "researcher", instructions: "Gather evidence and cite uncertainty." }, ["research", "evidence", "source", "search"], { needsFreshInfo: true }),
    withSpecialist({ name: "coder", role: "coder", instructions: "Implement scoped code changes and report changed files." }, ["code", "implement", "fix", "test"]),
    withSpecialist({ name: "critic", role: "critic", instructions: "Review results for bugs, risks, and missing tests." }, ["review", "critic", "risk", "bug"]),
    withSpecialist({ name: "memory-curator", role: "memory-curator", instructions: "Promote durable lessons into memory after evidence appears." }, ["memory", "lesson", "curate", "promote"])
  ];
}

export function validateSpecialistManifest(manifest: SpecialistManifest): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  if (!manifest.name) issues.push({ path: "name", message: "specialist name is required" });
  if (!manifest.role) issues.push({ path: "role", message: "specialist role is required" });
  if (!manifest.trigger || (!manifest.trigger.description && !manifest.trigger.keywords?.length && !manifest.trigger.taskTypes?.length)) {
    issues.push({ path: "trigger", message: "specialist trigger must include description, keywords, or taskTypes" });
  }
  if (manifest.confidence !== undefined && (manifest.confidence < 0 || manifest.confidence > 1)) {
    issues.push({ path: "confidence", message: "specialist confidence must be between 0 and 1" });
  }
  return issues;
}

export function specialistManifestFromAgent(agent: AgentSpec): SpecialistManifest {
  return (
    agent.specialist ?? {
      name: agent.name,
      role: agent.role ?? agent.name,
      trigger: {
        keywords: [agent.role ?? agent.name],
        description: agent.handoffDescription ?? agent.instructions.slice(0, 240)
      },
      confidence: 0.5
    }
  );
}

export function selectSpecialist(agents: AgentSpec[], task: Pick<TaskSpec, "input" | "metadata">): { agent: AgentSpec; decision: SpecialistHandoffDecision } | undefined {
  const scored = agents
    .map((agent) => {
      const manifest = specialistManifestFromAgent(agent);
      const score = scoreSpecialist(manifest, task);
      return { agent, manifest, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best) return undefined;
  const confidence = Math.min(1, Math.max(best.manifest.confidence ?? 0.5, best.score));
  return {
    agent: best.agent,
    decision: {
      to: best.agent.name,
      confidence,
      reason: `Specialist ${best.agent.name} matched task trigger`,
      needsFreshInfo: best.manifest.needsFreshInfo,
      riskFlags: best.manifest.riskFlags
    }
  };
}

export function createWorkflowExecutor(options: { runTask: WorkflowTaskRunner; maxParallelTasks?: number; shouldCancel?: () => Promise<boolean> }): WorkflowExecutor {
  return {
    async execute(workflow, input = {}): Promise<WorkflowExecutionResult> {
      const plan = createOrchestrationPlan(workflow);
      const resumeState = input.resumeState ?? {};
      const completedTasks = resumeState.completedTasks ?? {};
      const pending = new Map(plan.assignments.filter((task) => !(task.id in completedTasks)).map((task) => [task.id, task]));
      const outputs: Record<string, string> = Object.fromEntries(Object.entries(completedTasks).map(([taskId, task]) => [taskId, task.output ?? ""]));
      const artifactsByTask: Record<string, string[]> = Object.fromEntries(Object.entries(completedTasks).map(([taskId, task]) => [taskId, task.artifactRefs ?? []]));
      const assignments: WorkflowExecutionResult["assignments"] = Object.entries(completedTasks).map(([taskId, task]) => ({
        taskId,
        agent: task.agent,
        status: "completed",
        output: task.output,
        runId: task.runId,
        artifactRefs: task.artifactRefs ?? []
      }));
      const blackboard: BlackboardEntry[] = [];
      let terminalStatus: WorkflowExecutionResult["status"] = "completed";
      const maxParallelTasks = Math.max(1, input.maxParallelTasks ?? options.maxParallelTasks ?? 2);

      while (pending.size > 0) {
        if (input.signal?.aborted || (await options.shouldCancel?.())) {
          terminalStatus = "cancelled";
          for (const task of pending.values()) {
            assignments.push({ taskId: task.id, agent: task.agent.name, status: "cancelled", output: "Workflow cancelled before task started", artifactRefs: [] });
          }
          break;
        }

        const ready = [...pending.values()].filter((task) => (task.dependsOn ?? []).every((dependency) => dependency in outputs));
        if (ready.length === 0) {
          terminalStatus = "failed";
          for (const task of pending.values()) {
            assignments.push({ taskId: task.id, agent: task.agent.name, status: "failed", output: "Dependency cycle or failed dependency" });
          }
          break;
        }

        const batch = workflow.mode === "flow" ? ready.slice(0, maxParallelTasks) : [ready[0]];
        const results = await Promise.all(
          batch.map(async (task) => {
            pending.delete(task.id);
            const taskSpec: TaskSpec = {
              id: task.id,
              input: task.input,
              agent: task.requestedAgent,
              dependsOn: task.dependsOn,
              metadata: task.metadata
            };
            try {
              const result = await options.runTask(taskSpec, task.agent, {
                workflow,
                dependencyOutputs: pick(outputs, task.dependsOn ?? []),
                dependencyArtifacts: pickArtifacts(artifactsByTask, task.dependsOn ?? []),
                sessionId: input.sessionId,
                signal: input.signal,
                resumeState: resumeState.taskRunStates?.[task.id]
              });
              return { task, result };
            } catch (error) {
              return {
                task,
                result: {
                  status: "failed" as const,
                  output: error instanceof Error ? error.message : String(error)
                }
              };
            }
          })
        );

        for (const { task, result } of results) {
          const status = result.status ?? "completed";
          assignments.push({ taskId: task.id, agent: task.agent.name, status, output: result.output, runId: result.runId, approvalId: result.approvalId, artifactRefs: result.artifactRefs ?? [] });
          if (status !== "completed") {
            terminalStatus = status;
            continue;
          }
          outputs[task.id] = result.output ?? "";
          artifactsByTask[task.id] = result.artifactRefs ?? [];
          blackboard.push({ id: `bb_${task.id}`, taskId: task.id, agent: task.agent.name, content: result.output ?? "", artifactRefs: result.artifactRefs ?? [], createdAt: new Date().toISOString() });
        }
        if (terminalStatus !== "completed") {
          break;
        }
      }

      return {
        workflow: workflow.name,
        status: terminalStatus,
        assignments,
        handoffs: plan.handoffs,
        metadata: { blackboard }
      };
    }
  };
}

export type RuntimeWorkflowExecutorOptions = {
  runtime: Runtime;
  trace?: TraceStore;
  readRun?: (runId: string) => Promise<RuntimeEvent[]>;
  parentRunIdPrefix?: string;
  maxParallelTasks?: number;
  formatTaskInput?: (
    task: TaskSpec,
    agent: AgentSpec,
    context: { workflow: WorkflowSpec; dependencyOutputs: Record<string, string>; dependencyArtifacts: Record<string, string[]> }
  ) => string;
};

export function createRuntimeWorkflowExecutor(options: RuntimeWorkflowExecutorOptions): WorkflowExecutor {
  return {
    async execute(workflow, input = {}) {
      const parentRunId = input.runId ?? createId(options.parentRunIdPrefix ?? "workflow_run");
      const startedAt = new Date().toISOString();
      const resumeState = input.resumeState ?? (input.resume ? await loadWorkflowResumeState(parentRunId, workflow, options.readRun) : undefined);
      const lifecycleEvent: RuntimeEventType = input.resume ? "run.resumed" : "run.started";
      await writeWorkflowEvent(options.trace, parentRunId, lifecycleEvent, {
        agent: "workflow",
        input: workflow.name,
        sessionId: input.sessionId,
        resume: input.resume ? true : undefined,
        metadata: { workflow: workflow.name, mode: workflow.mode ?? "crew" }
      });
      await writeWorkflowEvent(options.trace, parentRunId, input.resume ? "workflow.resumed" : "workflow.started", {
        workflow: workflow.name,
        mode: workflow.mode ?? "crew",
        resume: input.resume ? true : undefined,
        completedTasks: resumeState?.completedTasks ? Object.keys(resumeState.completedTasks) : undefined,
        resumedTasks: resumeState?.taskRunStates ? Object.keys(resumeState.taskRunStates) : undefined,
        tasks: workflow.tasks.map((task) => ({ id: task.id, agent: task.agent, dependsOn: task.dependsOn ?? [] })),
        agents: workflow.agents.map((agent) => ({ name: agent.name, role: agent.role }))
      });

      const plan = createOrchestrationPlan(workflow);
      for (const handoff of plan.handoffs) {
        await writeWorkflowEvent(options.trace, parentRunId, "agent.handoff", handoff as unknown as Record<string, unknown>);
      }

      const executor = createWorkflowExecutor({
        maxParallelTasks: options.maxParallelTasks,
        shouldCancel: options.readRun ? async () => hasWorkflowCancellation(await options.readRun!(parentRunId).catch(() => [])) : undefined,
        async runTask(task, agent, context) {
          const childRunId = childRunIdFor(parentRunId, task.id);
          const resumedTask = Boolean(context.resumeState);
          await writeWorkflowEvent(options.trace, parentRunId, resumedTask ? "workflow.step.resumed" : "workflow.step.started", {
            workflow: workflow.name,
            taskId: task.id,
            agent: agent.name,
            childRunId,
            resumed: resumedTask,
            dependsOn: task.dependsOn ?? []
          });
          const result = await options.runtime.run(agent, formatTaskInput(options, task, agent, context), {
            runId: childRunId,
            sessionId: context.sessionId,
            parentRunId,
            resumeState: context.resumeState,
            signal: context.signal,
            metadata: {
              workflow: workflow.name,
              taskId: task.id,
              agent: agent.name,
              dependsOn: task.dependsOn ?? []
            }
          });
          const status = taskStatusFromRun(result.status);
          const artifactRefs = await collectArtifactRefs(options.readRun, childRunId);
          await writeWorkflowEvent(options.trace, parentRunId, workflowStepTerminalEvent(status), {
            workflow: workflow.name,
            taskId: task.id,
            agent: agent.name,
            childRunId,
            status,
            approvalId: result.approvalId,
            outputPreview: result.finalMessage?.slice(0, 2000),
            artifactRefs
          });
          return {
            runId: childRunId,
            status,
            approvalId: result.approvalId,
            artifactRefs,
            output: result.finalMessage ?? (result.approvalId ? `Approval required: ${result.approvalId}` : `Run ${result.status}`)
          };
        }
      });

      const result = await executor.execute(workflow, { ...input, runId: parentRunId, resumeState, maxParallelTasks: input.maxParallelTasks ?? options.maxParallelTasks });
      result.metadata = { ...(result.metadata ?? {}), parentRunId, startedAt, completedAt: new Date().toISOString() };
      if (result.status === "waiting_approval") {
        await writeWorkflowEvent(options.trace, parentRunId, "workflow.checkpoint", {
          workflow: workflow.name,
          status: result.status,
          assignments: result.assignments,
          approvalId: result.assignments.find((assignment) => assignment.approvalId)?.approvalId
        });
      }
      await writeWorkflowEvent(options.trace, parentRunId, workflowTerminalEvent(result.status), {
        workflow: workflow.name,
        status: result.status,
        assignments: result.assignments
      });
      await writeWorkflowEvent(options.trace, parentRunId, runTerminalEvent(result.status), {
        status: result.status,
        steps: result.assignments.length,
        reason: result.status === "completed" ? undefined : `workflow ${result.status}`
      });
      return result;
    }
  };
}

async function loadWorkflowResumeState(parentRunId: string, workflow: WorkflowSpec, readRun: RuntimeWorkflowExecutorOptions["readRun"]): Promise<WorkflowResumeState | undefined> {
  if (!readRun) {
    return undefined;
  }
  const parentEvents = await readRun(parentRunId);
  const completedTasks: WorkflowResumeState["completedTasks"] = {};
  const taskRunStates: WorkflowResumeState["taskRunStates"] = {};
  for (const event of parentEvents) {
    if (event.type === "workflow.step.completed") {
      const taskId = stringField(event.data, "taskId");
      const agent = stringField(event.data, "agent");
      if (taskId && agent) {
        completedTasks[taskId] = {
          agent,
          output: stringField(event.data, "outputPreview"),
          runId: stringField(event.data, "childRunId"),
          artifactRefs: stringArrayField(event.data, "artifactRefs")
        };
      }
    }
  }
  for (const task of workflow.tasks) {
    if (completedTasks[task.id]) {
      continue;
    }
    const childRunId = childRunIdFor(parentRunId, task.id);
    const childEvents = await readRun(childRunId).catch(() => []);
    const checkpoint = [...childEvents].reverse().find((event) => event.type === "run.checkpoint");
    if (isRunState(checkpoint?.data.state)) {
      taskRunStates[task.id] = checkpoint.data.state;
    }
  }
  return Object.keys(completedTasks).length > 0 || Object.keys(taskRunStates).length > 0 ? { completedTasks, taskRunStates } : undefined;
}

function workflowStepTerminalEvent(status: WorkflowExecutionResult["status"]): RuntimeEventType {
  if (status === "completed") return "workflow.step.completed";
  if (status === "waiting_approval") return "workflow.step.waiting_approval";
  if (status === "cancelled") return "workflow.step.cancelled";
  return "workflow.step.failed";
}

function workflowTerminalEvent(status: WorkflowExecutionResult["status"]): RuntimeEventType {
  if (status === "completed") return "workflow.completed";
  if (status === "waiting_approval") return "workflow.waiting_approval";
  if (status === "cancelled") return "workflow.cancelled";
  return "workflow.failed";
}

function runTerminalEvent(status: WorkflowExecutionResult["status"]): RuntimeEventType {
  if (status === "completed") return "run.completed";
  if (status === "waiting_approval") return "run.waiting_approval";
  if (status === "cancelled") return "run.cancelled";
  return "run.failed";
}

function pick(values: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
}

function pickArtifacts(values: Record<string, string[]>, keys: string[]): Record<string, string[]> {
  return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
}

function formatTaskInput(
  options: RuntimeWorkflowExecutorOptions,
  task: TaskSpec,
  agent: AgentSpec,
  context: { workflow: WorkflowSpec; dependencyOutputs: Record<string, string>; dependencyArtifacts: Record<string, string[]> }
): string {
  if (options.formatTaskInput) {
    return options.formatTaskInput(task, agent, context);
  }
  const dependencies = Object.entries(context.dependencyOutputs)
    .map(([id, output]) => `## Dependency: ${id}\n${output}`)
    .join("\n\n");
  const dependencyArtifacts = Object.entries(context.dependencyArtifacts)
    .filter(([, refs]) => refs.length > 0)
    .map(([id, refs]) => `## Dependency Artifacts (untrusted): ${id}\n${refs.map((ref) => `- ${ref}`).join("\n")}`)
    .join("\n\n");
  return [
    `Workflow: ${context.workflow.name}`,
    `Task: ${task.id}`,
    agent.role ? `Role: ${agent.role}` : undefined,
    "",
    "Task input:",
    task.input,
    dependencies ? "" : undefined,
    dependencies || undefined,
    dependencyArtifacts ? "" : undefined,
    dependencyArtifacts || undefined,
    "",
    "Return the task result concisely. Include concrete evidence when you used tools."
  ]
    .filter((part) => part !== undefined)
    .join("\n");
}

async function collectArtifactRefs(readRun: RuntimeWorkflowExecutorOptions["readRun"], runId: string): Promise<string[]> {
  if (!readRun) {
    return [];
  }
  const events = await readRun(runId).catch(() => []);
  return events
    .filter((event) => event.type === "artifact.created")
    .map((event) => stringField(event.data, "id"))
    .filter((ref): ref is string => Boolean(ref));
}

function hasWorkflowCancellation(events: RuntimeEvent[]): boolean {
  return events.some((event) => event.type === "workflow.cancel_requested" || event.type === "workflow.cancelled" || event.type === "run.cancelled");
}

function taskStatusFromRun(status: string): "completed" | "failed" | "waiting_approval" | "cancelled" {
  if (status === "completed" || status === "waiting_approval" || status === "cancelled") {
    return status;
  }
  return "failed";
}

function withSpecialist(agent: AgentSpec, keywords: string[], options: Partial<Pick<SpecialistManifest, "needsFreshInfo" | "riskFlags" | "result">> = {}): AgentSpec {
  return {
    ...agent,
    specialist: {
      name: agent.name,
      role: agent.role ?? agent.name,
      trigger: {
        keywords,
        taskTypes: [agent.role ?? agent.name],
        description: agent.handoffDescription ?? agent.instructions
      },
      confidence: 0.65,
      ...options
    }
  };
}

function specialistHandoffDecision(agent: AgentSpec, reason: string, from?: string): SpecialistHandoffDecision {
  const manifest = specialistManifestFromAgent(agent);
  return {
    from,
    to: agent.name,
    confidence: manifest.confidence ?? 0.5,
    reason,
    needsFreshInfo: manifest.needsFreshInfo,
    riskFlags: manifest.riskFlags
  };
}

function scoreSpecialist(manifest: SpecialistManifest, task: Pick<TaskSpec, "input" | "metadata">): number {
  const haystack = `${task.input} ${JSON.stringify(task.metadata ?? {})}`.toLowerCase();
  const keywords = manifest.trigger.keywords ?? [];
  const taskTypes = manifest.trigger.taskTypes ?? [];
  const keywordScore = keywords.reduce((score, keyword) => score + (keyword && haystack.includes(keyword.toLowerCase()) ? 0.35 : 0), 0);
  const taskTypeScore = taskTypes.reduce((score, taskType) => score + (taskType && haystack.includes(taskType.toLowerCase()) ? 0.25 : 0), 0);
  const descriptionScore = manifest.trigger.description && haystack.includes(manifest.role.toLowerCase()) ? 0.2 : 0;
  return Math.min(1, keywordScore + taskTypeScore + descriptionScore);
}

function childRunIdFor(parentRunId: string, taskId: string): string {
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48) || "task";
  return `${parentRunId}_${safeTaskId}`;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string") : [];
}

function isRunState(value: unknown): value is RunState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.runId === "string" &&
    typeof record.input === "string" &&
    Array.isArray(record.messages) &&
    typeof record.steps === "number" &&
    typeof record.toolErrors === "number" &&
    Array.isArray(record.artifacts) &&
    typeof record.startedAt === "string" &&
    Boolean(record.metadata) &&
    typeof record.metadata === "object"
  );
}

async function writeWorkflowEvent(trace: TraceStore | undefined, runId: string, type: RuntimeEventType, data: Record<string, unknown>): Promise<RuntimeEvent | undefined> {
  if (!trace) {
    return undefined;
  }
  const event: RuntimeEvent = {
    id: createId("evt"),
    runId,
    type,
    ts: new Date().toISOString(),
    data
  };
  await trace.write(event);
  return event;
}
