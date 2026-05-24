import type { Policy } from "@agentbase/core";

export type ShellRisk = "low" | "medium" | "high";

export type ShellPolicyDecision = {
  allowed: boolean;
  risk: ShellRisk;
  reason: string;
};

export function assessShellPolicy(command: string, policy: Policy): ShellPolicyDecision {
  const risk = classifyShellCommand(command);

  if (policy.name === "trusted") {
    return { allowed: true, risk, reason: "trusted policy allows shell command" };
  }

  if (policy.name === "read-only") {
    return { allowed: false, risk, reason: "read-only policy blocks shell execution" };
  }

  if (risk === "high") {
    return { allowed: false, risk, reason: "high-risk shell command requires approval, which is not available in non-interactive v0.1" };
  }

  if (policy.name === "workspace-write") {
    const allowedByList = (policy.shellAllowlist ?? []).some((prefix) => command.trim().startsWith(prefix));
    if (risk === "low" || allowedByList) {
      return { allowed: true, risk, reason: "workspace-write policy allows low-risk or allowlisted shell command" };
    }

    return { allowed: false, risk, reason: "workspace-write policy blocks non-allowlisted shell command" };
  }

  return { allowed: true, risk, reason: "developer policy allows low and medium risk shell command" };
}

export function classifyShellCommand(command: string): ShellRisk {
  const normalized = command.trim();

  if (
    /\brm\s+-[^\n;|&]*r/.test(normalized) ||
    /\bsudo\b/.test(normalized) ||
    /\b(chmod|chown)\b/.test(normalized) ||
    /\bgit\s+(push|reset|checkout|rebase)\b/.test(normalized) ||
    /\bcurl\b[^\n]*\|\s*(sh|bash|zsh)\b/.test(normalized) ||
    /\b(wget)\b[^\n]*\|\s*(sh|bash|zsh)\b/.test(normalized) ||
    /\bmkfs\b|\bdiskutil\s+erase/i.test(normalized)
  ) {
    return "high";
  }

  if (
    /^(pwd|ls|cat|rg|grep|find)\b/.test(normalized) ||
    /^git\s+(status|diff|show|log)\b/.test(normalized) ||
    /^(npm|pnpm|yarn)\s+(test|run\s+test)\b/.test(normalized) ||
    /^node\s+--version\b/.test(normalized)
  ) {
    return "low";
  }

  return "medium";
}
