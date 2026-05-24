import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserToolConfig, DatabaseConnectionConfig, EvalCase, HttpToolConfig, McpServerConfig, PolicyName, RuntimeLimits } from "@agentbase/core";

export type ExportDestinationConfig = {
  name: string;
  type: "langfuse" | "phoenix" | "generic-http";
  url: string;
  format?: "otel" | "openinference" | "langfuse" | "phoenix";
  apiKeyEnv?: string;
  headers?: Record<string, string>;
};

export type ProviderSettings = {
  type: "mock" | "openai-compatible" | "litellm" | "ollama";
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  teamId?: string;
};

export type SearchResultConfig = {
  title: string;
  url: string;
  snippet?: string;
};

export type ToolsetSettings = {
  enabled: string[];
  http?: HttpToolConfig;
  browser?: BrowserToolConfig;
  database?: { connections: DatabaseConnectionConfig[] };
  mcp?: { servers: McpServerConfig[] };
  codeIndex?: { enabled: boolean; maxFiles?: number };
};

export type PolicySettings = {
  name: PolicyName;
};

export type AgentBaseConfig = {
  name: string;
  workspaceRoot: string;
  provider: ProviderSettings;
  search?: {
    type: "none" | "static" | "http";
    endpoint?: string;
    apiKeyEnv?: string;
    results?: SearchResultConfig[];
  };
  policy: PolicyName;
  tools: string[];
  toolsets?: string[];
  http?: HttpToolConfig;
  browser?: BrowserToolConfig;
  database?: {
    connections: DatabaseConnectionConfig[];
  };
  mcp?: {
    servers: McpServerConfig[];
  };
  codeIndex?: {
    enabled: boolean;
    maxFiles?: number;
  };
  trace: {
    type: "sqlite" | "jsonl";
    dir: string;
  };
  stores?: {
    sqliteFile?: string;
    artifactsDir?: string;
    memoryFile?: string;
    wikiDir?: string;
    evolutionFile?: string;
    retention?: {
      days?: number;
      keepLastRuns?: number;
    };
  };
  server?: {
    port?: number;
  };
  auth?: {
    tokenEnv?: string;
  };
  registries?: Record<string, unknown>;
  memory?: {
    enabled: boolean;
  };
  wiki?: {
    enabled: boolean;
  };
  orchestration?: {
    defaultMode: "crew" | "flow";
    maxParallelTasks?: number;
  };
  evals?: {
    cases?: EvalCase[];
  };
  evolution?: {
    requireEvalGate: boolean;
  };
  exports?: {
    destinations?: ExportDestinationConfig[];
  } & Record<string, unknown>;
  limits: RuntimeLimits;
};

export type ConfigIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type ConfigPatch = Partial<AgentBaseConfig> & Record<string, unknown>;

export type ConfigSnapshot = {
  config: AgentBaseConfig;
  redacted: AgentBaseConfig;
  issues: ConfigIssue[];
  summary: Record<string, unknown>;
};

export type ProviderTestResult = {
  ok: boolean;
  provider: ProviderSettings["type"];
  model?: string;
  checks: Array<{ name: string; ok: boolean; message: string }>;
};

export async function loadConfig(cwd: string): Promise<AgentBaseConfig> {
  return loadConfigFile(configFileForCwd(cwd));
}

export async function loadConfigFile(file: string): Promise<AgentBaseConfig> {
  const raw = await readFile(file, "utf8");
  const config = JSON.parse(raw) as AgentBaseConfig;
  assertValidConfig(config);
  return config;
}

export async function writeConfig(cwd: string, config: AgentBaseConfig): Promise<void> {
  await writeConfigFile(configFileForCwd(cwd), config);
}

