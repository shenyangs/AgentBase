import { AgentBaseError, errorToObject } from "./errors";
import { createId } from "./id";
import { validateJsonSchema } from "./json-schema";
import { evaluateToolPolicy } from "./policy";
import type { ApprovalStore, Policy, RuntimeLimits, ToolCall, ToolExecutionContext, ToolResult, TraceWriter } from "./types";
import { ToolRegistry } from "./tool-registry";

export type ToolExecutorConfig = {
  registry: ToolRegistry;
  workspaceRoot: string;
  policy: Policy;
  trace: TraceWriter;
  approvals?: ApprovalStore;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  sessionId?: string;
  limits?: Pick<RuntimeLimits, "maxToolMs" | "maxToolRetries">;
};

export class ToolExecutor {
  private readonly registry: ToolRegistry;
  private readonly workspaceRoot: string;
  private readonly policy: Policy;
  private readonly trace: TraceWriter;
  private readonly approvals?: ApprovalStore;
  private readonly env: Record<string, string | undefined>;
  private readonly signal: AbortSignal;
  private readonly sessionId?: string;
  private readonly limits: Pick<RuntimeLimits, "maxToolMs" | "maxToolRetries">;

  constructor(config: ToolExecutorConfig) {
    this.registry = config.registry;
    this.workspaceRoot = config.workspaceRoot;
    this.policy = config.policy;
    this.trace = config.trace;
    this.approvals = config.approvals;
    this.env = config.env;
    this.signal = config.signal;
    this.sessionId = config.sessionId;
    this.limits = config.limits ?? {};
  }

  async execute(call: ToolCall, runId: string): Promise<ToolResult> {
    if (this.signal.aborted) {
      const error = abortError(this.signal);
      await this.trace.write({ type: "tool.failed", data: { id: call.id, name: call.name, error: errorToObject(error) } });
      return { ok: false, error: errorToObject(error) };
    }

    const tool = this.registry.get(call.name);
    if (!tool) {
      const result: ToolResult = {
        ok: false,
        error: { code: "TOOL_NOT_FOUND", message: `Tool not found: ${call.name}` }
      };
      await this.trace.write({ type: "tool.failed", data: { id: call.id, name: call.name, error: result.error } });
      return result;
    }

    try {
      validateJsonSchema(call.input, tool.inputSchema);
    } catch (error) {
      const normalized = errorToObject(error);
      await this.trace.write({ type: "tool.failed", data: { id: call.id, name: call.name, error: normalized } });
      return { ok: false, error: normalized };
    }

    const decision = evaluateToolPolicy(tool, this.policy);
    await this.trace.write({
      type: "policy.checked",
      data: {
        id: call.id,
        name: call.name,
        policy: this.policy.name,
        permissions: tool.requiredPermissions ?? [],
        allowed: decision.allowed,
        reason: decision.reason,
        blockedPermission: decision.blockedPermission,
        requiredApproval: decision.requiredApproval
      }
    });
    if (!decision.allowed) {
      let approvalId: string | undefined;
      if (decision.requiredApproval) {
        if (!this.approvals) {
          const error = {
            code: "APPROVAL_UNAVAILABLE",
            message: `Approval is required for ${call.name}, but no approval store is configured.`,
            details: { blockedPermission: decision.blockedPermission }
          };
          await this.trace.write({ type: "tool.rejected", data: { id: call.id, name: call.name, reason: error.message } });
          return { ok: false, error };
        }

        const existingApproval = await this.findExistingApproval(runId, call.name, call.input);
        if (existingApproval?.status === "approved") {
          await this.trace.write({
            type: "approval.used",
            data: {
              id: call.id,
              approvalId: existingApproval.id,
              name: call.name,
              decidedBy: existingApproval.decidedBy,
              decidedAt: existingApproval.decidedAt
            }
          });
        } else if (existingApproval?.status === "denied") {
          const error = {
            code: "APPROVAL_DENIED",
            message: existingApproval.decisionReason ?? `Approval denied for ${call.name}`,
            details: { approvalId: existingApproval.id }
          };
          await this.trace.write({ type: "tool.rejected", data: { id: call.id, name: call.name, reason: error.message, approvalId: existingApproval.id } });
          return { ok: false, error };
        } else {
          const approval =
            existingApproval ??
            (await this.approvals?.createApproval({
              id: createId("appr"),
              runId,
              sessionId: this.sessionId,
              toolCallId: call.id,
              toolName: call.name,
              input: redactSecrets(call.input),
              permissions: tool.requiredPermissions ?? [],
              reason: decision.reason,
              metadata: {
                policy: this.policy.name,
                blockedPermission: decision.blockedPermission
              }
            }));
          approvalId = approval?.id ?? createId("appr");
          await this.trace.write({
            type: "approval.required",
            data: {
              id: call.id,
              approvalId,
              name: call.name,
              reason: decision.reason,
              blockedPermission: decision.blockedPermission,
              permissions: tool.requiredPermissions ?? []
            }
          });
        }
      }
      if (decision.requiredApproval && !approvalId) {
        await this.trace.write({ type: "policy.override", data: { id: call.id, name: call.name, reason: "approved", policy: this.policy.name } });
      } else {
        const error = {
          code: decision.requiredApproval ? "APPROVAL_REQUIRED" : "POLICY_REJECTED",
          message: decision.reason,
          details: approvalId ? { approvalId } : undefined
        };
        await this.trace.write({ type: "tool.rejected", data: { id: call.id, name: call.name, reason: decision.reason, approvalId } });
        return { ok: false, error };
      }
    }

    await this.trace.write({ type: "tool.started", data: { id: call.id, name: call.name, input: redactSecrets(call.input) } });

    const maxRetries = this.limits.maxToolRetries ?? 0;
    const maxAttempts = maxRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const signal = this.limits.maxToolMs ? withTimeout(this.signal, this.limits.maxToolMs) : this.signal;
        const ctx: ToolExecutionContext = {
          runId,
          workspaceRoot: this.workspaceRoot,
          signal,
          trace: this.trace,
          policy: this.policy,
          env: this.env
        };

        const result = await runWithOptionalTimeout(tool.execute(call.input, ctx), this.limits.maxToolMs, signal);
        if (result.ok) {
          await this.trace.write({
            type: "tool.completed",
            data: { id: call.id, name: call.name, attempt, outputPreview: preview(result.output), metadata: result.metadata }
          });
        } else {
          await this.trace.write({ type: "tool.failed", data: { id: call.id, name: call.name, attempt, error: result.error } });
        }

        return result;
      } catch (error) {
        const normalized = errorToObject(error);
        if (attempt < maxAttempts) {
          await this.trace.write({ type: "tool.retry", data: { id: call.id, name: call.name, attempt, error: normalized } });
          continue;
        }
        await this.trace.write({ type: "tool.failed", data: { id: call.id, name: call.name, attempt, error: normalized } });
        return { ok: false, error: normalized };
      }
    }

    const error = { code: "TOOL_FAILED", message: "Tool execution failed after retries" };
    await this.trace.write({ type: "tool.failed", data: { id: call.id, name: call.name, error } });
    return { ok: false, error };
  }

  private async findExistingApproval(runId: string, toolName: string, input: unknown) {
    if (!this.approvals) {
      return undefined;
    }
    const approvals = await this.approvals.listApprovals({ runId, limit: 100 });
    const redacted = stableStringify(redactSecrets(input));
    return approvals.find((approval) => approval.toolName === toolName && stableStringify(approval.input) === redacted);
  }
}

