import type { Permission, Policy, PolicyName, Tool, ToolPolicyDecision } from "./types";

export type PolicyDecision = ToolPolicyDecision;

export function normalizePolicy(policy: Policy | PolicyName): Policy {
  return typeof policy === "string" ? { name: policy } : policy;
}

export function evaluateToolPolicy(tool: Tool, policy: Policy): PolicyDecision {
  if (policy.name === "trusted") {
    return { allowed: true, reason: "trusted policy allows declared tool permissions" };
  }

  const permissions = tool.requiredPermissions ?? [];

  if (policy.name === "read-only") {
    const blocked = permissions.find(isWriteOrExecutePermission);
    if (blocked) {
      return { allowed: false, reason: `read-only policy blocks ${blocked}`, requiredApproval: true, blockedPermission: blocked };
    }
  }

  if (policy.name === "workspace-write") {
    const blocked = permissions.find(
      (permission) =>
        permission !== "fs:read" &&
        permission !== "fs:write" &&
        permission !== "git:read" &&
        permission !== "shell:run" &&
        permission !== "browser:read" &&
        permission !== "database:read" &&
        permission !== "code:index"
    );
    if (blocked) {
      return { allowed: false, reason: `workspace-write policy blocks ${blocked}`, requiredApproval: true, blockedPermission: blocked };
    }
  }

  if (policy.name === "developer") {
    const blocked = permissions.find((permission) => permission === "mcp:tool" && !policy.shellAllowlist?.includes("mcp:*"));
    if (blocked) {
      return { allowed: false, reason: `developer policy blocks ${blocked} unless policy.shellAllowlist includes mcp:*`, requiredApproval: true, blockedPermission: blocked };
    }
  }

  return { allowed: true, reason: `${policy.name} policy allows declared tool permissions` };
}

function isWriteOrExecutePermission(permission: Permission): boolean {
  return (
    permission === "fs:write" ||
    permission === "shell:run" ||
    permission.startsWith("network:") ||
    permission === "browser:interact" ||
    permission === "database:write" ||
    permission === "mcp:tool"
  );
}
