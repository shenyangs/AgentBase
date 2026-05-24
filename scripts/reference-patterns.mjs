import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function validateReferencePatterns(options = {}) {
  const manifestFile = path.join(root, "examples", "reference-patterns.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const issues = [];
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.patterns)) {
    throw new Error("examples/reference-patterns.json must include a patterns array");
  }

  for (const pattern of manifest.patterns) {
    validatePatternShape(pattern, issues);
    if (issues.length > 0) continue;
    const patternDir = path.join(root, "examples", pattern.id);
    const agentFile = path.join(root, "examples", pattern.agent);
    const evalFile = path.join(root, "examples", pattern.eval);
    const fixtureDir = path.resolve(root, "examples", pattern.fixture);
    const readmeFile = path.join(patternDir, "README.md");

    await requireFile(agentFile, `${pattern.id}.agent`, issues);
    await requireFile(evalFile, `${pattern.id}.eval`, issues);
    await requireFile(readmeFile, `${pattern.id}.readme`, issues);
    await requireDirectory(fixtureDir, `${pattern.id}.fixture`, issues);

    try {
      const agent = JSON.parse(await readFile(agentFile, "utf8"));
      if (!agent.name || typeof agent.name !== "string") issues.push(`${pattern.id}: agent.name is required`);
      if (!agent.instructions || typeof agent.instructions !== "string") issues.push(`${pattern.id}: agent.instructions is required`);
      if (!Array.isArray(agent.defaultTools) || agent.defaultTools.length === 0) issues.push(`${pattern.id}: agent.defaultTools must be a non-empty array`);
    } catch (error) {
      issues.push(`${pattern.id}: cannot parse agent.json (${messageOf(error)})`);
    }

    try {
      const suite = parseYaml(await readFile(evalFile, "utf8"));
      if (!suite.id || suite.cases.length === 0) issues.push(`${pattern.id}: eval suite must include id and cases`);
    } catch (error) {
      issues.push(`${pattern.id}: cannot load eval suite (${messageOf(error)})`);
    }
  }

  const result = {
    ok: issues.length === 0,
    count: manifest.patterns.length,
    patterns: manifest.patterns.map((pattern) => pattern.id),
    issues
  };
  if (options.print !== false) {
    console.log(JSON.stringify(result, null, 2));
  }
  if (!result.ok) {
    throw new Error(`Reference pattern validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  }
  return result;
}

function validatePatternShape(pattern, issues) {
  if (!pattern || typeof pattern !== "object") {
    issues.push("pattern entries must be objects");
    return;
  }
  for (const key of ["id", "title", "agent", "eval", "fixture", "description"]) {
    if (!pattern[key] || typeof pattern[key] !== "string") {
      issues.push(`${String(pattern.id ?? "<unknown>")}: ${key} must be a string`);
    }
  }
  if (!Array.isArray(pattern.requiredToolsets) || pattern.requiredToolsets.length === 0) {
    issues.push(`${String(pattern.id ?? "<unknown>")}: requiredToolsets must be a non-empty array`);
  }
}

async function requireFile(file, label, issues) {
  try {
    const info = await stat(file);
    if (!info.isFile()) issues.push(`${label}: expected file at ${file}`);
  } catch {
    issues.push(`${label}: missing file at ${file}`);
  }
}

async function requireDirectory(dir, label, issues) {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) issues.push(`${label}: expected directory at ${dir}`);
    await access(path.join(dir, "README.md"));
  } catch {
    issues.push(`${label}: missing fixture directory or README at ${dir}`);
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateReferencePatterns().catch((error) => {
    console.error(messageOf(error));
    process.exitCode = 1;
  });
}
