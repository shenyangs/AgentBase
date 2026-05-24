import { createId } from "./id";
import { normalizePolicy } from "./policy";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import type {
  Agent,
  Message,
  ModelResponse,
  RunResult,
  RunState,
  Runtime,
  RuntimeConfig,
  RuntimeEvent,
  RuntimeEventInput,
  RuntimeLimits,
  ToolCall,
  ToolResult,
  ToolResultEnvelope,
  TraceWriter
} from "./types";

const DEFAULT_LIMITS: RuntimeLimits = {
  maxSteps: 30,
  maxToolErrors: 5,
  maxRunMs: 600_000
};

export function createRuntime(config: RuntimeConfig): Runtime {
  const limits = { ...DEFAULT_LIMITS, ...config.limits };
  const policy = normalizePolicy(config.policy);
  const registry = new ToolRegistry(config.tools);

  return {
    async run(agent: Agent, input: string, options = {}): Promise<RunResult> {
      const runId = options.runId ?? createId("run");
      const controller = new AbortController();
      const signal = mergeAbortSignals(options.signal, controller.signal);
      const timeout = setTimeout(() => controller.abort(new Error("Run timed out")), limits.maxRunMs);

      const state: RunState = options.resumeState
        ? {
            ...options.resumeState,
            runId,
            input,
            messages: [...options.resumeState.messages],
            artifacts: [...options.resumeState.artifacts],
            metadata: { ...(options.resumeState.metadata ?? {}), resumedAt: new Date().toISOString() }
          }
        : {
            runId,
            input,
            messages: [{ role: "user", content: input }],
            steps: 0,
            toolErrors: 0,
            artifacts: [],
            startedAt: new Date().toISOString(),
            metadata: {}
          };

      const trace = createRuntimeTraceWriter(runId, config.trace, config.context);
      const executor = new ToolExecutor({
        registry,
        workspaceRoot: config.workspaceRoot,
        policy,
        trace,
        approvals: config.approvals,
        env: config.env ?? process.env,
        signal,
        sessionId: options.sessionId,
        limits
      });

      try {
        if (options.resumeState) {
          await trace.write({
            type: "run.resumed",
            data: {
              agent: agent.name,
              input,
              policy: policy.name,
              sessionId: options.sessionId,
              parentRunId: options.parentRunId,
              checkpointSteps: options.resumeState.steps,
              metadata: options.metadata
            }
          });
        } else {
          await trace.write({
            type: "run.started",
            data: {
              agent: agent.name,
              input,
              policy: policy.name,
              sessionId: options.sessionId,
              parentRunId: options.parentRunId,
              metadata: options.metadata
            }
          });
        }

        while (state.steps < limits.maxSteps) {
          if (signal.aborted) {
            throw signal.reason instanceof Error ? signal.reason : new Error("Run aborted");
          }

          const pendingToolCalls = findPendingToolCalls(state);
          if (pendingToolCalls.length > 0) {
            const terminal = await executeToolCalls({
              calls: pendingToolCalls,
              runId,
              state,
              executor,
              trace,
              artifacts: config.artifacts,
              limits
            });
            if (terminal) {
              return terminal;
            }
            continue;
          }

          const checkpointedFinal = checkpointedFinalMessage(state);
          if (checkpointedFinal !== undefined) {
            await trace.write({ type: "run.completed", data: { steps: state.steps, status: "completed", resumedFromPhase: state.phase } });
            return { runId, status: "completed", steps: state.steps, finalMessage: checkpointedFinal };
          }

          state.steps += 1;
          const prepared = await config.context.prepare({
            agent,
            input,
            state,
            tools: registry.definitions(),
            policy,
            limits
          });

          await trace.write({ type: "context.prepared", data: prepared.snapshot as unknown as Record<string, unknown> });
          state.phase = "context_prepared";
          await writeRunCheckpoint(trace, "context_prepared", state, { snapshot: prepared.snapshot as unknown as Record<string, unknown> });

          const response = await config.model.complete(
            {
              messages: prepared.messages,
              tools: registry.definitions(),
              runId,
              step: state.steps
            },
            { runId, signal }
          );

          await trace.write({
            type: "model.completed",
            data: summarizeModelResponse(response)
          });

          state.messages.push(response.message);
          state.phase = "model_completed";
          await writeRunCheckpoint(trace, "model_completed", state, { model: summarizeModelResponse(response) });

          const toolCalls = response.message.role === "assistant" ? response.message.toolCalls ?? [] : [];
          if (toolCalls.length === 0) {
            const finalMessage = response.message.role === "assistant" ? response.message.content ?? "" : "";
            await trace.write({ type: "run.completed", data: { steps: state.steps, status: "completed" } });
            return { runId, status: "completed", steps: state.steps, finalMessage };
          }

          const terminal = await executeToolCalls({
            calls: toolCalls,
            runId,
            state,
            executor,
            trace,
            artifacts: config.artifacts,
            limits
          });
          if (terminal) {
            return terminal;
          }
        }

        await trace.write({ type: "run.failed", data: { steps: state.steps, reason: "max steps reached" } });
        return { runId, status: "failed", steps: state.steps };
      } catch (error) {
        if (signal.aborted) {
          await trace.write({
            type: "run.cancelled",
            data: { steps: state.steps, reason: error instanceof Error ? error.message : String(error) }
          });
          return { runId, status: "cancelled", steps: state.steps };
        }
        await trace.write({
          type: "run.failed",
          data: { steps: state.steps, reason: error instanceof Error ? error.message : String(error) }
        });
        return { runId, status: "failed", steps: state.steps };
      } finally {
        clearTimeout(timeout);
        await config.trace.close?.();
      }
    }
  };
}

