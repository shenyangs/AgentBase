import type { ModelProvider, RuntimeEvent, Tool, ToolResultEnvelope, WorkflowExecutionResult } from "@agentbase/core";

export type ContractSeverity = "error" | "warning";

export type ContractIssue = {
  path: string;
  message: string;
  severity: ContractSeverity;
};

export type ContractReport = {
  ok: boolean;
  name: string;
  issues: ContractIssue[];
};

export type ContractSuiteReport = {
  ok: boolean;
  reports: ContractReport[];
};

export function validateToolContract(tool: Tool, name = `tool:${tool?.name ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(tool)) {
    return report(name, [{ path: "$", message: "tool must be an object", severity: "error" }]);
  }
  if (!nonEmptyString(tool.name)) error("name", "tool.name must be a non-empty string");
  if (!nonEmptyString(tool.description)) error("description", "tool.description must be a non-empty string");
  if (!isRecord(tool.inputSchema)) error("inputSchema", "tool.inputSchema must be a JSON schema object");
  if (tool.inputSchema && isRecord(tool.inputSchema) && tool.inputSchema.type !== "object") {
    error("inputSchema.type", "tool.inputSchema.type should be object for runtime-callable tools");
  }
  if (typeof tool.execute !== "function") error("execute", "tool.execute must be a function");
  if (tool.risk && !["low", "medium", "high"].includes(tool.risk)) error("risk", "tool.risk must be low, medium, or high");
  if (tool.requiredPermissions && (!Array.isArray(tool.requiredPermissions) || !tool.requiredPermissions.every((permission) => typeof permission === "string"))) {
    error("requiredPermissions", "tool.requiredPermissions must be an array of strings");
  }

  return report(name, issues);
}

export function validateProviderContract(provider: ModelProvider, name = `provider:${provider?.name ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(provider)) {
    return report(name, [{ path: "$", message: "provider must be an object", severity: "error" }]);
  }
  if (!nonEmptyString(provider.name)) error("name", "provider.name must be a non-empty string");
  if (typeof provider.complete !== "function") error("complete", "provider.complete must be a function");

  return report(name, issues);
}

export function validateToolResultEnvelope(value: unknown, name = "tool-result-envelope"): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(value)) {
    return report(name, [{ path: "$", message: "tool result envelope must be an object", severity: "error" }]);
  }
  if (typeof value.ok !== "boolean") error("ok", "ok must be boolean");
  if (!nonEmptyString(value.ref)) error("ref", "ref must be a non-empty artifact/materialized ref");
  if (!nonEmptyString(value.toolCallId)) error("toolCallId", "toolCallId must be a non-empty string");
  if (!nonEmptyString(value.toolName)) error("toolName", "toolName must be a non-empty string");
  if (typeof value.summary !== "string") error("summary", "summary must be a string");
  if (typeof value.preview !== "string") error("preview", "preview must be a string");
  if (!Array.isArray(value.artifacts)) error("artifacts", "artifacts must be an array");
  if (!isRecord(value.metadata)) error("metadata", "metadata must be an object");
  if (value.error !== undefined) {
    if (!isRecord(value.error)) {
      error("error", "error must be an object when present");
    } else {
      if (!nonEmptyString(value.error.code)) error("error.code", "error.code must be a non-empty string");
      if (!nonEmptyString(value.error.message)) error("error.message", "error.message must be a non-empty string");
    }
  }

  return report(name, issues);
}

export function validateTraceContract(events: RuntimeEvent[], name = "trace"): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!Array.isArray(events)) {
    return report(name, [{ path: "$", message: "events must be an array", severity: "error" }]);
  }
  const hasStart = events.some((event) => event.type === "run.started" || event.type === "run.resumed");
  const hasTerminal = events.some((event) => ["run.completed", "run.failed", "run.cancelled", "run.waiting_approval"].includes(event.type));
  if (!hasStart) error("events", "trace must include run.started or run.resumed");
  if (!hasTerminal) error("events", "trace must include a terminal or waiting event");

  for (const [index, event] of events.entries()) {
    if (!nonEmptyString(event.id)) error(`events[${index}].id`, "event.id must be a non-empty string");
    if (!nonEmptyString(event.runId)) error(`events[${index}].runId`, "event.runId must be a non-empty string");
    if (!nonEmptyString(event.type)) error(`events[${index}].type`, "event.type must be a non-empty string");
    if (!nonEmptyString(event.ts)) error(`events[${index}].ts`, "event.ts must be an ISO timestamp string");
    if (!isRecord(event.data)) error(`events[${index}].data`, "event.data must be an object");
  }

  return report(name, issues);
}

export function validateWorkflowResultContract(result: WorkflowExecutionResult, name = `workflow:${result?.workflow ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(result)) {
    return report(name, [{ path: "$", message: "workflow result must be an object", severity: "error" }]);
  }
  if (!nonEmptyString(result.workflow)) error("workflow", "workflow must be a non-empty string");
  if (!["completed", "failed", "waiting_approval", "cancelled"].includes(String(result.status))) error("status", "status is invalid");
  if (!Array.isArray(result.assignments)) {
    error("assignments", "assignments must be an array");
  } else {
    for (const [index, assignment] of result.assignments.entries()) {
      if (!nonEmptyString(assignment.taskId)) error(`assignments[${index}].taskId`, "taskId must be a non-empty string");
      if (!nonEmptyString(assignment.agent)) error(`assignments[${index}].agent`, "agent must be a non-empty string");
      if (!["completed", "failed", "waiting_approval", "cancelled"].includes(String(assignment.status))) error(`assignments[${index}].status`, "status is invalid");
      if (assignment.artifactRefs !== undefined && (!Array.isArray(assignment.artifactRefs) || !assignment.artifactRefs.every((ref) => typeof ref === "string"))) {
        error(`assignments[${index}].artifactRefs`, "artifactRefs must be an array of strings when present");
      }
    }
  }

  return report(name, issues);
}

export function runContractSuite(reports: ContractReport[]): ContractSuiteReport {
  return { ok: reports.every((entry) => entry.ok), reports };
}

export function assertContractReport(report: ContractReport | ContractSuiteReport): void {
  if (report.ok) return;
  const reports = "reports" in report ? report.reports : [report];
  const lines = reports.flatMap((entry) => entry.issues.map((issue) => `- ${entry.name}.${issue.path}: ${issue.message}`));
  throw new Error(`Contract validation failed:\n${lines.join("\n")}`);
}

function report(name: string, issues: ContractIssue[]): ContractReport {
  return { name, issues, ok: issues.filter((issue) => issue.severity === "error").length === 0 };
}

function issueCollector(issues: ContractIssue[]): (path: string, message: string) => void {
  return (pathName, message) => issues.push({ path: pathName, message, severity: "error" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
