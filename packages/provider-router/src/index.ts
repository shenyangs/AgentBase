import type { Permission, ProviderRouteDecision, ProviderRouteInput, ProviderRouteRule, ProviderRouter, ToolRisk } from "@agentbase/core";

export class DeterministicProviderRouter implements ProviderRouter {
  route(input: ProviderRouteInput): ProviderRouteDecision {
    const estimatedRisk = estimateRisk(input);
    const route = (input.routes ?? []).find((candidate) => matchesRoute(candidate, { ...input, risk: input.risk ?? estimatedRisk }));
    const provider = route?.provider ?? input.defaultProvider ?? "mock";
    return {
      provider,
      model: route?.model ?? input.defaultModel,
      routeId: route?.id,
      reason: route?.reason ?? (route ? `Matched route ${route.id}.` : "No route matched; using default provider."),
      matched: Boolean(route),
      fallbackProviders: input.fallbacks ?? [],
      estimatedRisk,
      budgetUsd: input.budgetUsd,
      metadata: {
        contextTokens: input.contextTokens ?? 0,
        taskType: input.taskType,
        evalImportance: input.evalImportance,
        toolPermissions: input.toolPermissions ?? []
      }
    };
  }
}

export function createDeterministicProviderRouter(): ProviderRouter {
  return new DeterministicProviderRouter();
}

export function routeProvider(input: ProviderRouteInput): ProviderRouteDecision {
  return new DeterministicProviderRouter().route(input);
}

function matchesRoute(route: ProviderRouteRule, input: ProviderRouteInput & { risk: ToolRisk }): boolean {
  const match = route.match;
  if (!match) return true;
  if (match.risk && match.risk !== "any" && match.risk !== input.risk) return false;
  if (match.evalImportance && match.evalImportance !== input.evalImportance) return false;
  if (match.minContextTokens !== undefined && (input.contextTokens ?? 0) < match.minContextTokens) return false;
  if (match.maxContextTokens !== undefined && (input.contextTokens ?? 0) > match.maxContextTokens) return false;
  if (match.taskTypes?.length && (!input.taskType || !match.taskTypes.includes(input.taskType))) return false;
  if (match.keywords?.length) {
    const task = input.task.toLowerCase();
    if (!match.keywords.some((keyword) => task.includes(keyword.toLowerCase()))) return false;
  }
  if (match.toolPermissions?.length && !hasAnyPermission(input.toolPermissions ?? [], match.toolPermissions)) return false;
  return true;
}

function hasAnyPermission(actual: Permission[], expected: Permission[]): boolean {
  const set = new Set(actual);
  return expected.some((permission) => set.has(permission));
}

function estimateRisk(input: ProviderRouteInput): ToolRisk {
  if (input.risk) return input.risk;
  if (input.evalImportance === "high") return "high";
  const permissions = new Set(input.toolPermissions ?? []);
  if (permissions.has("shell:run") || permissions.has("database:write") || permissions.has("browser:interact")) return "high";
  if (permissions.has("network:http") || permissions.has("mcp:tool") || permissions.has("fs:write")) return "medium";
  if ((input.contextTokens ?? 0) > 64_000) return "medium";
  return "low";
}