function createRuntimeTraceWriter(runId: string, store: RuntimeConfig["trace"], context: RuntimeConfig["context"]): TraceWriter {
  return {
    async write(input: RuntimeEventInput): Promise<RuntimeEvent> {
      const event: RuntimeEvent = {
        id: createId("evt"),
        runId,
        type: input.type,
        ts: new Date().toISOString(),
        data: input.data ?? {}
      };

      await store.write(event);
      await context.observe(event);
      return event;
    }
  };
}

function summarizeModelResponse(response: ModelResponse): Record<string, unknown> {
  const toolCalls = response.message.role === "assistant" ? response.message.toolCalls ?? [] : [];
  const content = response.message.role === "assistant" ? response.message.content : undefined;

  return {
    finishReason: response.finishReason,
    toolCallCount: toolCalls.length,
    toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, input: call.input })),
    outputPreview: content ? preview(content) : undefined,
    usage: response.usage,
    metadata: response.metadata
  };
}

async function executeToolCalls(input: {
  calls: ToolCall[];
  runId: string;
  state: RunState;
  executor: ToolExecutor;
  trace: TraceWriter;
  artifacts?: RuntimeConfig["artifacts"];
  limits: RuntimeLimits;
}): Promise<RunResult | undefined> {
  const toolResults = await Promise.all(input.calls.map(async (call) => ({ call, result: await input.executor.execute(call, input.runId) })));
  const terminalApproval = toolResults.find(({ result }) => result.error?.code === "APPROVAL_REQUIRED");
  const deniedApproval = toolResults.find(({ result }) => result.error?.code === "APPROVAL_DENIED");
  const cancelledTool = toolResults.find(({ result }) => result.error?.code === "TOOL_CANCELLED");

  for (const { call, result } of toolResults) {
    if (result.error?.code === "APPROVAL_REQUIRED" || result.error?.code === "APPROVAL_DENIED" || result.error?.code === "TOOL_CANCELLED") {
      continue;
    }
    await recordToolResult(input, call, result);

    if (input.state.toolErrors >= input.limits.maxToolErrors) {
      await input.trace.write({
        type: "run.failed",
        data: { steps: input.state.steps, reason: "max tool errors reached", toolErrors: input.state.toolErrors }
      });
      return { runId: input.runId, status: "failed", steps: input.state.steps };
    }
  }

  if (cancelledTool) {
    await input.trace.write({
      type: "run.cancelled",
      data: { steps: input.state.steps, reason: cancelledTool.result.error?.message, toolCallId: cancelledTool.call.id, toolName: cancelledTool.call.name }
    });
    return { runId: input.runId, status: "cancelled", steps: input.state.steps };
  }

  if (deniedApproval) {
    await input.trace.write({
      type: "run.cancelled",
      data: { steps: input.state.steps, reason: deniedApproval.result.error?.message, toolCallId: deniedApproval.call.id, toolName: deniedApproval.call.name }
    });
    return { runId: input.runId, status: "cancelled", steps: input.state.steps };
  }

  if (terminalApproval) {
    const approvalId = extractApprovalId(terminalApproval.result.error?.details);
    const pendingToolCalls = toolResults
      .filter(({ result }) => result.error?.code === "APPROVAL_REQUIRED")
      .map(({ call, result }) => ({
        id: call.id,
        name: call.name,
        input: call.input,
        approvalId: extractApprovalId(result.error?.details),
        reason: result.error?.message
      }));
    input.state.phase = "waiting_approval";
    await input.trace.write({
      type: "run.checkpoint",
      data: {
        reason: "waiting_approval",
        phase: "waiting_approval",
        state: serializeRunState(input.state),
        pendingToolCall: terminalApproval.call,
        pendingToolCalls,
        completedToolCallIds: answeredToolCallIds(input.state),
        approvalId
      }
    });
    await input.trace.write({
      type: "run.waiting_approval",
      data: {
        steps: input.state.steps,
        toolCallId: terminalApproval.call.id,
        toolName: terminalApproval.call.name,
        approvalId,
        reason: terminalApproval.result.error?.message,
        pendingToolCalls
      }
    });
    return { runId: input.runId, status: "waiting_approval", steps: input.state.steps, approvalId };
  }

  input.state.phase = "tools_completed";
  await writeRunCheckpoint(input.trace, "tools_completed", input.state, { completedToolCallIds: answeredToolCallIds(input.state) });
  return undefined;
}

