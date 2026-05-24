import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { EvalCase, EvalReport, EvalResult, EvalSuite, RuntimeEvent } from "@agentbase/core";
import { hasGuardrailCategory, scanRuntimeEvents, scanTextForGuardrails } from "@agentbase/guardrails";

export type EvalMetadata = {
  runId?: string;
  status?: string;
  steps?: number;
  toolCalls?: number;
  latencyMs?: number;
  costUsd?: number;
  events?: RuntimeEvent[];
};

export async function loadEvalSuite(file: string): Promise<EvalSuite> {
  const raw = await readFile(file, "utf8");
  const parsed = file.endsWith(".yaml") || file.endsWith(".yml") ? parseYaml(raw) : JSON.parse(raw);
  return normalizeEvalSuite(parsed);
}

export function normalizeEvalSuite(value: unknown): EvalSuite {
  if (!isRecord(value)) {
    throw new Error("Eval suite must be an object");
  }
  const rawCases = Array.isArray(value.cases) ? value.cases : undefined;
  if (!rawCases || rawCases.length === 0) {
    throw new Error("Eval suite requires at least one case");
  }
  const suite: EvalSuite = {
    id: typeof value.id === "string" ? value.id : "suite",
    name: typeof value.name === "string" ? value.name : undefined,
    cases: rawCases.map(normalizeEvalCase),
    metadata: isRecord(value.metadata) ? value.metadata : undefined
  };
  return suite;
}

export function evaluateText(testCase: EvalCase, output: string, metadata: EvalMetadata = {}): EvalResult {
  const details: string[] = [];
  let passed = true;

  for (const assertion of testCase.assertions ?? []) {
    let ok = true;
    if (assertion.type === "contains") {
      ok = output.includes(String(assertion.value));
    } else if (assertion.type === "not_contains") {
      ok = !output.includes(String(assertion.value));
    } else if (assertion.type === "equals") {
      ok = output.trim() === String(assertion.value).trim();
    } else if (assertion.type === "regex") {
      ok = new RegExp(String(assertion.value)).test(output);
    } else if (assertion.type === "max_steps") {
      ok = typeof metadata.steps === "number" && metadata.steps <= Number(assertion.value);
    } else if (assertion.type === "max_tool_calls") {
      ok = typeof metadata.toolCalls === "number" && metadata.toolCalls <= Number(assertion.value);
    } else if (assertion.type === "max_latency_ms") {
      ok = typeof metadata.latencyMs === "number" && metadata.latencyMs <= Number(assertion.value);
    } else if (assertion.type === "max_cost_usd") {
      ok = typeof metadata.costUsd === "number" && metadata.costUsd <= Number(assertion.value);
    } else if (assertion.type === "status_is") {
      ok = metadata.status === String(assertion.value);
    } else if (assertion.type === "event_exists") {
      ok = (metadata.events ?? []).some((event) => event.type === String(assertion.value));
    } else if (assertion.type === "event_absent") {
      ok = !(metadata.events ?? []).some((event) => event.type === String(assertion.value));
    } else if (assertion.type === "tool_sequence") {
      ok = hasToolSequence(metadata.events ?? [], sequenceValue(assertion.value));
    } else if (assertion.type === "guardrail_absent") {
      ok = !hasGuardrailCategory(scanEvalGuardrails(output, metadata), String(assertion.value));
    } else if (assertion.type === "guardrail_present") {
      ok = hasGuardrailCategory(scanEvalGuardrails(output, metadata), String(assertion.value));
    }
    passed &&= ok;
    details.push(`${ok ? "pass" : "fail"} ${assertion.type} ${String(assertion.value)}`);
  }

  if ((testCase.assertions ?? []).length === 0 && testCase.expected) {
    const ok = output.includes(testCase.expected);
    passed &&= ok;
    details.push(`${ok ? "pass" : "fail"} expected substring`);
  }

  return {
    id: testCase.id,
    passed,
    score: passed ? 1 : 0,
    details,
    runId: metadata.runId
  };
}

function scanEvalGuardrails(output: string, metadata: EvalMetadata): ReturnType<typeof scanTextForGuardrails> {
  return [...scanTextForGuardrails(output, { source: "eval.output" }), ...scanRuntimeEvents(metadata.events ?? [], { source: "eval.event" })];
}

export function runEvalSuite(suite: EvalSuite, output: string, metadata: EvalMetadata = {}): EvalReport {
  const results = suite.cases.map((testCase) => evaluateText(testCase, output, metadata));
  const summary = summarizeEvalResults(results);
  const { events, ...reportMetadata } = metadata;
  return {
    suite: suite.id,
    passed: summary.passed,
    failed: summary.failed,
    score: summary.score,
    results,
    createdAt: new Date().toISOString(),
    metadata: {
      suiteName: suite.name,
      ...reportMetadata,
      eventCount: events?.length
    }
  };
}

export function summarizeEvalResults(results: EvalResult[]): { passed: number; failed: number; score: number } {
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const score = results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.score, 0) / results.length;
  return { passed, failed, score };
}

function normalizeEvalCase(value: unknown, index: number): EvalCase {
  if (!isRecord(value)) {
    throw new Error(`Eval case at index ${index} must be an object`);
  }
  if (typeof value.input !== "string") {
    throw new Error(`Eval case ${String(value.id ?? index)} requires input`);
  }
  const assertions = Array.isArray(value.assertions)
    ? value.assertions.map((assertion, assertionIndex) => {
        if (!isRecord(assertion) || typeof assertion.type !== "string" || !("value" in assertion)) {
          throw new Error(`Eval case ${String(value.id ?? index)} assertion ${assertionIndex} must include type and value`);
        }
        return { type: assertion.type as never, value: assertion.value as string | number | boolean | string[] };
      })
    : undefined;
  return {
    id: typeof value.id === "string" ? value.id : `case_${index + 1}`,
    input: value.input,
    expected: typeof value.expected === "string" ? value.expected : undefined,
    assertions,
    metadata: isRecord(value.metadata) ? value.metadata : undefined
  };
}

function sequenceValue(value: string | number | boolean | string[]): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasToolSequence(events: RuntimeEvent[], expected: string[]): boolean {
  if (expected.length === 0) {
    return true;
  }
  const actual = events
    .filter((event) => event.type === "tool.started")
    .map((event) => (typeof event.data.name === "string" ? event.data.name : typeof event.data.toolName === "string" ? event.data.toolName : undefined))
    .filter((name): name is string => Boolean(name));
  let index = 0;
  for (const name of actual) {
    if (name === expected[index]) {
      index += 1;
      if (index === expected.length) {
        return true;
      }
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