export async function writeConfigFile(file: string, config: AgentBaseConfig): Promise<void> {
  assertValidConfig(config);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function configFileForCwd(cwd: string): string {
  return path.join(cwd, ".agentbase", "config.json");
}

export function validateConfig(config: AgentBaseConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (pathName: string, message: string) => issues.push({ path: pathName, message, severity: "error" });
  if (!config || typeof config !== "object") {
    return [{ path: "$", message: "config must be a JSON object", severity: "error" }];
  }
  if (!config.name || typeof config.name !== "string") error("name", "name must be a non-empty string");
  if (!config.workspaceRoot || typeof config.workspaceRoot !== "string") error("workspaceRoot", "workspaceRoot must be a string");
  if (!config.provider || !["mock", "openai-compatible", "litellm", "ollama"].includes(config.provider.type)) {
    error("provider.type", "provider.type must be one of mock, openai-compatible, litellm, ollama");
  }
  if (config.provider?.type !== "mock" && !config.provider?.model) {
    error("provider.model", "provider.model is required for non-mock providers");
  }
  if (!["read-only", "workspace-write", "developer", "trusted"].includes(config.policy)) {
    error("policy", "policy must be read-only, workspace-write, developer, or trusted");
  }
  if (!Array.isArray(config.tools)) error("tools", "tools must be an array");
  if (config.toolsets && !Array.isArray(config.toolsets)) error("toolsets", "toolsets must be an array when present");
  if (!config.trace || !["sqlite", "jsonl"].includes(config.trace.type)) error("trace.type", "trace.type must be sqlite or jsonl");
  if (!config.trace?.dir || typeof config.trace.dir !== "string") error("trace.dir", "trace.dir must be a string");
  if (config.stores?.retention?.days !== undefined && (typeof config.stores.retention.days !== "number" || config.stores.retention.days < 0)) {
    error("stores.retention.days", "stores.retention.days must be a non-negative number when present");
  }
  if (config.stores?.retention?.keepLastRuns !== undefined && (!Number.isInteger(config.stores.retention.keepLastRuns) || config.stores.retention.keepLastRuns < 0)) {
    error("stores.retention.keepLastRuns", "stores.retention.keepLastRuns must be a non-negative integer when present");
  }
  if (!config.limits || typeof config.limits.maxSteps !== "number" || config.limits.maxSteps < 1) error("limits.maxSteps", "limits.maxSteps must be a positive number");
  if (!config.limits || typeof config.limits.maxToolErrors !== "number" || config.limits.maxToolErrors < 1) error("limits.maxToolErrors", "limits.maxToolErrors must be a positive number");
  if (!config.limits || typeof config.limits.maxRunMs !== "number" || config.limits.maxRunMs < 1) error("limits.maxRunMs", "limits.maxRunMs must be a positive number");
  for (const [index, connection] of (config.database?.connections ?? []).entries()) {
    const prefix = `database.connections[${index}]`;
    if (!connection.name) error(`${prefix}.name`, "database.connections[].name is required");
    if (!["sqlite", "postgres", "mysql"].includes(connection.driver)) error(`${prefix}.driver`, `database connection ${connection.name ?? "<unnamed>"} has invalid driver`);
    if (connection.driver === "sqlite" && !connection.file) error(`${prefix}.file`, `sqlite connection ${connection.name} requires file`);
    if ((connection.driver === "postgres" || connection.driver === "mysql") && !connection.connectionStringEnv) {
      error(`${prefix}.connectionStringEnv`, `${connection.driver} connection ${connection.name} requires connectionStringEnv`);
    }
  }
  for (const [index, server] of (config.mcp?.servers ?? []).entries()) {
    const prefix = `mcp.servers[${index}]`;
    if (!server.name) error(`${prefix}.name`, "mcp.servers[].name is required");
    if (server.transport === "stdio" && !server.command) error(`${prefix}.command`, `mcp server ${server.name} uses stdio and requires command`);
    if (server.transport === "http" && !server.url) error(`${prefix}.url`, `mcp server ${server.name} uses http and requires url`);
  }
  if (config.browser && config.browser.mode === "cdp" && !config.browser.cdpUrl) {
    error("browser.cdpUrl", "browser.cdpUrl is required when browser.mode is cdp");
  }
  if (config.orchestration?.maxParallelTasks !== undefined && (!Number.isInteger(config.orchestration.maxParallelTasks) || config.orchestration.maxParallelTasks < 1)) {
    error("orchestration.maxParallelTasks", "orchestration.maxParallelTasks must be a positive integer when present");
  }
  for (const [index, destination] of (config.exports?.destinations ?? []).entries()) {
    const prefix = `exports.destinations[${index}]`;
    if (!destination.name) error(`${prefix}.name`, "exports.destinations[].name is required");
    if (!["langfuse", "phoenix", "generic-http"].includes(destination.type)) error(`${prefix}.type`, "export destination type must be langfuse, phoenix, or generic-http");
    if (!destination.url || !/^https?:\/\//.test(destination.url)) error(`${prefix}.url`, "export destination url must be http(s)");
    if (destination.format && !["otel", "openinference", "langfuse", "phoenix"].includes(destination.format)) error(`${prefix}.format`, "export destination format is invalid");
  }
  for (const secret of findRawSecretFields(config)) {
    error(secret, "raw secrets are not allowed in config; store an environment variable name such as apiKeyEnv or connectionStringEnv");
  }
  return issues;
}

export function assertValidConfig(config: AgentBaseConfig): void {
  const issues = validateConfig(config).filter((issue) => issue.severity === "error");
  if (issues.length > 0) {
    throw new Error(`Invalid .agentbase/config.json:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`);
  }
}

export function patchConfig(config: AgentBaseConfig, patch: ConfigPatch): AgentBaseConfig {
  const next = deepMerge(config, patch) as AgentBaseConfig;
  assertValidConfig(next);
  return next;
}

export function redactConfig(config: AgentBaseConfig): AgentBaseConfig {
  return redactValue(config) as AgentBaseConfig;
}

export function summarizeConfig(config: AgentBaseConfig): Record<string, unknown> {
  return {
    name: config.name,
    provider: config.provider.type,
    providerModel: config.provider.model,
    policy: config.policy,
    trace: config.trace.type,
    toolsets: enabledToolsets(config),
    sqliteFile: config.stores?.sqliteFile,
    retention: config.stores?.retention,
    memoryEnabled: Boolean(config.memory?.enabled),
    wikiEnabled: Boolean(config.wiki?.enabled)
  };
}

export function snapshotConfig(config: AgentBaseConfig): ConfigSnapshot {
  return {
    config,
    redacted: redactConfig(config),
    issues: validateConfig(config),
    summary: summarizeConfig(config)
  };
}

export function enabledToolsets(config: AgentBaseConfig): string[] {
  return config.toolsets ?? config.tools;
}

export function enableToolset(config: AgentBaseConfig, name: string): AgentBaseConfig {
  const toolsets = [...new Set([...enabledToolsets(config), name])];
  return { ...config, toolsets, tools: toolsets };
}

export function disableToolset(config: AgentBaseConfig, name: string): AgentBaseConfig {
  const toolsets = enabledToolsets(config).filter((toolset) => toolset !== name);
  return { ...config, toolsets, tools: toolsets };
}

export function setConfigPath(config: AgentBaseConfig, dottedPath: string, value: unknown): AgentBaseConfig {
  if (!dottedPath || dottedPath.includes("__proto__") || dottedPath.includes("constructor")) {
    throw new Error("Invalid config path.");
  }
  const patch: Record<string, unknown> = {};
  let cursor = patch;
  const parts = dottedPath.split(".");
  for (const part of parts.slice(0, -1)) {
    cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
  return patchConfig(config, patch);
}

export function parseConfigValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    return JSON.parse(value);
  }
  return value;
}

export function testProviderSettings(config: AgentBaseConfig, env: Record<string, string | undefined> = process.env): ProviderTestResult {
  const checks: ProviderTestResult["checks"] = [];
  checks.push({ name: "provider.type", ok: true, message: config.provider.type });
  if (config.provider.type === "mock") {
    checks.push({ name: "mock.available", ok: true, message: "mock provider runs without external credentials" });
  } else {
    checks.push({ name: "provider.model", ok: Boolean(config.provider.model), message: config.provider.model ? "model configured" : "model is required" });
    if (config.provider.apiKeyEnv) {
      checks.push({ name: "provider.apiKeyEnv", ok: Boolean(env[config.provider.apiKeyEnv]), message: env[config.provider.apiKeyEnv] ? `${config.provider.apiKeyEnv} is set` : `${config.provider.apiKeyEnv} is not set` });
    } else {
      checks.push({ name: "provider.apiKeyEnv", ok: config.provider.type === "ollama", message: config.provider.type === "ollama" ? "local provider does not require an API key by default" : "apiKeyEnv is not configured" });
    }
    if (config.provider.baseUrl) {
      checks.push({ name: "provider.baseUrl", ok: /^https?:\/\//.test(config.provider.baseUrl), message: config.provider.baseUrl });
    }
  }
  return {
    ok: checks.every((check) => check.ok),
    provider: config.provider.type,
    model: config.provider.model,
    checks
  };
}

export function defaultConfig(name: string): AgentBaseConfig {
  return {
    name,
    workspaceRoot: ".",
    provider: {
      type: "mock",
      model: "mock/repo-analyst"
    },
    policy: "workspace-write",
    tools: ["@agentbase/tools-fs", "@agentbase/tools-shell", "@agentbase/tools-git", "@agentbase/code-index"],
    toolsets: ["@agentbase/tools-fs", "@agentbase/tools-shell", "@agentbase/tools-git", "@agentbase/code-index"],
    search: {
      type: "none"
    },
    http: {},
    browser: {
      mode: "managed",
      headless: true
    },
    database: {
      connections: []
    },
    mcp: {
      servers: []
    },
    codeIndex: {
      enabled: true,
      maxFiles: 1000
    },
    stores: {
      sqliteFile: ".agentbase/agentbase.sqlite",
      artifactsDir: ".agentbase/artifacts",
      memoryFile: ".agentbase/memory/memory.json",
      wikiDir: ".agentbase/wiki",
      evolutionFile: ".agentbase/evolution/proposals.json",
      retention: {
        days: 90,
        keepLastRuns: 500
      }
    },
    server: {},
    auth: {},
    registries: {},
    memory: {
      enabled: true
    },
    wiki: {
      enabled: true
    },
    orchestration: {
      defaultMode: "crew",
      maxParallelTasks: 2
    },
    evals: {
      cases: []
    },
    evolution: {
      requireEvalGate: true
    },
    exports: {
      destinations: []
    },
    trace: {
      type: "sqlite",
      dir: ".agentbase/runs"
    },
    limits: {
      maxSteps: 30,
      maxToolErrors: 5,
      maxRunMs: 600000
    }
  };
}

function deepMerge(left: unknown, right: unknown): unknown {
  if (!isRecord(left) || !isRecord(right)) return right;
  const output: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    output[key] = isRecord(value) && isRecord(output[key]) ? deepMerge(output[key], value) : value;
  }
  return output;
}

function redactValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, shouldRedact(childKey) ? "[REDACTED]" : redactValue(child, childKey)]));
  }
  if (typeof value === "string" && shouldRedact(key)) return "[REDACTED]";
  return value;
}

function shouldRedact(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return normalized === "apikey" || normalized === "token" || normalized === "authorization" || normalized.includes("secret") || normalized.includes("password") || normalized === "cookie";
}

function findRawSecretFields(value: unknown, prefix = ""): string[] {
  if (!isRecord(value)) return [];
  const fields: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key;
    const normalized = key.toLowerCase().replace(/[_-]/g, "");
    const allowedEnvName = normalized.endsWith("env") || normalized === "tokenenv";
    if (!allowedEnvName && (normalized === "apikey" || normalized === "connectionstring" || normalized === "token" || normalized === "authorization" || normalized.includes("password") || normalized.includes("secret"))) {
      fields.push(current);
    }
    fields.push(...findRawSecretFields(child, current));
  }
  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