async function recordToolResult(
  input: {
    runId: string;
    state: RunState;
    trace: TraceWriter;
    artifacts?: RuntimeConfig["artifacts"];
  },
  call: ToolCall,
  result: ToolResult
): Promise<void> {
  if (result.artifacts) {
    input.state.artifacts.push(...result.artifacts);
  }

  if (!result.ok) {
    input.state.toolErrors += 1;
  }

  const envelope = createToolResultEnvelope(input.runId, call, result);
  await input.artifacts?.put({
    ref: envelope.ref,
    kind: "tool_result",
    runId: input.runId,
    toolCallId: call.id,
    toolName: call.name,
    content: result.ok ? result.output : result.error,
    summary: envelope.summary,
    preview: envelope.preview,
    metadata: envelope.metadata
  });
  await input.trace.write({
    type: "artifact.created",
    data: {
      id: envelope.ref,
      kind: "tool_result",
      toolCallId: call.id,
      toolName: call.name,
      ok: envelope.ok,
      summary: envelope.summary,
      preview: envelope.preview,
      metadata: envelope.metadata,
      artifacts: envelope.artifacts,
      error: envelope.error
    }
  });

  input.state.messages.push({
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    content: stringifyToolResultEnvelope(envelope)
  });
}

function findPendingToolCalls(state: RunState): ToolCall[] {
  const lastAssistant = [...state.messages].reverse().find((message): message is Extract<Message, { role: "assistant" }> => message.role === "assistant");
  const calls = lastAssistant?.toolCalls ?? [];
  if (calls.length === 0) {
    return [];
  }
  const answered = new Set(state.messages.filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool").map((message) => message.toolCallId));
  return calls.filter((call) => !answered.has(call.id));
}

function answeredToolCallIds(state: RunState): string[] {
  return state.messages.filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool").map((message) => message.toolCallId);
}

async function writeRunCheckpoint(trace: TraceWriter, phase: NonNullable<RunState["phase"]>, state: RunState, extra: Record<string, unknown> = {}): Promise<void> {
  await trace.write({
    type: "run.checkpoint",
    data: {
      reason: phase,
      phase,
      state: serializeRunState(state),
      ...extra
    }
  });
}

function checkpointedFinalMessage(state: RunState): string | undefined {
  if (state.phase !== "model_completed") {
    return undefined;
  }
  const last = state.messages.at(-1);
  if (last?.role !== "assistant") {
    return undefined;
  }
  if ((last.toolCalls ?? []).length > 0) {
    return undefined;
  }
  return last.content ?? "";
}

function serializeRunState(state: RunState): RunState {
  return {
    ...state,
    messages: [...state.messages],
    artifacts: [...state.artifacts],
    metadata: { ...state.metadata }
  };
}

function extractApprovalId(details: unknown): string | undefined {
  if (details && typeof details === "object" && "approvalId" in details) {
    const approvalId = (details as { approvalId?: unknown }).approvalId;
    return typeof approvalId === "string" ? approvalId : undefined;
  }
  return undefined;
}

function createToolResultEnvelope(runId: string, call: ToolCall, result: ToolResult): ToolResultEnvelope {
  const previewText = result.ok ? previewValue(result.output, 4_000) : result.error?.message ?? "";
  return {
    ok: result.ok,
    ref: `tool-result://${runId}/${call.id}`,
    toolCallId: call.id,
    toolName: call.name,
    summary: summarizeToolResult(call.name, result),
    preview: previewText,
    artifacts: result.artifacts ?? [],
    metadata: result.metadata ?? {},
    error: result.error
  };
}

function summarizeToolResult(toolName: string, result: ToolResult): string {
  if (!result.ok) {
    return `${toolName} failed: ${result.error?.message ?? "unknown error"}`;
  }

  const output = result.output;
  if (isRecord(output)) {
    if (typeof output.path === "string") {
      const bits = [`path=${output.path}`];
      if (typeof output.bytes === "number") {
        bits.push(`bytes=${output.bytes}`);
      }
      if (typeof output.truncated === "boolean") {
        bits.push(`truncated=${output.truncated}`);
      }
      return `${toolName} completed (${bits.join(", ")})`;
    }

    if (Array.isArray(output.files)) {
      return `${toolName} completed (${output.files.length} file(s), truncated=${Boolean(output.truncated)})`;
    }

    if (Array.isArray(output.results)) {
      return `${toolName} completed (${output.results.length} result(s), truncated=${Boolean(output.truncated)})`;
    }

    if (typeof output.exitCode === "number") {
      return `${toolName} completed (exitCode=${output.exitCode}, truncated=${Boolean(output.truncated)})`;
    }
  }

  return `${toolName} completed`;
}

function stringifyToolResultEnvelope(envelope: ToolResultEnvelope): string {
  const payload = {
    ok: envelope.ok,
    ref: envelope.ref,
    toolCallId: envelope.toolCallId,
    toolName: envelope.toolName,
    summary: envelope.summary,
    artifacts: envelope.artifacts,
    metadata: envelope.metadata,
    error: envelope.error
  };
  return JSON.stringify(payload, null, 2);
}

function preview(value: string, maxLength = 1000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}... [truncated]` : value;
}

function previewValue(value: unknown, maxLength: number): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw ? preview(raw, maxLength) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!a) {
    return b ?? new AbortController().signal;
  }
  if (!b) {
    return a;
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => controller.abort(signal.reason);
  if (a.aborted) {
    abort(a);
  } else if (b.aborted) {
    abort(b);
  } else {
    a.addEventListener("abort", () => abort(a), { once: true });
    b.addEventListener("abort", () => abort(b), { once: true });
  }

  return controller.signal;
}
