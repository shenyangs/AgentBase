import { RUNTIME_EVENT_TYPES } from "@agentbase/core";
import type {
  ContextSnapshot,
  LifecycleHookManifest,
  ModelProvider,
  ProviderRouteDecision,
  RelayMailbox,
  RelayMessage,
  RuntimeEvent,
  SpecialistManifest,
  Tool,
  ToolResultEnvelope,
  WorkspaceManifest,
  WorkflowExecutionResult
} from "@agentbase/core";

const KNOWN_RUNTIME_EVENT_TYPES = new Set<string>(RUNTIME_EVENT_TYPES);

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
    if (!nonEmptyString(event.type)) {
      error(`events[${index}].type`, "event.type must be a non-empty string");
    } else if (!KNOWN_RUNTIME_EVENT_TYPES.has(event.type)) {
      error(`events[${index}].type`, `event.type is not part of the runtime event contract: ${event.type}`);
    }
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

export function validateSpecialistManifestContract(manifest: SpecialistManifest, name = `specialist:${manifest?.name ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(manifest)) {
    return report(name, [{ path: "$", message: "specialist manifest must be an object", severity: "error" }]);
  }
  if (!nonEmptyString(manifest.name)) error("name", "manifest.name must be a non-empty string");
  if (!nonEmptyString(manifest.role)) error("role", "manifest.role must be a non-empty string");
  if (!isRecord(manifest.trigger)) {
    error("trigger", "manifest.trigger must be an object");
  } else {
    const hasKeywords = Array.isArray(manifest.trigger.keywords) && manifest.trigger.keywords.length > 0;
    const hasTaskTypes = Array.isArray(manifest.trigger.taskTypes) && manifest.trigger.taskTypes.length > 0;
    const hasDescription = nonEmptyString(manifest.trigger.description);
    if (!hasKeywords && !hasTaskTypes && !hasDescription) error("trigger", "trigger must include keywords, taskTypes, or description");
    if (manifest.trigger.keywords !== undefined && (!Array.isArray(manifest.trigger.keywords) || !manifest.trigger.keywords.every(nonEmptyString))) {
      error("trigger.keywords", "trigger.keywords must be an array of non-empty strings");
    }
    if (manifest.trigger.taskTypes !== undefined && (!Array.isArray(manifest.trigger.taskTypes) || !manifest.trigger.taskTypes.every(nonEmptyString))) {
      error("trigger.taskTypes", "trigger.taskTypes must be an array of non-empty strings");
    }
  }
  if (manifest.handoffTo !== undefined && (!Array.isArray(manifest.handoffTo) || !manifest.handoffTo.every(nonEmptyString))) {
    error("handoffTo", "handoffTo must be an array of non-empty strings");
  }
  if (manifest.confidence !== undefined && (typeof manifest.confidence !== "number" || manifest.confidence < 0 || manifest.confidence > 1)) {
    error("confidence", "confidence must be a number between 0 and 1");
  }
  if (manifest.needsFreshInfo !== undefined && typeof manifest.needsFreshInfo !== "boolean") {
    error("needsFreshInfo", "needsFreshInfo must be boolean when present");
  }
  if (manifest.riskFlags !== undefined && (!Array.isArray(manifest.riskFlags) || !manifest.riskFlags.every(nonEmptyString))) {
    error("riskFlags", "riskFlags must be an array of non-empty strings");
  }
  if (manifest.result !== undefined) {
    if (!isRecord(manifest.result)) {
      error("result", "result must be an object when present");
    } else {
      if (manifest.result.format !== undefined && !nonEmptyString(manifest.result.format)) error("result.format", "result.format must be a non-empty string when present");
      if (manifest.result.schema !== undefined && !isRecord(manifest.result.schema)) error("result.schema", "result.schema must be a JSON schema object when present");
      if (manifest.result.examples !== undefined && (!Array.isArray(manifest.result.examples) || !manifest.result.examples.every(nonEmptyString))) {
        error("result.examples", "result.examples must be an array of non-empty strings when present");
      }
    }
  }

  return report(name, issues);
}

export function validateContextSnapshotContract(snapshot: ContextSnapshot, name = "context-snapshot"): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(snapshot)) {
    return report(name, [{ path: "$", message: "context snapshot must be an object", severity: "error" }]);
  }
  if (!nonNegativeNumber(snapshot.messageCount)) error("messageCount", "messageCount must be a non-negative number");
  if (!nonNegativeNumber(snapshot.tokenEstimate)) error("tokenEstimate", "tokenEstimate must be a non-negative number");
  if (!Array.isArray(snapshot.items)) {
    error("items", "items must be an array");
  } else {
    for (const [index, item] of snapshot.items.entries()) {
      if (!nonEmptyString(item.id)) error(`items[${index}].id`, "item.id must be a non-empty string");
      if (!nonEmptyString(item.type)) error(`items[${index}].type`, "item.type must be a non-empty string");
      if (typeof item.included !== "boolean") error(`items[${index}].included`, "item.included must be boolean");
      if (!nonEmptyString(item.reason)) error(`items[${index}].reason`, "item.reason must be a non-empty string");
    }
  }
  if (!Array.isArray(snapshot.layers)) {
    error("layers", "layers must be an array for budget-planned context");
  } else {
    const layerIds = new Set(snapshot.layers.map((layer) => layer.id));
    if (!layerIds.has("stable-prefix")) error("layers", "layers must include stable-prefix");
    if (!layerIds.has("dynamic-suffix")) error("layers", "layers must include dynamic-suffix");
    for (const [index, layer] of snapshot.layers.entries()) {
      if (!nonEmptyString(layer.id)) error(`layers[${index}].id`, "layer.id must be a non-empty string");
      if (!nonEmptyString(layer.label)) error(`layers[${index}].label`, "layer.label must be a non-empty string");
      if (!nonEmptyString(layer.purpose)) error(`layers[${index}].purpose`, "layer.purpose must be a non-empty string");
      if (!Array.isArray(layer.itemTypes) || !layer.itemTypes.every(nonEmptyString)) error(`layers[${index}].itemTypes`, "layer.itemTypes must be an array of non-empty strings");
      if (!nonNegativeNumber(layer.includedItems)) error(`layers[${index}].includedItems`, "includedItems must be a non-negative number");
      if (!nonNegativeNumber(layer.skippedItems)) error(`layers[${index}].skippedItems`, "skippedItems must be a non-negative number");
      if (layer.tokenEstimate !== undefined && !nonNegativeNumber(layer.tokenEstimate)) error(`layers[${index}].tokenEstimate`, "tokenEstimate must be a non-negative number when present");
    }
  }

  return report(name, issues);
}

export function validateRelayMessageContract(message: RelayMessage, name = `relay:${message?.id ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(message)) {
    return report(name, [{ path: "$", message: "relay message must be an object", severity: "error" }]);
  }
  if (!nonEmptyString(message.id)) error("id", "message.id must be a non-empty string");
  if (!nonEmptyString(message.channel)) error("channel", "message.channel must be a non-empty string");
  if (!nonEmptyString(message.type)) error("type", "message.type must be a non-empty string");
  if (!isRecord(message.payload)) error("payload", "message.payload must be an object");
  if (!["queued", "running", "waiting_approval", "delivered", "acknowledged", "failed", "cancelled"].includes(String(message.status))) error("status", "message.status is invalid");
  if (!nonNegativeNumber(message.attempts)) error("attempts", "attempts must be a non-negative number");
  if (!isIsoDate(message.createdAt)) error("createdAt", "createdAt must be an ISO timestamp string");
  if (!isIsoDate(message.updatedAt)) error("updatedAt", "updatedAt must be an ISO timestamp string");
  if (message.status === "delivered" && !isIsoDate(message.deliveredAt)) error("deliveredAt", "delivered messages must include deliveredAt");
  if (message.status === "running" && !isIsoDate(message.runningAt)) error("runningAt", "running messages must include runningAt");
  if (message.status === "waiting_approval" && !isIsoDate(message.waitingApprovalAt)) error("waitingApprovalAt", "waiting approval messages must include waitingApprovalAt");
  if (message.status === "acknowledged" && !isIsoDate(message.acknowledgedAt)) error("acknowledgedAt", "acknowledged messages must include acknowledgedAt");
  if (message.status === "failed") {
    if (!isIsoDate(message.failedAt)) error("failedAt", "failed messages must include failedAt");
    if (!nonEmptyString(message.error)) error("error", "failed messages must include error");
  }
  if (message.status === "cancelled" && !isIsoDate(message.cancelledAt)) error("cancelledAt", "cancelled messages must include cancelledAt");

  return report(name, issues);
}

