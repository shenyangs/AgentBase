import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { configFileForCwd, enabledToolsets, validateConfig, type AgentBaseConfig } from "@agentbase/config";
import type { MemoryScope, RunRecord, WorkspaceAssetSummary, WorkspaceManifest } from "@agentbase/core";

export type WorkspaceDoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  severity?: "info" | "warning" | "error";
};

export async function createWorkspaceManifest(input: {
  cwd: string;
  config: AgentBaseConfig;
  recentRuns?: RunRecord[];
  pendingApprovals?: number;
}): Promise<WorkspaceManifest> {
  const root = path.resolve(input.cwd, input.config.workspaceRoot);
  const assets = await summarizeWorkspaceAssets({ cwd: input.cwd, config: input.config, recentRuns: input.recentRuns, pendingApprovals: input.pendingApprovals });
  const issues = validateConfig(input.config);
  return {
    name: input.config.name,
    root,
    configFile: configFileForCwd(input.cwd),
    toolsets: enabledToolsets(input.config),
    provider: {
      type: input.config.provider.type,
      model: input.config.provider.model
    },
    policy: input.config.policy,
    memoryScopes: defaultMemoryScopes(),
    wiki: { enabled: Boolean(input.config.wiki?.enabled), pages: assets.wikiPages },
    codeIndex: { enabled: Boolean(input.config.codeIndex?.enabled), files: assets.codeFiles },
    capabilities: { active: assets.capabilities, drafts: assets.capabilityDrafts },
    recentRuns: input.recentRuns ?? [],
    assets,
    issues,
    updatedAt: new Date().toISOString()
  };
}

export async function summarizeWorkspaceAssets(input: {
  cwd: string;
  config: AgentBaseConfig;
  recentRuns?: RunRecord[];
  pendingApprovals?: number;
}): Promise<WorkspaceAssetSummary> {
  const cwd = path.resolve(input.cwd);
  const memoryFile = path.resolve(cwd, input.config.stores?.memoryFile ?? ".agentbase/memory/memory.json");
  const capabilityFile = path.resolve(cwd, ".agentbase/capabilities/capabilities.json");
  const experienceFile = path.resolve(cwd, ".agentbase/experience/ledger.json");
  const relayFile = path.resolve(cwd, ".agentbase/relay/mailbox.json");
  const wikiDir = path.resolve(cwd, input.config.stores?.wikiDir ?? ".agentbase/wiki");
  const codeDir = path.resolve(cwd, ".agentbase/code-index");
  const patternDir = path.resolve(cwd, ".agentbase/pattern-runs");
  const artifactDir = path.resolve(cwd, input.config.stores?.artifactsDir ?? ".agentbase/artifacts");

  const memories = await readJsonArray(memoryFile);
  const memoryProposals = await readJsonArray(path.join(path.dirname(memoryFile), "proposals.json"));
  const capabilities = await readJsonObject(capabilityFile);
  const experience = await readJsonObject(experienceFile);
  const relay = await readJsonObject(relayFile);

  return {
    workspaceRoot: path.resolve(cwd, input.config.workspaceRoot),
    runs: input.recentRuns?.length ?? 0,
    pendingApprovals: input.pendingApprovals ?? 0,
    memories: memories.length,
    memoryProposals: memoryProposals.length,
    wikiPages: await countFiles(wikiDir, [".md", ".json"]),
    codeFiles: await countFiles(codeDir, [".json"]),
    capabilities: Array.isArray(capabilities.capabilities) ? capabilities.capabilities.length : 0,
    capabilityDrafts: Array.isArray(capabilities.drafts) ? capabilities.drafts.length : 0,
    experienceEvents: Array.isArray(experience.events) ? experience.events.length : 0,
    inboxTasks: Array.isArray(relay.messages) ? relay.messages.length : 0,
    patternReports: await countFiles(patternDir, [".json"]),
    artifacts: await countFiles(artifactDir),
    updatedAt: new Date().toISOString()
  };
}

export async function doctorWorkspace(input: { cwd: string; config: AgentBaseConfig }): Promise<WorkspaceDoctorCheck[]> {
  const root = path.resolve(input.cwd, input.config.workspaceRoot);
  const checks: WorkspaceDoctorCheck[] = [];
  checks.push(await checkPath("workspace root", root));
  checks.push(await checkPath("config file", configFileForCwd(input.cwd)));
  checks.push({ name: "config validation", ok: validateConfig(input.config).every((issue) => issue.severity !== "error"), message: "config schema validation", severity: "error" });
  checks.push({ name: "toolsets", ok: enabledToolsets(input.config).length > 0, message: `${enabledToolsets(input.config).length} enabled toolset(s)`, severity: "warning" });
  checks.push({ name: "memory", ok: Boolean(input.config.memory?.enabled), message: input.config.memory?.enabled ? "memory enabled" : "memory disabled", severity: "info" });
  checks.push({ name: "wiki", ok: Boolean(input.config.wiki?.enabled), message: input.config.wiki?.enabled ? "wiki enabled" : "wiki disabled", severity: "info" });
  return checks;
}

export function defaultMemoryScopes(): MemoryScope[] {
  return ["session", "project", "user", "agent", "procedural", "episodic", "semantic", "tool", "wiki"];
}

async function checkPath(name: string, target: string): Promise<WorkspaceDoctorCheck> {
  try {
    await stat(target);
    return { name, ok: true, message: target };
  } catch {
    return { name, ok: false, message: `${target} does not exist`, severity: "error" };
  }
}

async function readJsonArray(file: string): Promise<unknown[]> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function countFiles(dir: string, extensions?: string[]): Promise<number> {
  try {
    let count = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += await countFiles(absolute, extensions);
      } else if (!extensions || extensions.some((extension) => entry.name.endsWith(extension))) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}
