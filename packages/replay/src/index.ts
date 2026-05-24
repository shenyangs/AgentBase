import { readFile } from "node:fs/promises";
import { createId, type ReplayRunResult, type RuntimeEvent } from "@agentbase/core";

export type ReplaySummary = {
  runId: string;
  status?: string;
  events: number;
  steps?: number;
  latencyMs?: number;
  costUsd?: number;
  toolCallCount: number;
  modelCallCount: number;
  toolResults: Array<{ toolCallId?: string; toolName?: string; ok?: boolean; summary?: string }>;
  finalAnswer?: string;
  deterministic: boolean;
};

export type ReplayDiff = {
  leftRunId: string;
  rightRunId: string;
  sameFinalAnswer: boolean;
  eventDelta: number;
  stepDelta?: number;
  toolCallDelta: number;
  toolResultDelta: number;
  changedModelCalls: Array<{ index: number; left?: unknown; right?: unknown }>;
  changedToolResults: Array<{
    index: number;
    left?: ReplaySummary["toolResults"][number];
    right?: ReplaySummary["toolResults"][number];
  }>;
  notes: string[];
};

export async function loadReplayTrace(file: string): Promise<RuntimeEvent[]> {
  const raw = await readFile(file, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuntimeEvent);
}

export function replayRun(events: RuntimeEvent[], options: { runId?: string; sourceRunId?: string } = {}): ReplayRunResult {
  const summary = summarizeReplay(events);
  return {
    runId: options.runId ?? createId("replay_run"),
    sourceRunId: options.sourceRunId ?? summary.runId,
    status: summary.status === "completed" ? "completed" : "failed",
    events: normalizeReplayEvents(events),
    metadata: {
      deterministic: summary.deterministic,
      finalAnswer: summary.finalAnswer,
      steps: summary.steps,
      latencyMs: summary.latencyMs,
      toolCallCount: summary.toolCallCount,
      modelCallCount: summary.modelCallCount,
      costUsd: summary.costUsd
    }
  };
}