export async function validateRelayMailboxContract(mailbox: RelayMailbox, name = "relay-mailbox"): Promise<ContractReport> {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(mailbox)) {
    return report(name, [{ path: "$", message: "relay mailbox must be an object", severity: "error" }]);
  }
  for (const method of ["send", "list", "get", "markDelivered", "acknowledge", "fail", "cancel"]) {
    if (typeof mailbox[method as keyof RelayMailbox] !== "function") error(method, `${method} must be a function`);
  }
  if (issues.length > 0) return report(name, issues);

  try {
    const queued = await mailbox.send({ channel: "contract", type: "external", payload: { ok: true }, to: "contract-target" });
    appendNestedIssues(issues, validateRelayMessageContract(queued, `${name}.queued`));
    if (queued.status !== "queued") error("send.status", "send must create queued messages");
    const listed = await mailbox.list({ channel: "contract", status: "queued" });
    if (!listed.some((message) => message.id === queued.id)) error("list", "list must return queued messages by channel/status");
    if (mailbox.markRunning) {
      const running = await mailbox.markRunning(queued.id);
      appendNestedIssues(issues, validateRelayMessageContract(running, `${name}.running`));
    }
    if (mailbox.markWaitingApproval) {
      const waiting = await mailbox.markWaitingApproval(queued.id, "approval_contract");
      appendNestedIssues(issues, validateRelayMessageContract(waiting, `${name}.waiting_approval`));
    }
    const delivered = await mailbox.markDelivered(queued.id);
    appendNestedIssues(issues, validateRelayMessageContract(delivered, `${name}.delivered`));
    if (delivered.attempts < queued.attempts + 1) error("markDelivered.attempts", "markDelivered must increment attempts");
    const acknowledged = await mailbox.acknowledge(queued.id);
    appendNestedIssues(issues, validateRelayMessageContract(acknowledged, `${name}.acknowledged`));
    const failed = await mailbox.fail((await mailbox.send({ channel: "contract", type: "external", payload: { fail: true } })).id, "contract failure");
    appendNestedIssues(issues, validateRelayMessageContract(failed, `${name}.failed`));
    const cancelled = await mailbox.cancel((await mailbox.send({ channel: "contract", type: "external", payload: { cancel: true } })).id, "contract cancellation");
    appendNestedIssues(issues, validateRelayMessageContract(cancelled, `${name}.cancelled`));
  } catch (cause) {
    error("$", cause instanceof Error ? cause.message : String(cause));
  }

  return report(name, issues);
}