function preview(value: unknown, maxLength = 1000): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (!raw) {
    return "";
  }

  return raw.length > maxLength ? `${raw.slice(0, maxLength)}... [truncated]` : raw;
}

async function runWithOptionalTimeout<T>(operation: Promise<T>, timeoutMs: number | undefined, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw abortError(signal);
  }

  let timeout: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const guards: Array<Promise<T>> = [operation];
    if (timeoutMs && timeoutMs > 0) {
      guards.push(
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new AgentBaseError("TOOL_TIMEOUT", `Tool timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      );
    }
    guards.push(
      new Promise<T>((_, reject) => {
        onAbort = () => reject(abortError(signal));
        signal.addEventListener("abort", onAbort, { once: true });
      })
    );
    return await Promise.race(guards);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function abortError(signal: AbortSignal): AgentBaseError {
  const reason = signal.reason instanceof Error ? signal.reason.message : signal.reason ? String(signal.reason) : "Tool execution cancelled";
  return new AgentBaseError("TOOL_CANCELLED", reason);
}

function withTimeout(parent: AbortSignal, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Tool timed out after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(parent.reason);
  if (parent.aborted) {
    onAbort();
  } else {
    parent.addEventListener("abort", onAbort, { once: true });
  }
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timeout);
      parent.removeEventListener("abort", onAbort);
    },
    { once: true }
  );
  return controller.signal;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (isSecretKey(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, redactSecrets(child)];
      })
    );
  }
  if (typeof value === "string") {
    return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]").replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]");
  }
  return value;
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return normalized === "authorization" || normalized === "apikey" || normalized === "token" || normalized.includes("secret") || normalized.includes("password") || normalized === "cookie";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