export function summarizeReplay(events: RuntimeEvent[]): ReplaySummary {
  const runId = events[0]?.runId ?? "unknown";
  const toolResults = events
    .filter((event) => event.type === "artifact.created" && event.data.kind === "tool_result")
    .map((event) => ({
      toolCallId: typeof event.data.toolCallId === "string" ? event.data.toolCallId : undefined,
      toolName: typeof event.data.toolName === "string" ? event.data.toolName : undefined,
      ok: typeof event.data.ok === "boolean" ? event.data.ok : undefined,
      summary: typeof event.data.summary === "string" ? event.data.summary : undefined
    }));
  const final = [...events].reverse().find((event) => event.type === "model.completed" && typeof event.data.outputPreview === "string");
  const terminal = [...events].reverse().find((event) => event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled" || event.type === "run.waiting_approval");
  const started = events.find((event) => event.type === "run.started");
  const usageEvents = events.filter((event) => event.type === "model.completed");
  const costUsd = usageEvents.reduce((sum, event) => sum + (numberField(recordField(event.data, "usage"), "costUsd") ?? 0), 0);
  return {
    runId,
    status: terminalStatus(terminal?.type),
    events: events.length,
    steps: numberField(terminal?.data, "steps") ?? maxStep(events),
    latencyMs: started && terminal ? Math.max(0, Date.parse(terminal.ts) - Date.parse(started.ts)) : undefined,
    costUsd: costUsd || undefined,
    toolCallCount: events.filter((event) => event.type === "tool.started").length,
    modelCallCount: usageEvents.length,
    toolResults,
    finalAnswer: typeof final?.data.outputPreview === "string" ? final.data.outputPreview : undefined,
    deterministic: events.every((event) => event.runId === runId)
  };
}

export function extractReplayOutput(events: RuntimeEvent[]): { output: string; metadata: { runId: string; status?: string; steps?: number; toolCalls?: number; latencyMs?: number; costUsd?: number } } {
  const summary = summarizeReplay(events);
  return {
    output: summary.finalAnswer ?? "",
    metadata: {
      runId: summary.runId,
      status: summary.status,
      steps: summary.steps,
      toolCalls: summary.toolCallCount,
      latencyMs: summary.latencyMs,
      costUsd: summary.costUsd
    }
  };
}

export function diffReplay(leftEvents: RuntimeEvent[], rightEvents: RuntimeEvent[]): ReplayDiff {
  const left = summarizeReplay(leftEvents);
  const right = summarizeReplay(rightEvents);
  const maxToolResults = Math.max(left.toolResults.length, right.toolResults.length);
  const changedToolResults: ReplayDiff["changedToolResults"] = [];

  for (let index = 0; index < maxToolResults; index += 1) {
    const leftResult = left.toolResults[index];
    const rightResult = right.toolResults[index];
    if (JSON.stringify(leftResult ?? null) !== JSON.stringify(rightResult ?? null)) {
      changedToolResults.push({ index, left: leftResult, right: rightResult });
    }
  }

  const leftModels = modelFingerprints(leftEvents);
  const rightModels = modelFingerprints(rightEvents);
  const changedModelCalls: ReplayDiff["changedModelCalls"] = [];
  for (let index = 0; index < Math.max(leftModels.length, rightModels.length); index += 1) {
    if (JSON.stringify(leftModels[index] ?? null) !== JSON.stringify(rightModels[index] ?? null)) {
      changedModelCalls.push({ index, left: leftModels[index], right: rightModels[index] });
    }
  }

  const notes: string[] = [];
  if (!left.deterministic) notes.push("left trace contains multiple run ids");
  if (!right.deterministic) notes.push("right trace contains multiple run ids");
  if (left.finalAnswer !== right.finalAnswer) notes.push("final answer changed");
  if (left.status !== right.status) notes.push(`status changed: ${left.status ?? "unknown"} -> ${right.status ?? "unknown"}`);
  if (changedModelCalls.length > 0) notes.push(`${changedModelCalls.length} model call(s) changed`);
  if (changedToolResults.length > 0) notes.push(`${changedToolResults.length} tool result(s) changed`);

  return {
    leftRunId: left.runId,
    rightRunId: right.runId,
    sameFinalAnswer: left.finalAnswer === right.finalAnswer,
    eventDelta: right.events - left.events,
    stepDelta: typeof left.steps === "number" && typeof right.steps === "number" ? right.steps - left.steps : undefined,
    toolCallDelta: right.toolCallCount - left.toolCallCount,
    toolResultDelta: right.toolResults.length - left.toolResults.length,
    changedModelCalls,
    changedToolResults,
    notes
  };
}

function normalizeReplayEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.map((event) => ({ ...event, data: normalizeValue(event.data) as Record<string, unknown> }));
}

function modelFingerprints(events: RuntimeEvent[]): unknown[] {
  return events
    .filter((event) => event.type === "model.completed")
    .map((event) => ({
      finishReason: event.data.finishReason,
      toolCallCount: event.data.toolCallCount,
      toolCalls: event.data.toolCalls,
      outputPreview: event.data.outputPreview
    }));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, normalizeValue(child)]));
  }
  return value;
}

function terminalStatus(type?: string): string | undefined {
  if (type === "run.completed") return "completed";
  if (type === "run.failed") return "failed";
  if (type === "run.cancelled") return "cancelled";
  if (type === "run.waiting_approval") return "waiting_approval";
  return undefined;
}

function maxStep(events: RuntimeEvent[]): number | undefined {
  const steps = events.map((event) => numberField(event.data, "steps")).filter((value): value is number => typeof value === "number");
  return steps.length > 0 ? Math.max(...steps) : undefined;
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && key in value) {
    const child = (value as Record<string, unknown>)[key];
    return child && typeof child === "object" && !Array.isArray(child) ? (child as Record<string, unknown>) : undefined;
  }
  return undefined;
}

function numberField(value: unknown, key: string, fallback?: number): number | undefined {
  if (value && typeof value === "object" && key in value) {
    const child = (value as Record<string, unknown>)[key];
    return typeof child === "number" ? child : fallback;
  }
  return fallback;
}