export function validateWorkspaceManifestContract(manifest: WorkspaceManifest, name = `workspace:${manifest?.name ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);
  if (!isRecord(manifest)) return report(name, [{ path: "$", message: "workspace manifest must be an object", severity: "error" }]);
  if (!nonEmptyString(manifest.name)) error("name", "workspace name must be non-empty");
  if (!nonEmptyString(manifest.root)) error("root", "workspace root must be non-empty");
  if (!nonEmptyString(manifest.configFile)) error("configFile", "configFile must be non-empty");
  if (!Array.isArray(manifest.toolsets) || !manifest.toolsets.every(nonEmptyString)) error("toolsets", "toolsets must be non-empty strings");
  if (!isRecord(manifest.provider) || !nonEmptyString(manifest.provider.type)) error("provider", "provider must include type");
  if (!["read-only", "workspace-write", "developer", "trusted"].includes(String(manifest.policy))) error("policy", "policy is invalid");
  if (!Array.isArray(manifest.memoryScopes) || !manifest.memoryScopes.every(nonEmptyString)) error("memoryScopes", "memoryScopes must be strings");
  if (!isRecord(manifest.assets)) error("assets", "assets summary is required");
  if (!Array.isArray(manifest.recentRuns)) error("recentRuns", "recentRuns must be an array");
  return report(name, issues);
}

export function validateProviderRouteDecisionContract(decision: ProviderRouteDecision, name = `provider-route:${decision?.provider ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);
  if (!isRecord(decision)) return report(name, [{ path: "$", message: "provider route decision must be an object", severity: "error" }]);
  if (!nonEmptyString(decision.provider)) error("provider", "provider must be non-empty");
  if (!nonEmptyString(decision.reason)) error("reason", "reason must be non-empty");
  if (typeof decision.matched !== "boolean") error("matched", "matched must be boolean");
  if (!Array.isArray(decision.fallbackProviders) || !decision.fallbackProviders.every(nonEmptyString)) error("fallbackProviders", "fallbackProviders must be strings");
  if (!["low", "medium", "high"].includes(String(decision.estimatedRisk))) error("estimatedRisk", "estimatedRisk must be low, medium, or high");
  return report(name, issues);
}

