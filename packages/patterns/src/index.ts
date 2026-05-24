import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export type ReferencePattern = {
  id: string;
  title: string;
  agent: string;
  eval: string;
  fixture: string;
  requiredToolsets: string[];
  description: string;
};

export type ReferencePatternCatalog = {
  version: number;
  patterns: ReferencePattern[];
};

export type ReferencePatternDescription = ReferencePattern & {
  agentConfig: Record<string, unknown>;
  evalSuite: Record<string, unknown>;
  evalFile: string;
  fixtureDir: string;
};

export type ReferencePatternRunReport = {
  ok: boolean;
  patternId: string;
  title: string;
  workspace: string;
  prompt: string;
  runId: string;
  reportFile: string;
  eval: unknown;
  kept: boolean;
};

export type ReferencePatternValidation = {
  ok: boolean;
  count: number;
  patterns: string[];
  issues: string[];
};

export function examplesRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", "examples");
}

export async function loadReferencePatternCatalog(root = examplesRoot()): Promise<ReferencePatternCatalog> {
  const file = path.join(root, "reference-patterns.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as ReferencePatternCatalog;
  if (!Number.isInteger(parsed.version)) {
    throw new Error("examples/reference-patterns.json must include an integer version.");
  }
  if (!Array.isArray(parsed.patterns)) {
    throw new Error("examples/reference-patterns.json must include patterns.");
  }
  return parsed;
}

export function getReferencePattern(catalog: ReferencePatternCatalog, id: string | undefined): ReferencePattern {
  const pattern = catalog.patterns.find((candidate) => candidate.id === id);
  if (!pattern) {
    throw new Error(`Unknown pattern: ${id ?? "<missing>"}`);
  }
  return pattern;
}

export async function describeReferencePattern(pattern: ReferencePattern, root = examplesRoot()): Promise<ReferencePatternDescription> {
  return {
    ...pattern,
    agentConfig: JSON.parse(await readFile(patternAgentFile(pattern, root), "utf8")) as Record<string, unknown>,
    evalSuite: parseYaml(await readFile(patternEvalFile(pattern, root), "utf8")) as Record<string, unknown>,
    evalFile: patternEvalFile(pattern, root),
    fixtureDir: patternFixtureDir(pattern, root)
  };
}

export function patternAgentFile(pattern: ReferencePattern, root = examplesRoot()): string {
  return path.join(root, pattern.agent);
}

export function patternEvalFile(pattern: ReferencePattern, root = examplesRoot()): string {
  return path.join(root, pattern.eval);
}

export function patternFixtureDir(pattern: ReferencePattern, root = examplesRoot()): string {
  return path.resolve(root, pattern.fixture);
}

export function defaultPatternPrompt(id: string): string {
  const prompts: Record<string, string> = {
    "repo-analyst": "summarize this repo",
    "test-runner": "run tests",
    "research-agent": "research the local corpus",
    "tool-designer": "design this tool",
    "memory-curator": "curate project memory"
  };
  return prompts[id] ?? "run this reference pattern";
}

export async function validateReferencePatternCatalog(root = examplesRoot()): Promise<ReferencePatternValidation> {
  const catalog = await loadReferencePatternCatalog(root);
  const issues: string[] = [];
  const ids = new Set<string>();

  for (const candidate of catalog.patterns as unknown[]) {
    const patternId = isRecord(candidate) && typeof candidate.id === "string" ? candidate.id : "<missing>";
    if (!isReferencePattern(candidate)) {
      issues.push(`${patternId}: invalid pattern shape`);
      continue;
    }
    const pattern = candidate;
    if (!pattern.id || !pattern.title || !pattern.description) {
      issues.push(`${pattern.id || "<missing>"}: id, title, and description are required`);
    }
    if (ids.has(pattern.id)) {
      issues.push(`${pattern.id}: duplicate pattern id`);
    }
    ids.add(pattern.id);
    if (!Array.isArray(pattern.requiredToolsets) || pattern.requiredToolsets.length === 0) {
      issues.push(`${pattern.id}: requiredToolsets must be a non-empty array`);
    }
    if (!(await isFile(patternAgentFile(pattern, root)))) {
      issues.push(`${pattern.id}: missing agent file`);
    }
    if (!(await isFile(patternEvalFile(pattern, root)))) {
      issues.push(`${pattern.id}: missing eval file`);
    }
    if (!(await isFile(path.join(root, pattern.id, "README.md")))) {
      issues.push(`${pattern.id}: missing pattern README`);
    }
    if (!(await isDirectory(patternFixtureDir(pattern, root)))) {
      issues.push(`${pattern.id}: missing fixture directory`);
    }
    if (!(await isFile(path.join(patternFixtureDir(pattern, root), "README.md")))) {
      issues.push(`${pattern.id}: missing fixture README`);
    }
    try {
      const detail = await describeReferencePattern(pattern, root);
      if (typeof detail.agentConfig.name !== "string" || !detail.agentConfig.name) {
        issues.push(`${pattern.id}: agent.name is required`);
      }
      if (typeof detail.agentConfig.instructions !== "string" || !detail.agentConfig.instructions) {
        issues.push(`${pattern.id}: agent.instructions is required`);
      }
      if (!Array.isArray(detail.agentConfig.defaultTools) || detail.agentConfig.defaultTools.length === 0) {
        issues.push(`${pattern.id}: agent.defaultTools must be a non-empty array`);
      }
      if (typeof detail.evalSuite.id !== "string" || !Array.isArray(detail.evalSuite.cases) || detail.evalSuite.cases.length === 0) {
        issues.push(`${pattern.id}: eval suite must include id and cases`);
      }
    } catch (error) {
      issues.push(`${pattern.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: issues.length === 0,
    count: catalog.patterns.length,
    patterns: (catalog.patterns as unknown[]).filter(isReferencePattern).map((pattern) => pattern.id),
    issues
  };
}

export async function listPatternRunReports(workspaceRoot: string): Promise<ReferencePatternRunReport[]> {
  const dir = path.join(workspaceRoot, ".agentbase", "pattern-runs");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const reports: ReferencePatternRunReport[] = [];
  for (const file of files.filter((candidate) => candidate.endsWith(".json"))) {
    const reportFile = path.join(dir, file);
    try {
      const parsed = JSON.parse(await readFile(reportFile, "utf8")) as ReferencePatternRunReport;
      if (isPatternRunReport(parsed)) {
        reports.push({ ...parsed, reportFile: parsed.reportFile || reportFile });
      }
    } catch {
      continue;
    }
  }
  return reports.sort((left, right) => reportTimestamp(right) - reportTimestamp(left));
}

async function isFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch {
    return false;
  }
}

async function isDirectory(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function isPatternRunReport(value: unknown): value is ReferencePatternRunReport {
  if (!isRecord(value)) return false;
  const record = value;
  return typeof record.patternId === "string" && typeof record.runId === "string" && typeof record.workspace === "string";
}

function isReferencePattern(value: unknown): value is ReferencePattern {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.agent === "string" &&
    typeof value.eval === "string" &&
    typeof value.fixture === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.requiredToolsets) &&
    value.requiredToolsets.every((toolset) => typeof toolset === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reportTimestamp(report: ReferencePatternRunReport): number {
  const evalRecord = report.eval && typeof report.eval === "object" && !Array.isArray(report.eval) ? (report.eval as Record<string, unknown>) : {};
  const createdAt = typeof evalRecord.createdAt === "string" ? evalRecord.createdAt : "";
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}
