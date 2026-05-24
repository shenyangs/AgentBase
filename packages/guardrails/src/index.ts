import type { GuardrailResult, RuntimeEvent } from "@agentbase/core";

export type GuardrailCategory =
  | "prompt_injection"
  | "secret_exfiltration"
  | "workspace_escape"
  | "dangerous_action"
  | "memory_poisoning";

export type GuardrailSeverity = NonNullable<GuardrailResult["severity"]>;

export type GuardrailScanOptions = {
  source?: string;
  maxFindingsPerRule?: number;
};

export type GuardrailSummary = {
  allowed: boolean;
  count: number;
  highestSeverity?: GuardrailSeverity;
  categories: Record<string, number>;
};

type GuardrailRule = {
  id: string;
  category: GuardrailCategory;
  severity: GuardrailSeverity;
  pattern: RegExp;
  reason: string;
  includeSnippet?: boolean;
};

const DEFAULT_MAX_FINDINGS_PER_RULE = 3;
const SEVERITY_RANK: Record<GuardrailSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const GUARDRAIL_RULES: GuardrailRule[] = [
  {
    id: "prompt.ignore-prior-instructions",
    category: "prompt_injection",
    severity: "high",
    pattern: /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|system|developer)\s+(instructions?|messages?|prompts?)\b/giu,
    reason: "Text appears to ask the model to ignore higher-priority instructions.",
    includeSnippet: true
  },
  {
    id: "prompt.reveal-system",
    category: "prompt_injection",
    severity: "high",
    pattern: /\b(reveal|print|show|dump|exfiltrate)\s+(the\s+)?(system|developer)\s+(prompt|message|instructions?)\b/giu,
    reason: "Text appears to request hidden system or developer instructions.",
    includeSnippet: true
  },
  {
    id: "prompt.cn-injection",
    category: "prompt_injection",
    severity: "high",
    pattern: /(忽略|无视|覆盖|绕过).{0,12}(之前|系统|开发者|安全|策略).{0,12}(指令|提示|规则|限制)/gu,
    reason: "Text appears to contain a Chinese prompt-injection instruction.",
    includeSnippet: true
  },
  {
    id: "secret.openai-key",
    category: "secret_exfiltration",
    severity: "critical",
    pattern: /\bsk-(?:proj-|admin-)?[A-Za-z0-9_-]{16,}\b/gu,
    reason: "Text appears to contain an OpenAI-style API key."
  },
  {
    id: "secret.github-token",
    category: "secret_exfiltration",
    severity: "critical",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/gu,
    reason: "Text appears to contain a GitHub token."
  },
  {
    id: "secret.aws-access-key",
    category: "secret_exfiltration",
    severity: "critical",
    pattern: /\bAKIA[0-9A-Z]{16}\b/gu,
    reason: "Text appears to contain an AWS access key."
  },
  {
    id: "secret.private-key",
    category: "secret_exfiltration",
    severity: "critical",
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/gu,
    reason: "Text appears to contain a private key block."
  },
  {
    id: "secret.assignment",
    category: "secret_exfiltration",
    severity: "high",
    pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{12,}["']?/giu,
    reason: "Text appears to contain a raw credential assignment."
  },
  {
    id: "workspace.dotdot-escape",
    category: "workspace_escape",
    severity: "high",
    pattern: /(?:^|[/"'\s])(?:\.\.\/){2,}[^"'\s]*/gu,
    reason: "Text appears to reference a path traversal outside the workspace.",
    includeSnippet: true
  },
  {
    id: "workspace.sensitive-path",
    category: "workspace_escape",
    severity: "critical",
    pattern: /(?:\/etc\/passwd|\/etc\/shadow|~\/\.ssh\/|\/\.ssh\/(?:id_rsa|id_ed25519)|\/Users\/[^/\s]+\/\.ssh\/)/gu,
    reason: "Text appears to reference sensitive host files outside the workspace.",
    includeSnippet: true
  },
  {
    id: "danger.shell-destructive",
    category: "dangerous_action",
    severity: "critical",
    pattern: /\b(?:rm\s+-rf\s+(?:\/|~|\$HOME)|dd\s+if=|mkfs(?:\.\w+)?\s|chmod\s+-R\s+777\s+(?:\/|~|\$HOME)|:\(\)\s*\{\s*:\|:&\s*\};:)/giu,
    reason: "Text appears to contain a destructive shell action.",
    includeSnippet: true
  },
  {
    id: "danger.pipe-to-shell",
    category: "dangerous_action",
    severity: "high",
    pattern: /\b(?:curl|wget)\b[^\n|;&]{0,300}(?:\|\s*(?:sh|bash|zsh)|>\s*\/tmp\/[^\s;&]+[^\n;&]{0,80}\b(?:sh|bash|zsh)\b)/giu,
    reason: "Text appears to pipe downloaded content into a shell.",
    includeSnippet: true
  },
  {
    id: "danger.privileged-command",
    category: "dangerous_action",
    severity: "medium",
    pattern: /\b(?:sudo\s+|launchctl\s+(?:load|bootstrap)|csrutil\s+disable|spctl\s+--master-disable)\b/giu,
    reason: "Text appears to request privileged host modification.",
    includeSnippet: true
  },
  {
    id: "memory.permanent-policy-poisoning",
    category: "memory_poisoning",
    severity: "high",
    pattern: /\b(?:remember|store|save)\b.{0,80}\b(?:always|permanently|forever)\b.{0,80}\b(?:ignore|bypass|disable|override)\b.{0,80}\b(?:policy|safety|system|developer|guardrail)s?\b/giu,
    reason: "Text appears to request durable memory that weakens policy or instruction hierarchy.",
    includeSnippet: true
  },
  {
    id: "memory.cn-policy-poisoning",
    category: "memory_poisoning",
    severity: "high",
    pattern: /(永久|长期|以后都|永远).{0,24}(记住|保存|写入记忆).{0,40}(忽略|绕过|关闭|覆盖).{0,20}(安全|策略|系统|开发者|规则)/gu,
    reason: "Text appears to request Chinese durable memory that weakens policy.",
    includeSnippet: true
  }
];

export function scanTextForGuardrails(text: string, options: GuardrailScanOptions = {}): GuardrailResult[] {
  const results: GuardrailResult[] = [];
  if (!text) {
    return results;
  }

  const source = options.source ?? "text";
  const maxFindingsPerRule = options.maxFindingsPerRule ?? DEFAULT_MAX_FINDINGS_PER_RULE;
  for (const rule of GUARDRAIL_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let count = 0;
    for (const match of text.matchAll(pattern)) {
      if (count >= maxFindingsPerRule) {
        break;
      }
      count += 1;
      const index = match.index ?? 0;
      results.push({
        allowed: false,
        reason: rule.reason,
        category: rule.category,
        severity: rule.severity,
        metadata: {
          ruleId: rule.id,
          source,
          location: locationFor(text, index),
          snippet: rule.includeSnippet ? safeSnippet(text, index, match[0].length) : undefined
        }
      });
    }
  }
  return results;
}

export function scanRuntimeEvents(events: RuntimeEvent[], options: GuardrailScanOptions = {}): GuardrailResult[] {
  const results: GuardrailResult[] = [];
  for (const event of events) {
    const source = `${options.source ?? "event"}:${event.type}:${event.id}`;
    const eventResults = scanTextForGuardrails(JSON.stringify(event.data ?? {}), { ...options, source });
    for (const result of eventResults) {
      results.push({
        ...result,
        metadata: {
          ...result.metadata,
          runId: event.runId,
          eventId: event.id,
          eventType: event.type
        }
      });
    }
  }
  return results;
}

export function summarizeGuardrailResults(results: GuardrailResult[]): GuardrailSummary {
  const categories: Record<string, number> = {};
  let highestSeverity: GuardrailSeverity | undefined;
  for (const result of results) {
    const category = result.category ?? "unknown";
    categories[category] = (categories[category] ?? 0) + 1;
    if (result.severity && (!highestSeverity || SEVERITY_RANK[result.severity] > SEVERITY_RANK[highestSeverity])) {
      highestSeverity = result.severity;
    }
  }
  return {
    allowed: results.every((result) => result.allowed),
    count: results.length,
    highestSeverity,
    categories
  };
}

export function hasGuardrailCategory(results: GuardrailResult[], category: string): boolean {
  if (category === "all" || category === "*") {
    return results.length > 0;
  }
  return results.some((result) => result.category === category);
}

export function redactKnownSecrets(value: string): string {
  return GUARDRAIL_RULES.filter((rule) => rule.category === "secret_exfiltration").reduce(
    (text, rule) => text.replace(new RegExp(rule.pattern.source, rule.pattern.flags), "[REDACTED]"),
    value
  );
}

function locationFor(text: string, index: number): { line: number; column: number; offset: number } {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
    offset: index
  };
}

function safeSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 32);
  const end = Math.min(text.length, index + length + 32);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${redactKnownSecrets(text.slice(start, end)).replace(/\s+/g, " ").trim()}${suffix}`;
}