export function validateLifecycleHookManifestContract(manifest: LifecycleHookManifest, name = `hook:${manifest?.name ?? "<missing>"}`): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);
  if (!isRecord(manifest)) return report(name, [{ path: "$", message: "hook manifest must be an object", severity: "error" }]);
  if (!nonEmptyString(manifest.name)) error("name", "hook name must be non-empty");
  if (!nonEmptyString(manifest.version)) error("version", "hook version must be non-empty");
  if (!["BeforeRun", "BeforeContext", "BeforeModel", "BeforeTool", "AfterTool", "AfterRun", "OnApprovalRequired"].includes(String(manifest.hook))) error("hook", "hook point is invalid");
  if (manifest.risk !== undefined && !["low", "medium", "high"].includes(manifest.risk)) error("risk", "risk must be low, medium, or high");
  if (manifest.permissions !== undefined && (!Array.isArray(manifest.permissions) || !manifest.permissions.every(nonEmptyString))) error("permissions", "permissions must be strings");
  if (manifest.timeoutMs !== undefined && (!Number.isInteger(manifest.timeoutMs) || manifest.timeoutMs < 1)) error("timeoutMs", "timeoutMs must be positive");
  if (manifest.inputSchema !== undefined && !isRecord(manifest.inputSchema)) error("inputSchema", "inputSchema must be a JSON schema object");
  return report(name, issues);
}

export function validateLocalRuntimeSecurityContract(value: unknown, name = "local-runtime-security"): ContractReport {
  const issues: ContractIssue[] = [];
  const error = issueCollector(issues);

  if (!isRecord(value)) {
    return report(name, [{ path: "$", message: "local runtime security must be an object", severity: "error" }]);
  }
  const token = value.token;
  const headerName = value.headerName;
  if (!["127.0.0.1", "localhost", "::1"].includes(String(value.bindHost)) && !nonEmptyString(value.udsPath)) {
    error("bindHost", "bindHost must be loopback unless udsPath is provided");
  }
  if (!Number.isInteger(value.port) || Number(value.port) < 0 || Number(value.port) > 65535) error("port", "port must be an integer between 0 and 65535");
  if (!nonEmptyString(token) || String(token).length < 16) error("token", "token must be a generated per-launch secret");
  if (!/^[a-f0-9]{64}$/i.test(String(value.tokenHash))) error("tokenHash", "tokenHash must be a SHA-256 hex digest");
  if (value.tokenHash === token) error("tokenHash", "tokenHash must not equal token");
  if (!nonEmptyString(headerName) || /\s/.test(headerName)) error("headerName", "headerName must be a non-empty HTTP header name");
  if (!isRecord(value.authHeaders)) {
    error("authHeaders", "authHeaders must be an object");
  } else {
    if (value.authHeaders.authorization !== `Bearer ${token}`) error("authHeaders.authorization", "authorization header must contain the per-launch bearer token");
    if (value.authHeaders[String(headerName)] !== token) error("authHeaders[headerName]", "custom auth header must contain the per-launch token");
  }
  if (!Array.isArray(value.corsAllowlist) || !value.corsAllowlist.every(nonEmptyString)) {
    error("corsAllowlist", "corsAllowlist must be an array of origins");
  }
  if (value.tokenKind !== "per-launch") error("tokenKind", "tokenKind must be per-launch");

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

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function appendNestedIssues(issues: ContractIssue[], nested: ContractReport): void {
  for (const issue of nested.issues) {
    issues.push({ ...issue, path: `${nested.name}.${issue.path}` });
  }
}
