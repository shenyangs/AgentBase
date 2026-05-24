#!/usr/bin/env node
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FileArtifactStore, createMaterializeRefTool } from "@agentbase/artifacts";
import { createCodeIndexTools } from "@agentbase/code-index";
import {
  defaultConfig,
  disableToolset,
  enableToolset,
  enabledToolsets,
  loadConfig,
  parseConfigValue,
  patchConfig,
  redactConfig,
  setConfigPath,
  summarizeConfig,
  testProviderSettings,
  validateConfig,
  writeConfig,
  type AgentBaseConfig,
  type ExportDestinationConfig
} from "@agentbase/config";
import { createDefaultContextManager } from "@agentbase/context-default";
import {
  createId,
  createMockModelProvider,
  createRuntime,
  normalizePolicy,
  type Agent,
  type ArtifactStore,
  type DatabaseConnectionConfig,
  type EvalCase,
  type EvolutionRollbackResult,
  type EvolutionProposal,
  type EvolutionPromotion,
  type McpServerConfig,
  type MemoryProposalStore,
  type MemoryStore,
  type ModelProvider,
  type PolicyName,
  type RuntimeEvent,
  type RunState,
  type Tool,
  type TraceStore,
  type WorkflowSpec
} from "@agentbase/core";
import { loadEvalSuite, runEvalSuite, summarizeEvalResults } from "@agentbase/evals";
import { gateEvolutionProposal, proposeEvolutionFromTrace } from "@agentbase/evolution";
import { scanRuntimeEvents, scanTextForGuardrails, summarizeGuardrailResults } from "@agentbase/guardrails";
import { JsonMemoryProposalStore, JsonMemoryStore, createMemoryTools } from "@agentbase/memory";
import { listMcpServerTools, loadMcpServerTools } from "@agentbase/mcp";
import { createOrchestrationPlan, createRuntimeWorkflowExecutor, defaultAgentSpecs } from "@agentbase/orchestrator";
import {
  defaultPatternPrompt,
  describeReferencePattern,
  getReferencePattern,
  loadReferencePatternCatalog,
  patternAgentFile,
  patternEvalFile,
  patternFixtureDir,
  type ReferencePattern,
  type ReferencePatternRunReport
} from "@agentbase/patterns";
import { createLiteLLMProvider } from "@agentbase/provider-litellm";
import { createOllamaProvider } from "@agentbase/provider-ollama";
import { createOpenAICompatibleProvider } from "@agentbase/provider-openai-compatible";
import { diffReplay, extractReplayOutput, loadReplayTrace, replayRun, summarizeReplay } from "@agentbase/replay";
import { startAgentBaseServer } from "@agentbase/server";
import { startStudioServer } from "@agentbase/studio";
import { SqlitePlatformStore } from "@agentbase/stores-sqlite";
import { browserDoctor, createBrowserTools } from "@agentbase/tools-browser";
import { createDatabaseTools } from "@agentbase/tools-database";
import { createFsTools } from "@agentbase/tools-fs";
import { createGitTools } from "@agentbase/tools-git";
import { createHttpTools } from "@agentbase/tools-http";
import { createShellTool } from "@agentbase/tools-shell";
import { createHttpSearchProvider, createStaticSearchProvider, createWebTools } from "@agentbase/tools-web";
import { JsonlTraceStore, serializeTraceExport, type TraceExportFormat } from "@agentbase/trace";
import { RepoWiki } from "@agentbase/wiki";

export type CliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
};

export async function main(argv = process.argv.slice(2), io: CliIo = defaultIo): Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case "init":
      await commandInit(rest, io);
      return;
    case "run":
      await commandRun(rest, io);
      return;
    case "trace":
      await commandTrace(rest, io);
      return;
    case "session":
      await commandSession(rest, io);
      return;
    case "approval":
      await commandApproval(rest, io);
      return;
    case "config":
      await commandConfig(rest, io);
      return;
    case "policy":
      await commandPolicy(rest, io);
      return;
    case "store":
      await commandStore(rest, io);
      return;
    case "tools":
      await commandTools(rest, io);
      return;
    case "provider":
      await commandProvider(rest, io);
      return;
    case "patterns":
      await commandPatterns(rest, io);
      return;
    case "memory":
      await commandMemory(rest, io);
      return;
    case "wiki":
      await commandWiki(rest, io);
      return;
    case "replay":
      await commandReplay(rest, io);
      return;
    case "eval":
      await commandEval(rest, io);
      return;
    case "evolve":
      await commandEvolve(rest, io);
      return;
    case "guardrail":
      await commandGuardrail(rest, io);
      return;
    case "team":
      await commandTeam(rest, io);
      return;
    case "studio":
      await commandStudio(rest, io);
      return;
    case "serve":
      await commandServe(rest, io);
      return;
    case "export":
      await commandExport(rest, io);
      return;
    case "backup":
      await commandBackup(rest, io);
      return;
    case "conformance":
      await commandConformance(rest, io);
      return;
    case "--help":
    case "-h":
    case undefined:
      io.stdout(helpText());
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
  }
}

async function commandInit(args: string[], io: CliIo): Promise<void> {
  const parsed = parseFlags(args);
  const target = path.resolve(process.cwd(), parsed.positionals[0] ?? ".");
  await mkdir(path.join(target, ".agentbase"), { recursive: true });
  await mkdir(path.join(target, "src"), { recursive: true });

  await writeJsonIfAbsent(path.join(target, ".agentbase", "config.json"), defaultConfig(path.basename(target)));
  await writeJsonIfAbsent(path.join(target, ".agentbase", "agent.json"), defaultAgent());
  await writeTextIfAbsent(
    path.join(target, "README.md"),
    [
      `# ${path.basename(target)}`,
      "",
      "This project was initialized by AgentBase.",
      "",
      "Try:",
      "",
      "```bash",
      'pnpm agentbase run "summarize this repo" --mock',
      "pnpm agentbase trace list",
      "```",
      ""
    ].join("\n")
  );
  await writeTextIfAbsent(path.join(target, "src", "index.ts"), `export const message = "Hello from AgentBase fixture";\n`);

  io.stdout(`Initialized AgentBase project at ${target}`);
}

async function commandRun(args: string[], io: CliIo): Promise<void> {
  const parsed = parseFlags(args);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;

  if (parsed.positionals[0] === "cancel") {
    const runId = parsed.positionals[1];
    if (!runId) {
      await platform?.close();
      throw new Error("Usage: agentbase run cancel <run-id> [--cwd <dir>] [--reason <text>]");
    }
    if (!platform) {
      throw new Error("Run cancellation requires sqlite trace store.");
    }
    const reason = typeof parsed.flags.reason === "string" ? parsed.flags.reason : "cancelled by cli";
    await platform.write({ id: createId("evt"), runId, type: "run.cancelled", ts: new Date().toISOString(), data: { reason } });
    await platform.writeAudit({ action: "run.cancelled", target: runId, runId, actor: "cli", metadata: { reason } });
    const run = await platform.getRun(runId);
    if (run?.sessionId) {
      await platform.updateSession(run.sessionId, { status: "paused" });
    }
    io.stdout(`${runId}\tcancelled`);
    await platform.close();
    return;
  }

  const agent = await loadAgent(cwd);
  const resumeRunId = typeof parsed.flags.resume === "string" ? parsed.flags.resume : undefined;
  const resumedRun = resumeRunId ? await platform?.getRun(resumeRunId) : undefined;
  if (resumeRunId && resumedRun?.status === "cancelled") {
    await platform?.close();
    throw new Error(`Run ${resumeRunId} is cancelled and cannot be resumed.`);
  }
  const resumeState = resumeRunId && platform ? await loadResumeState(platform, resumeRunId) : undefined;
  if (resumeRunId && platform && !resumeState) {
    await platform.close();
    throw new Error(`Run ${resumeRunId} has no checkpoint to resume.`);
  }
  const prompt = parsed.positionals.join(" ").trim() || resumeState?.input || resumedRun?.input || "";

  if (!prompt) {
    await platform?.close();
    throw new Error("Missing prompt. Usage: agentbase run \"summarize this repo\" --mock [--resume <run-id>]");
  }

  const trace = platform ? nonClosingTraceStore(platform) : new JsonlTraceStore({ dir: path.resolve(cwd, config.trace.dir) });
  const artifacts = loadArtifactStore(cwd, config, platform);
  const model = loadModelProvider(config, Boolean(parsed.flags.mock));
  const runId = resumeRunId ?? createId("run");
  const sessionId = typeof parsed.flags.session === "string" ? parsed.flags.session : resumedRun?.sessionId ?? createId("ses");

  if (platform) {
    await platform.createSession({ id: sessionId, status: "active", activeRunId: runId, input: prompt, metadata: { cwd } });
  }

  const runtime = createRuntime({
    workspaceRoot: path.resolve(cwd, config.workspaceRoot),
    model,
    tools: await loadTools(cwd, config, platform),
    context: loadContextManager(cwd, config, platform, artifacts),
    policy: normalizePolicy(config.policy),
    trace,
    artifacts,
    approvals: platform,
    limits: config.limits,
    env: process.env
  });

  const result = await runtime.run(agent, prompt, { runId, sessionId, resumeState });
  if (platform) {
    await platform.updateSession(sessionId, {
      status: result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : "paused",
      activeRunId: result.runId
    });
  }
  const tracePath = platform ? path.resolve(cwd, config.trace.dir, `${result.runId}.jsonl`) : (trace as JsonlTraceStore).fileForRun(result.runId);
  if (platform) {
    await platform.exportJsonl(tracePath, result.runId);
    await platform.close();
  }

  if (result.finalMessage) {
    io.stdout(result.finalMessage);
  }
  io.stdout(`\nRun ${result.status}: ${result.runId}`);
  if (result.approvalId) {
    io.stdout(`Approval required: ${result.approvalId}`);
    io.stdout(`Resume after approval: agentbase approval approve ${result.approvalId} --cwd ${cwd} && agentbase run --resume ${result.runId} --cwd ${cwd}`);
  }
  io.stdout(`Trace: ${tracePath}`);
  if (platform) {
    io.stdout(`Store: ${path.resolve(cwd, config.stores?.sqliteFile ?? ".agentbase/agentbase.sqlite")}`);
  }
}

async function commandTrace(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  const trace = platform ?? new JsonlTraceStore({ dir: path.resolve(cwd, config.trace.dir) });

  if (subcommand === "list") {
    const runs = platform ? await platform.listRuns({ limit: Number(parsed.flags.limit ?? 100) }) : await (trace as JsonlTraceStore).listRuns();
    if (runs.length === 0) {
      io.stdout("No runs found.");
      await platform?.close();
      return;
    }

    const lines = ["runId\tstatus\tevents\tagent\tstartedAt"];
    for (const run of runs) {
      const events = platform ? (await platform.readRun(run.runId)).length : "events" in run ? run.events : 0;
      lines.push(`${run.runId}\t${run.status}\t${events}\t${run.agent ?? "-"}\t${run.startedAt ?? "-"}`);
    }
    io.stdout(lines.join("\n"));
    await platform?.close();
    return;
  }

  if (subcommand === "show") {
    const runId = parsed.positionals[0];
    if (!runId) {
      throw new Error("Missing run id. Usage: agentbase trace show <run-id>");
    }

    const events = await trace.readRun(runId);
    io.stdout(`Trace ${runId}`);
    io.stdout(`Events: ${events.length}`);
    for (const event of events) {
      io.stdout(`${event.ts} ${event.type} ${formatEventData(event.data)}`);
    }
    await platform?.close();
    return;
  }

  throw new Error("Usage: agentbase trace list|show <run-id>");
}

async function commandSession(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = loadPlatformStore(cwd, config);

  if (subcommand === "list") {
    const sessions = await platform.listSessions({ limit: Number(parsed.flags.limit ?? 50) });
    io.stdout(sessions.map((session) => `${session.id}\t${session.status}\t${session.activeRunId ?? "-"}\t${session.updatedAt}\t${session.input ?? ""}`).join("\n") || "No sessions found.");
    await platform.close();
    return;
  }

  if (subcommand === "show") {
    const id = parsed.positionals[0];
    if (!id) throw new Error("Usage: agentbase session show <session-id>");
    const session = await platform.getSession(id);
    io.stdout(JSON.stringify(session ?? null, null, 2));
    await platform.close();
    return;
  }

  if (subcommand === "pause" || subcommand === "resume") {
    const id = parsed.positionals[0];
    if (!id) throw new Error(`Usage: agentbase session ${subcommand} <session-id>`);
    const session = await platform.updateSession(id, { status: subcommand === "pause" ? "paused" : "active" });
    io.stdout(`${session.id}\t${session.status}`);
    await platform.close();
    return;
  }

  throw new Error("Usage: agentbase session list|show|pause|resume");
}

async function commandApproval(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = loadPlatformStore(cwd, config);

  if (subcommand === "list") {
    const approvals = await platform.listApprovals({
      runId: typeof parsed.flags.run === "string" ? parsed.flags.run : undefined,
      status: typeof parsed.flags.status === "string" ? (parsed.flags.status as never) : undefined,
      limit: Number(parsed.flags.limit ?? 50)
    });
    io.stdout(
      approvals
        .map((approval) => `${approval.id}\t${approval.status}\t${approval.runId}\t${approval.toolName ?? "-"}\t${approval.requestedAt}\t${approval.reason}`)
        .join("\n") || "No approvals found."
    );
    await platform.close();
    return;
  }

  if (subcommand === "show") {
    const id = parsed.positionals[0];
    if (!id) throw new Error("Usage: agentbase approval show <approval-id>");
    io.stdout(JSON.stringify((await platform.getApproval(id)) ?? null, null, 2));
    await platform.close();
    return;
  }

  if (subcommand === "approve" || subcommand === "deny") {
    const id = parsed.positionals[0];
    if (!id) throw new Error(`Usage: agentbase approval ${subcommand} <approval-id> [--reason <text>]`);
    const approval = await platform.decideApproval({
      approvalId: id,
      decision: subcommand === "approve" ? "approved" : "denied",
      decidedBy: typeof parsed.flags.actor === "string" ? parsed.flags.actor : "cli",
      reason: typeof parsed.flags.reason === "string" ? parsed.flags.reason : undefined
    });
    io.stdout(`${approval.id}\t${approval.status}\t${approval.runId}`);
    await platform.close();
    return;
  }

  throw new Error("Usage: agentbase approval list|show|approve|deny [--cwd <dir>]");
}

async function commandConfig(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));

  if (subcommand === "show") {
    const config = await loadConfig(cwd);
    io.stdout(JSON.stringify({ config: redactConfig(config), summary: summarizeConfig(config), issues: validateConfig(config) }, null, 2));
    return;
  }

  if (subcommand === "doctor") {
    const config = JSON.parse(await readFile(path.join(cwd, ".agentbase", "config.json"), "utf8")) as AgentBaseConfig;
    const issues = validateConfig(config);
    io.stdout(JSON.stringify({ ok: issues.length === 0, issues, config: summarizeConfig(config) }, null, 2));
    return;
  }

  if (subcommand === "set") {
    const key = parsed.positionals[0];
    const rawValue = parsed.positionals.slice(1).join(" ");
    if (!key || !rawValue) {
      throw new Error("Usage: agentbase config set <path> <value> [--cwd <dir>]");
    }
    const config = setConfigPath(await loadConfig(cwd), key, parseConfigValue(rawValue));
    await writeConfig(cwd, config);
    await recordGovernanceEvent(cwd, config, "config.updated", { path: key }, "cli");
    io.stdout(`Config updated: ${key}`);
    return;
  }

  throw new Error("Usage: agentbase config show|doctor|set [--cwd <dir>]");
}

async function commandPolicy(args: string[], io: CliIo): Promise<void> {
  const [subcommand = "show", ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);

  if (subcommand === "show") {
    io.stdout(JSON.stringify({ policy: config.policy }, null, 2));
    return;
  }

  if (subcommand === "set") {
    const policy = parsed.positionals[0];
    if (!isPolicyName(policy)) {
      throw new Error("Usage: agentbase policy set read-only|workspace-write|developer|trusted [--cwd <dir>]");
    }
    const next = patchConfig(config, { policy });
    await writeConfig(cwd, next);
    await recordGovernanceEvent(cwd, next, "policy.updated", { previous: config.policy, policy }, "cli");
    io.stdout(`Policy updated: ${policy}`);
    return;
  }

  throw new Error("Usage: agentbase policy show|set [--cwd <dir>]");
}

async function commandStore(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = loadPlatformStore(cwd, config);

  if (subcommand === "migrate") {
    io.stdout(JSON.stringify(await platform.doctor(), null, 2));
    await platform.close();
    return;
  }

  if (subcommand === "doctor") {
    io.stdout(JSON.stringify(await platform.doctor(), null, 2));
    await platform.close();
    return;
  }

  if (subcommand === "compact") {
    await platform.compact();
    io.stdout("Store compacted.");
    await platform.close();
    return;
  }

  if (subcommand === "prune") {
    const retention = config.stores?.retention ?? {};
    const report = await platform.prune({
      before: typeof parsed.flags.before === "string" ? parsed.flags.before : undefined,
      olderThanDays: numberFlag(valueFlag(parsed.flags.days, parsed.flags["older-than-days"])) ?? retention.days,
      keepLastRuns: numberFlag(valueFlag(parsed.flags["keep-last"], parsed.flags.keepLastRuns)) ?? retention.keepLastRuns ?? 500,
      dryRun: Boolean(parsed.flags["dry-run"] ?? parsed.flags.dryRun)
    });
    io.stdout(JSON.stringify(report, null, 2));
    await platform.close();
    return;
  }

  throw new Error("Usage: agentbase store migrate|doctor|compact|prune [--cwd <dir>]");
}

async function commandTools(args: string[], io: CliIo): Promise<void> {
  const [subcommand = "list", ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  if (subcommand === "add" || subcommand === "enable") {
    const name = parsed.positionals[0];
    if (!name) throw new Error("Usage: agentbase tools enable <tool-package>");
    const next = enableToolset(config, name);
    await writeConfig(cwd, next);
    await recordGovernanceEvent(cwd, next, "toolset.enabled", { toolset: name }, "cli");
    io.stdout(`Toolset enabled: ${name}`);
    return;
  }
  if (subcommand === "disable") {
    const name = parsed.positionals[0];
    if (!name) throw new Error("Usage: agentbase tools disable <tool-package>");
    const next = disableToolset(config, name);
    await writeConfig(cwd, next);
    await recordGovernanceEvent(cwd, next, "toolset.disabled", { toolset: name }, "cli");
    io.stdout(`Toolset disabled: ${name}`);
    return;
  }
  if (subcommand === "configure" && parsed.positionals[0] === "search") {
    const next = patchConfig(config, {
      search: {
      type: parsed.flags.type === "http" ? "http" : parsed.flags.type === "static" ? "static" : "none",
      endpoint: typeof parsed.flags.endpoint === "string" ? parsed.flags.endpoint : config.search?.endpoint,
      apiKeyEnv: typeof parsed.flags.apiKeyEnv === "string" ? parsed.flags.apiKeyEnv : config.search?.apiKeyEnv,
      results: config.search?.results
      }
    });
    await writeConfig(cwd, next);
    await recordGovernanceEvent(cwd, next, "toolset.configured", { toolset: "search", type: next.search?.type }, "cli");
    io.stdout(`Search configured: ${next.search?.type}`);
    return;
  }
  if (subcommand === "configure") {
    await configureToolset(parsed.positionals[0], parsed, cwd, config, io);
    return;
  }
  if (subcommand === "inspect") {
    const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
    const tools = await loadTools(cwd, config, platform);
    io.stdout(JSON.stringify({ toolsets: enabledToolsets(config), tools: tools.map((tool) => ({ name: tool.name, permissions: tool.requiredPermissions ?? [], risk: tool.risk ?? "low" })) }, null, 2));
    await platform?.close();
    return;
  }
  if (subcommand === "mcp") {
    await commandToolsMcp(rest, cwd, config, io);
    return;
  }
  if (subcommand === "db") {
    await commandToolsDb(rest, cwd, config, io);
    return;
  }
  if (subcommand === "browser") {
    await commandToolsBrowser(rest, config, io);
    return;
  }
  if (subcommand !== "list") throw new Error("Usage: agentbase tools list|inspect|enable|disable|configure");
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  const tools = await loadTools(cwd, config, platform);
  io.stdout(tools.map((tool) => `${tool.name}\t${tool.description}`).join("\n"));
  await platform?.close();
}

async function configureToolset(kind: string | undefined, parsed: ParsedFlags, cwd: string, config: AgentBaseConfig, io: CliIo): Promise<void> {
  let next = config;
  if (kind === "http") {
    next = enableToolset(
      patchConfig(config, {
        http: {
          allowedDomains: csvFlag(parsed.flags.allowedDomains),
          deniedDomains: csvFlag(parsed.flags.deniedDomains),
          timeoutMs: numberFlag(parsed.flags.timeoutMs),
          maxBytes: numberFlag(parsed.flags.maxBytes)
        }
      }),
      "@agentbase/tools-http"
    );
  } else if (kind === "browser") {
    next = enableToolset(
      patchConfig(config, {
        browser: {
          mode: parsed.flags.mode === "cdp" ? "cdp" : "managed",
          headless: parsed.flags.headless === "false" ? false : true,
          cdpUrl: typeof parsed.flags.cdpUrl === "string" ? parsed.flags.cdpUrl : undefined,
          allowedDomains: csvFlag(parsed.flags.allowedDomains),
          deniedDomains: csvFlag(parsed.flags.deniedDomains)
        }
      }),
      "@agentbase/tools-browser"
    );
  } else if (kind === "database") {
    const name = typeof parsed.flags.name === "string" ? parsed.flags.name : parsed.positionals[1] ?? "default";
    const driver = parsed.flags.driver === "postgres" || parsed.flags.driver === "mysql" ? parsed.flags.driver : "sqlite";
    const connection: DatabaseConnectionConfig = {
      name,
      driver,
      file: typeof parsed.flags.file === "string" ? parsed.flags.file : driver === "sqlite" ? ".agentbase/data.sqlite" : undefined,
      connectionStringEnv: typeof parsed.flags.connectionStringEnv === "string" ? parsed.flags.connectionStringEnv : undefined,
      readonly: parsed.flags.readonly === "true",
      maxRows: numberFlag(parsed.flags.maxRows),
      statementTimeoutMs: numberFlag(parsed.flags.statementTimeoutMs)
    };
    next = enableToolset(
      patchConfig(config, { database: { connections: [...(config.database?.connections ?? []).filter((candidate) => candidate.name !== name), connection] } }),
      "@agentbase/tools-database"
    );
  } else if (kind === "mcp") {
    const name = typeof parsed.flags.name === "string" ? parsed.flags.name : parsed.positionals[1] ?? "default";
    const server: McpServerConfig = {
      name,
      transport: parsed.flags.transport === "http" ? "http" : "stdio",
      command: typeof parsed.flags.command === "string" ? parsed.flags.command : undefined,
      args: typeof parsed.flags.args === "string" ? parsed.flags.args.split(" ").filter(Boolean) : undefined,
      url: typeof parsed.flags.url === "string" ? parsed.flags.url : undefined
    };
    next = enableToolset(patchConfig(config, { mcp: { servers: [...(config.mcp?.servers ?? []).filter((candidate) => candidate.name !== name), server] } }), "@agentbase/mcp");
  } else if (kind === "code-index") {
    next = enableToolset(patchConfig(config, { codeIndex: { enabled: true, maxFiles: numberFlag(parsed.flags.maxFiles) } }), "@agentbase/code-index");
  } else {
    throw new Error("Usage: agentbase tools configure http|browser|database|mcp|code-index");
  }
  await writeConfig(cwd, next);
  await recordGovernanceEvent(cwd, next, "toolset.configured", { toolset: kind }, "cli");
  io.stdout(`Configured toolset: ${kind}`);
}

async function commandToolsMcp(args: string[], _cwd: string, config: AgentBaseConfig, io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  if (subcommand === "list") {
    io.stdout((config.mcp?.servers ?? []).map((server) => `${server.name}\t${server.transport}\t${server.command ?? server.url ?? "-"}`).join("\n") || "No MCP servers configured.");
    return;
  }
  if (subcommand === "inspect") {
    const name = parsed.positionals[0];
    const servers = name ? (config.mcp?.servers ?? []).filter((server) => server.name === name) : config.mcp?.servers ?? [];
    const inspected = [];
    for (const server of servers) {
      inspected.push({ server: server.name, tools: await listMcpServerTools(server) });
    }
    io.stdout(JSON.stringify(inspected, null, 2));
    return;
  }
  throw new Error("Usage: agentbase tools mcp list|inspect [server]");
}

async function commandToolsDb(args: string[], cwd: string, config: AgentBaseConfig, io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const tools = createDatabaseTools({ connections: config.database?.connections ?? [] });
  const ctx = cliToolContext(cwd);
  if (subcommand === "test") {
    const result = await tools.find((tool) => tool.name === "db_list_connections")?.execute({}, ctx);
    io.stdout(JSON.stringify(result?.output ?? {}, null, 2));
    return;
  }
  if (subcommand === "schema") {
    const connection = parsed.positionals[0] ?? config.database?.connections[0]?.name;
    if (!connection) throw new Error("No database connection configured.");
    const result = await tools.find((tool) => tool.name === "db_schema")?.execute({ connection }, ctx);
    io.stdout(JSON.stringify(result?.output ?? {}, null, 2));
    return;
  }
  throw new Error("Usage: agentbase tools db test|schema [connection]");
}

async function commandToolsBrowser(args: string[], config: AgentBaseConfig, io: CliIo): Promise<void> {
  const [subcommand] = args;
  if (subcommand === "doctor") {
    io.stdout(JSON.stringify(await browserDoctor(config.browser ?? { mode: "managed", headless: true }), null, 2));
    return;
  }
  throw new Error("Usage: agentbase tools browser doctor");
}

async function commandProvider(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);

  if (subcommand === "list" || subcommand === "show") {
    io.stdout(
      JSON.stringify(
        {
          current: redactConfig(config).provider,
          available: ["mock", "openai-compatible", "litellm", "ollama"]
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "add" || subcommand === "set") {
    const type = parsed.positionals[0];
    if (type !== "mock" && type !== "openai-compatible" && type !== "litellm" && type !== "ollama") {
      throw new Error("Usage: agentbase provider set mock|openai-compatible|litellm|ollama [--model <model>] [--baseUrl <url>] [--apiKeyEnv <env>] [--teamId <id>]");
    }

    const next = patchConfig(config, {
      provider: {
        type,
        model: typeof parsed.flags.model === "string" ? parsed.flags.model : type === "mock" ? "mock/repo-analyst" : config.provider.model,
        baseUrl: typeof parsed.flags.baseUrl === "string" ? parsed.flags.baseUrl : config.provider.baseUrl,
        apiKeyEnv: typeof parsed.flags.apiKeyEnv === "string" ? parsed.flags.apiKeyEnv : config.provider.apiKeyEnv,
        teamId: typeof parsed.flags.teamId === "string" ? parsed.flags.teamId : config.provider.teamId
      }
    });

    await writeConfig(cwd, next);
    await recordGovernanceEvent(cwd, next, "config.updated", { path: "provider", provider: type }, "cli");
    io.stdout(`Provider updated: ${next.provider.type}`);
    return;
  }

  if (subcommand === "test") {
    const result = testProviderSettings(config, process.env);
    await recordGovernanceEvent(cwd, config, "provider.tested", { provider: config.provider.type, model: config.provider.model, ok: result.ok }, "cli");
    io.stdout(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error("Usage: agentbase provider show|set|test");
}

async function commandPatterns(args: string[], io: CliIo): Promise<void> {
  const [subcommand = "list", ...rest] = args;
  const parsed = parseFlags(rest);
  const catalog = await loadReferencePatternCatalog();

  if (subcommand === "list") {
    if (parsed.flags.json) {
      io.stdout(JSON.stringify(catalog, null, 2));
      return;
    }
    io.stdout(catalog.patterns.map((pattern) => `${pattern.id}\t${pattern.title}\t${pattern.description}`).join("\n"));
    return;
  }

  if (subcommand === "show") {
    const id = parsed.positionals[0];
    const pattern = getReferencePattern(catalog, id);
    io.stdout(JSON.stringify(await describeReferencePattern(pattern), null, 2));
    return;
  }

  if (subcommand === "init") {
    const id = parsed.positionals[0];
    const target = parsed.positionals[1];
    if (!id || !target) {
      throw new Error("Usage: agentbase patterns init <pattern-id> <target-dir> [--force]");
    }
    const pattern = getReferencePattern(catalog, id);
    const targetDir = path.resolve(process.cwd(), target);
    await scaffoldReferencePattern(pattern, targetDir, Boolean(parsed.flags.force));
    io.stdout(`Pattern initialized: ${pattern.id} at ${targetDir}`);
    io.stdout(`Eval suite: ${path.join(targetDir, ".agentbase", "evals", `${pattern.id}.yaml`)}`);
    return;
  }

  if (subcommand === "eval") {
    const id = parsed.positionals[0];
    if (!id) {
      throw new Error("Usage: agentbase patterns eval <pattern-id> --cwd <dir> --run <run-id>");
    }
    const pattern = getReferencePattern(catalog, id);
    await commandEval(["run", "--suite", patternEvalFile(pattern), ...rest.slice(1)], io);
    return;
  }

  if (subcommand === "run") {
    const id = parsed.positionals[0];
    if (!id) {
      throw new Error("Usage: agentbase patterns run <pattern-id|all> [--target <dir>] [--discard] [--json]");
    }
    if (id === "all" && parsed.flags.target) {
      throw new Error("agentbase patterns run all does not support --target; run a single pattern with --target instead.");
    }
    const patterns = id === "all" ? catalog.patterns : [getReferencePattern(catalog, id)];
    const reports = [];
    for (const pattern of patterns) {
      reports.push(await runReferencePattern(pattern, parsed));
    }
    if (parsed.flags.json || id === "all") {
      io.stdout(JSON.stringify(id === "all" ? { ok: reports.every((report) => report.ok), reports } : reports[0], null, 2));
      return;
    }
    const report = reports[0];
    io.stdout(`Pattern ${report.patternId} ${report.ok ? "passed" : "failed"}: ${report.runId}`);
    io.stdout(`Workspace: ${report.workspace}`);
    io.stdout(`Report: ${report.reportFile}`);
    return;
  }

  throw new Error("Usage: agentbase patterns list|show|init|eval|run");
}

async function commandMemory(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  const store = loadMemoryStore(cwd, config, platform);
  const proposalStore = loadMemoryProposalStore(cwd, config, store, platform);

  if (subcommand === "add") {
    const text = parsed.positionals.join(" ").trim();
    if (!text) throw new Error("Usage: agentbase memory add <text> [--scope project]");
    const memory = await store.add({ scope: (String(parsed.flags.scope ?? "project") as never), text, kind: typeof parsed.flags.kind === "string" ? (parsed.flags.kind as never) : "fact" });
    io.stdout(`${memory.id}\t${memory.scope}\t${memory.text}`);
    await platform?.close();
    return;
  }
  if (subcommand === "search") {
    const query = parsed.positionals.join(" ").trim();
    const results = await store.search(query, { limit: Number(parsed.flags.limit ?? 20) });
    io.stdout(results.map((memory) => `${memory.id}\t${memory.scope}\t${memory.promoted ? "promoted" : "-"}\t${memory.text}`).join("\n") || "No memories found.");
    await platform?.close();
    return;
  }
  if (subcommand === "list") {
    const results = await store.list({ scope: typeof parsed.flags.scope === "string" ? (parsed.flags.scope as never) : undefined, limit: Number(parsed.flags.limit ?? 50) });
    io.stdout(results.map((memory) => `${memory.id}\t${memory.scope}\t${memory.promoted ? "promoted" : "-"}\t${memory.text}`).join("\n") || "No memories found.");
    await platform?.close();
    return;
  }
  if (subcommand === "promote") {
    const id = parsed.positionals[0];
    if (!id) throw new Error("Usage: agentbase memory promote <id>");
    const memory = await store.promote(id);
    io.stdout(`${memory.id}\tpromoted`);
    await platform?.close();
    return;
  }
  if (subcommand === "propose") {
    const text = parsed.positionals.join(" ").trim();
    if (!text) throw new Error("Usage: agentbase memory propose <text> [--scope project] [--rationale <text>]");
    const proposal = await proposalStore.propose({
      memory: {
        scope: (String(parsed.flags.scope ?? "project") as never),
        text,
        kind: typeof parsed.flags.kind === "string" ? (parsed.flags.kind as never) : "fact",
        tags: typeof parsed.flags.tags === "string" ? parsed.flags.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
        source: typeof parsed.flags.source === "string" ? parsed.flags.source : undefined
      },
      rationale: typeof parsed.flags.rationale === "string" ? parsed.flags.rationale : "Proposed through CLI for reviewed memory promotion.",
      evidence: typeof parsed.flags.evidence === "string" ? [{ type: "user", summary: parsed.flags.evidence }] : undefined
    });
    io.stdout(`${proposal.id}\t${proposal.status}\t${proposal.memory.scope}\t${proposal.memory.text}`);
    await platform?.close();
    return;
  }
  if (subcommand === "proposals") {
    const proposals = await proposalStore.listProposals({ status: typeof parsed.flags.status === "string" ? (parsed.flags.status as never) : undefined, limit: Number(parsed.flags.limit ?? 50) });
    io.stdout(proposals.map((proposal) => `${proposal.id}\t${proposal.status}\t${proposal.memory.scope}\t${proposal.memory.text}`).join("\n") || "No memory proposals found.");
    await platform?.close();
    return;
  }
  if (subcommand === "review") {
    const id = parsed.positionals[0];
    if (!id) throw new Error("Usage: agentbase memory review <proposal-id> --approve|--reject [--reason <text>]");
    if (!parsed.flags.approve && !parsed.flags.reject) throw new Error("Usage: agentbase memory review <proposal-id> --approve|--reject [--reason <text>]");
    const decision = parsed.flags.reject ? "rejected" : "approved";
    const proposal = await proposalStore.reviewProposal(id, {
      decision,
      reviewedBy: typeof parsed.flags.actor === "string" ? parsed.flags.actor : "cli",
      reason: typeof parsed.flags.reason === "string" ? parsed.flags.reason : undefined
    });
    io.stdout(`${proposal.id}\t${proposal.status}`);
    await platform?.close();
    return;
  }
  if (subcommand === "promote-proposal") {
    const id = parsed.positionals[0];
    if (!id) throw new Error("Usage: agentbase memory promote-proposal <proposal-id>");
    const result = await proposalStore.promoteProposal(id);
    io.stdout(`${result.proposal.id}\tpromoted\t${result.memory.id}`);
    await platform?.close();
    return;
  }
  throw new Error("Usage: agentbase memory list|search|add|promote|propose|proposals|review|promote-proposal");
}

async function commandWiki(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  const wiki = loadWiki(cwd, config);
  if (subcommand === "index") {
    const pages = await wiki.index();
    for (const page of pages) {
      await platform?.putPage(page);
    }
    io.stdout(`Indexed ${pages.length} wiki page(s).`);
    await platform?.close();
    return;
  }
  if (subcommand === "query") {
    const query = parsed.positionals.join(" ").trim();
    const pages = platform ? await platform.query(query, { limit: Number(parsed.flags.limit ?? 10) }) : await wiki.query(query, Number(parsed.flags.limit ?? 10));
    io.stdout(pages.map((page) => `${page.path}\t${page.title}\t${page.summary}`).join("\n") || "No wiki pages found.");
    await platform?.close();
    return;
  }
  if (subcommand === "open") {
    io.stdout(path.join(cwd, config.stores?.wikiDir ?? ".agentbase/wiki", "README.md"));
    await platform?.close();
    return;
  }
  throw new Error("Usage: agentbase wiki index|query|open");
}

async function commandReplay(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  if (subcommand === "run") {
    const target = parsed.positionals[0];
    if (!target) throw new Error("Usage: agentbase replay run <run-id-or-jsonl>");
    const events = await loadReplayEvents(target, cwd, config, platform);
    io.stdout(JSON.stringify({ summary: summarizeReplay(events), replay: replayRun(events, { sourceRunId: target }) }, null, 2));
    await platform?.close();
    return;
  }
  if (subcommand === "diff") {
    const [left, right] = parsed.positionals;
    if (!left || !right) throw new Error("Usage: agentbase replay diff <left-run-id-or-jsonl> <right-run-id-or-jsonl>");
    io.stdout(JSON.stringify(diffReplay(await loadReplayEvents(left, cwd, config, platform), await loadReplayEvents(right, cwd, config, platform)), null, 2));
    await platform?.close();
    return;
  }
  throw new Error("Usage: agentbase replay run|diff <run-id-or-jsonl>");
}

async function commandEval(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  if (subcommand !== "run") throw new Error("Usage: agentbase eval run [--suite <file>] [--run <run-id-or-jsonl>] [--output <text>]");
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  const replayTarget = typeof parsed.flags.run === "string" ? parsed.flags.run : undefined;
  const replayEvents = replayTarget ? await loadReplayEvents(replayTarget, cwd, config, platform) : undefined;
  const replay = replayEvents ? extractReplayOutput(replayEvents) : undefined;
  const positionalOutput = parsed.positionals.join(" ");
  const output = String(parsed.flags.output ?? (positionalOutput || replay?.output || ""));
  const suite =
    typeof parsed.flags.suite === "string"
      ? await loadEvalSuite(path.resolve(cwd, parsed.flags.suite))
      : {
          id: String(parsed.flags.suiteId ?? "default"),
          cases:
            config.evals?.cases && config.evals.cases.length > 0
              ? config.evals.cases
              : ([{ id: "smoke", input: "smoke", assertions: [{ type: "contains", value: output.slice(0, Math.min(10, output.length)) }] }] satisfies EvalCase[])
        };
  const report = runEvalSuite(suite, output, replay ? { ...replay.metadata, events: replayEvents } : undefined);
  for (const result of report.results) {
    await platform?.putEvalResult({ ...result, suite: report.suite, createdAt: report.createdAt });
  }
  if (platform) {
    await platform.write({
      id: createId("evt"),
      runId: replay?.metadata.runId ?? createId("eval_run"),
      type: "eval.completed",
      ts: report.createdAt,
      data: {
        suite: report.suite,
        passed: report.passed,
        failed: report.failed,
        score: report.score,
        results: report.results
      }
    });
  }
  io.stdout(JSON.stringify(report, null, 2));
  await platform?.close();
}

async function commandGuardrail(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  if (subcommand !== "scan") throw new Error("Usage: agentbase guardrail scan [text] [--run <run-id-or-jsonl>] [--cwd <dir>] [--json]");
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  const runTarget = typeof parsed.flags.run === "string" ? parsed.flags.run : undefined;
  const text = parsed.positionals.join(" ").trim();
  if (!runTarget && !text) {
    await platform?.close();
    throw new Error("Usage: agentbase guardrail scan [text] [--run <run-id-or-jsonl>] [--cwd <dir>] [--json]");
  }

  const events = runTarget ? await loadReplayEvents(runTarget, cwd, config, platform) : undefined;
  const results = events ? scanRuntimeEvents(events, { source: "cli.run" }) : scanTextForGuardrails(text, { source: "cli.text" });
  const summary = summarizeGuardrailResults(results);
  const scanRunId = events?.[0]?.runId ?? runTarget ?? "guardrail";
  if (platform) {
    await platform.write({
      id: createId("evt"),
      runId: scanRunId,
      type: "guardrail.completed",
      ts: new Date().toISOString(),
      data: {
        allowed: summary.allowed,
        count: summary.count,
        highestSeverity: summary.highestSeverity,
        categories: summary.categories,
        source: runTarget ? "run" : "text"
      }
    });
    await platform.writeAudit({
      action: "guardrail.scanned",
      target: runTarget ?? "inline-text",
      runId: events?.[0]?.runId,
      actor: "cli",
      metadata: {
        allowed: summary.allowed,
        count: summary.count,
        highestSeverity: summary.highestSeverity,
        categories: summary.categories,
        source: runTarget ? "run" : "text"
      }
    });
  }
  await platform?.close();

  if (parsed.flags.json) {
    io.stdout(JSON.stringify({ ok: summary.allowed, summary, results }, null, 2));
    return;
  }
  if (results.length === 0) {
    io.stdout("No guardrail findings.");
    return;
  }
  io.stdout(
    results
      .map((result) => `${result.severity ?? "medium"}\t${result.category ?? "unknown"}\t${result.reason}`)
      .join("\n")
  );
}

async function commandEvolve(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  if (subcommand === "propose") {
    const target = parsed.positionals[0];
    if (!target) throw new Error("Usage: agentbase evolve propose <run-id-or-jsonl>");
    const proposal = proposeEvolutionFromTrace(await loadReplayEvents(target, cwd, config, platform));
    await appendJsonArray(path.resolve(cwd, config.stores?.evolutionFile ?? ".agentbase/evolution/proposals.json"), proposal);
    io.stdout(JSON.stringify(proposal, null, 2));
    await platform?.close();
    return;
  }
  if (subcommand === "test") {
    const proposalId = parsed.positionals[0];
    const proposal = proposalId
      ? ((await readJsonArray(path.resolve(cwd, config.stores?.evolutionFile ?? ".agentbase/evolution/proposals.json"))).find(
          (item) => isRecord(item) && item.id === proposalId
        ) as ReturnType<typeof proposeEvolutionFromTrace> | undefined)
      : undefined;
    const replayTarget = typeof parsed.flags.run === "string" ? parsed.flags.run : undefined;
    const replay = replayTarget ? extractReplayOutput(await loadReplayEvents(replayTarget, cwd, config, platform)) : undefined;
    const output = String(parsed.flags.output ?? replay?.output ?? "");
    const suite =
      typeof parsed.flags.suite === "string"
        ? await loadEvalSuite(path.resolve(cwd, parsed.flags.suite))
        : {
            id: "evolution-gate",
            cases: [{ id: "smoke", input: "smoke", assertions: [{ type: "contains", value: output.slice(0, Math.min(10, output.length)) }] }] satisfies EvalCase[]
          };
    const report = runEvalSuite(suite, output, replay?.metadata);
    const gated = gateEvolutionProposal(
      proposal ?? { id: proposalId ?? "evo_manual", kind: "memory", title: "manual gate", rationale: "manual", status: "proposed", createdAt: new Date().toISOString() },
      report.results
    );
    await appendJsonArray(path.resolve(cwd, config.stores?.evolutionFile ?? ".agentbase/evolution/proposals.json"), gated);
    io.stdout(JSON.stringify({ proposal: gated, report }, null, 2));
    await platform?.close();
    return;
  }
  if (subcommand === "promote") {
    const proposalId = parsed.positionals[0];
    if (!proposalId) throw new Error("Usage: agentbase evolve promote <proposal-id> [--cwd <dir>]");
    const proposalsFile = path.resolve(cwd, config.stores?.evolutionFile ?? ".agentbase/evolution/proposals.json");
    const proposal = await loadEvolutionProposal(proposalsFile, proposalId);
    if (proposal.status !== "tested") {
      await platform?.close();
      throw new Error(`Proposal ${proposalId} must be tested before promotion.`);
    }
    const promotion = await promoteEvolutionProposal(cwd, config, proposal);
    await saveEvolutionProposal(proposalsFile, { ...proposal, status: "promoted" });
    await appendJsonArray(evolutionPromotionsFile(cwd, config), promotion);
    await platform?.write({ id: createId("evt"), runId: "governance", type: "evolution.promoted", ts: new Date().toISOString(), data: { proposalId: proposal.id, promotionId: promotion.id, kind: promotion.kind, target: promotion.target } });
    await platform?.writeAudit({ action: "evolution.promoted", target: promotion.target, actor: "cli", metadata: { proposalId: proposal.id, promotionId: promotion.id, kind: promotion.kind } });
    io.stdout(JSON.stringify(promotion, null, 2));
    await platform?.close();
    return;
  }
  if (subcommand === "rollback") {
    const promotionId = parsed.positionals[0];
    if (!promotionId) throw new Error("Usage: agentbase evolve rollback <promotion-id> [--cwd <dir>]");
    const rollback = await rollbackEvolutionPromotion(cwd, config, promotionId);
    await platform?.write({ id: createId("evt"), runId: "governance", type: "evolution.rolled_back", ts: new Date().toISOString(), data: { promotionId: rollback.promotion.id, target: rollback.target, restored: rollback.restored } });
    await platform?.writeAudit({ action: "evolution.rolled_back", target: rollback.target, actor: "cli", metadata: { promotionId: rollback.promotion.id, restored: rollback.restored } });
    io.stdout(JSON.stringify(rollback, null, 2));
    await platform?.close();
    return;
  }
  throw new Error("Usage: agentbase evolve propose|test|promote|rollback");
}

async function commandTeam(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  if (subcommand === "cancel") {
    const workflowRunId = parsed.positionals[0];
    if (!workflowRunId) {
      await platform?.close();
      throw new Error("Usage: agentbase team cancel <workflow-run-id> [--cwd <dir>] [--reason <text>]");
    }
    if (!platform) {
      throw new Error("Workflow cancellation requires sqlite trace store.");
    }
    const reason = typeof parsed.flags.reason === "string" ? parsed.flags.reason : "cancelled by cli";
    const ts = new Date().toISOString();
    await platform.write({ id: createId("evt"), runId: workflowRunId, type: "workflow.cancel_requested", ts, data: { reason, actor: "cli" } });
    await platform.write({ id: createId("evt"), runId: workflowRunId, type: "workflow.cancelled", ts: new Date().toISOString(), data: { reason } });
    await platform.write({ id: createId("evt"), runId: workflowRunId, type: "run.cancelled", ts: new Date().toISOString(), data: { reason } });
    await platform.writeAudit({ action: "workflow.cancelled", target: workflowRunId, runId: workflowRunId, actor: "cli", metadata: { reason } });
    await platform.close();
    io.stdout(`${workflowRunId}\tcancelled`);
    return;
  }
  if (subcommand !== "run") throw new Error("Usage: agentbase team run|cancel <task-or-workflow-run-id> [--workflow <file>] [--cwd <dir>] [--resume <workflow-run-id>]");
  const trace = platform ? nonClosingTraceStore(platform) : new JsonlTraceStore({ dir: path.resolve(cwd, config.trace.dir) });
  const input = parsed.positionals.join(" ").trim();
  const workflow = typeof parsed.flags.workflow === "string" ? await loadWorkflowSpec(cwd, parsed.flags.workflow) : defaultWorkflow(input);
  const sessionId = typeof parsed.flags.session === "string" ? parsed.flags.session : createId("ses");
  const workflowRunId = typeof parsed.flags.resume === "string" ? parsed.flags.resume : createId("workflow_run");
  const resume = typeof parsed.flags.resume === "string";

  if (platform) {
    await platform.createSession({ id: sessionId, status: "active", activeRunId: workflowRunId, input: input || workflow.name, metadata: { cwd, workflow: workflow.name } });
  }

  const runtime = createRuntime({
    workspaceRoot: path.resolve(cwd, config.workspaceRoot),
    model: loadModelProvider(config, Boolean(parsed.flags.mock)),
    tools: await loadTools(cwd, config, platform),
    context: loadContextManager(cwd, config, platform, loadArtifactStore(cwd, config, platform)),
    policy: normalizePolicy(config.policy),
    trace,
    artifacts: loadArtifactStore(cwd, config, platform),
    approvals: platform,
    limits: config.limits,
    env: process.env
  });
  const executor = createRuntimeWorkflowExecutor({ runtime, trace, readRun: platform ? (runId) => platform.readRun(runId) : undefined, maxParallelTasks: config.orchestration?.maxParallelTasks });
  const result = await executor.execute(workflow, { runId: workflowRunId, sessionId, resume, maxParallelTasks: parsed.flags.parallel ? Number(parsed.flags.parallel) : config.orchestration?.maxParallelTasks });
  if (platform) {
    await platform.updateSession(sessionId, { status: result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : "paused", activeRunId: workflowRunId });
    await platform.exportJsonl(path.resolve(cwd, config.trace.dir, `${workflowRunId}.jsonl`), workflowRunId);
    await platform.close();
  }
  io.stdout(JSON.stringify({ plan: createOrchestrationPlan(workflow), result }, null, 2));
  if (result.status === "waiting_approval") {
    const approvalId = result.assignments.find((assignment) => assignment.approvalId)?.approvalId;
    if (approvalId) {
      io.stdout(`Approval required: ${approvalId}`);
      io.stdout(`Resume after approval: agentbase approval approve ${approvalId} --cwd ${cwd} && agentbase team run --resume ${workflowRunId} --workflow ${parsed.flags.workflow ?? "<same-workflow.json>"} --cwd ${cwd}`);
    }
  }
}

async function commandStudio(args: string[], io: CliIo): Promise<void> {
  const parsed = parseFlags(args);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const server = await startStudioServer({
    traceDir: path.resolve(cwd, config.trace.dir),
    sqliteFile: isSqliteConfig(config) ? sqliteFileFor(cwd, config) : undefined,
    configFile: path.join(cwd, ".agentbase", "config.json"),
    port: parsed.flags.port ? Number(parsed.flags.port) : undefined
  });
  io.stdout(server.url);
  if (parsed.flags.once) {
    await server.close();
    return;
  }
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await server.close();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function commandServe(args: string[], io: CliIo): Promise<void> {
  const parsed = parseFlags(args);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const token = config.auth?.tokenEnv ? process.env[config.auth.tokenEnv] : undefined;
  const server = await startAgentBaseServer({
    sqliteFile: sqliteFileFor(cwd, config),
    configFile: path.join(cwd, ".agentbase", "config.json"),
    port: parsed.flags.port ? Number(parsed.flags.port) : config.server?.port,
    token
  });
  io.stdout(server.url);
  if (parsed.flags.once) {
    await server.close();
    return;
  }
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await server.close();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function commandExport(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  if (subcommand === "push") {
    const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
    const target = typeof parsed.flags.target === "string" ? parsed.flags.target : parsed.positionals[0];
    if (!target) {
      await platform?.close();
      throw new Error("Usage: agentbase export push --target <name> [--run <run-id>]");
    }
    const runId = typeof parsed.flags.run === "string" ? parsed.flags.run : undefined;
    const destination = findExportDestination(config, target);
    const events = await loadExportEvents(cwd, config, platform, runId);
    try {
      const result = await pushTraceExport(destination, events);
      await platform?.write({ id: createId("evt"), runId: runId ?? "export", type: "export.completed", ts: new Date().toISOString(), data: { target, destinationType: destination.type, status: result.status, eventCount: events.length } });
      await platform?.writeAudit({ action: "export.completed", target, runId, actor: "cli", metadata: { destinationType: destination.type, status: result.status, eventCount: events.length } });
      io.stdout(JSON.stringify({ ok: true, target, ...result }, null, 2));
    } catch (error) {
      await platform?.write({ id: createId("evt"), runId: runId ?? "export", type: "export.failed", ts: new Date().toISOString(), data: { target, destinationType: destination.type, error: error instanceof Error ? error.message : String(error), eventCount: events.length } });
      await platform?.writeAudit({ action: "export.failed", target, runId, actor: "cli", metadata: { destinationType: destination.type, error: error instanceof Error ? error.message : String(error), eventCount: events.length } });
      throw error;
    } finally {
      await platform?.close();
    }
    return;
  }
  if (subcommand !== "traces") throw new Error("Usage: agentbase export traces|push [--format jsonl|otel|openinference|langfuse|phoenix] [--run <run-id>] [--out <file>]");
  const format = parseTraceExportFormat(parsed.flags.format);
  const platform = isSqliteConfig(config) ? loadPlatformStore(cwd, config) : undefined;
  const runId = typeof parsed.flags.run === "string" ? parsed.flags.run : undefined;
  const out = path.resolve(cwd, typeof parsed.flags.out === "string" ? parsed.flags.out : path.join(config.trace.dir, runId ? `${runId}.${format === "jsonl" ? "jsonl" : `${format}.json`}` : `all-runs.${format === "jsonl" ? "jsonl" : `${format}.json`}`));
  const events = await loadExportEvents(cwd, config, platform, runId);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, serializeTraceExport(events, format), "utf8");
  await platform?.writeAudit({ action: "export.traces", target: out, runId, actor: "cli", metadata: { format, eventCount: events.length } });
  await platform?.close();
  io.stdout(out);
}

async function commandBackup(args: string[], io: CliIo): Promise<void> {
  const [subcommand, ...rest] = args;
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  if (subcommand === "restore") {
    const source = parsed.positionals[0] ?? (typeof parsed.flags.from === "string" ? parsed.flags.from : undefined);
    if (!source) throw new Error("Usage: agentbase backup restore <backup-file> [--cwd <dir>]");
    const target = sqliteFileFor(cwd, config);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.resolve(cwd, source), target);
    io.stdout(`Restored ${target}`);
    return;
  }

  if (subcommand !== "create") throw new Error("Usage: agentbase backup create|restore [--out <file>]");
  const platform = loadPlatformStore(cwd, config);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.resolve(cwd, typeof parsed.flags.out === "string" ? parsed.flags.out : `.agentbase/backups/agentbase-${timestamp}.sqlite`);
  await platform.backupTo(out);
  await platform.close();
  io.stdout(out);
}

async function commandConformance(args: string[], io: CliIo): Promise<void> {
  const [subcommand = "run", ...rest] = args;
  if (subcommand !== "run") throw new Error("Usage: agentbase conformance run [--cwd <dir>] [--run <run-id>]");
  const parsed = parseFlags(rest);
  const cwd = path.resolve(process.cwd(), String(parsed.flags.cwd ?? "."));
  const config = await loadConfig(cwd);
  const platform = loadPlatformStore(cwd, config);
  const runId = typeof parsed.flags.run === "string" ? parsed.flags.run : (await platform.listRuns({ limit: 1 }))[0]?.runId;
  if (!runId) {
    await platform.close();
    throw new Error("Conformance requires at least one recorded run.");
  }
  const events = await platform.readRun(runId);
  const audit = await platform.listAudit({ limit: 1000 });
  const artifacts = await platform.list({ runId, limit: 1000 });
  const guardrailResults = scanRuntimeEvents(events, { source: "conformance.run" });
  const workflowChildRuns = workflowChildRunIds(events);
  const checks = [
    conformanceCheck("config.valid", validateConfig(config).filter((issue) => issue.severity === "error").length === 0, "configuration validates against @agentbase/config"),
    conformanceCheck("trace.append_only.run_start", hasEvent(events, "run.started") || hasEvent(events, "run.resumed"), "run has a start or resume event"),
    conformanceCheck("trace.context_snapshot", hasEvent(events, "context.prepared") || (await childRunsHaveEvent(platform, workflowChildRuns, "context.prepared")), "run records context preparation"),
    conformanceCheck("trace.checkpoint_phases", hasCheckpointPhaseContract(events), "checkpoint events carry stable phase labels"),
    conformanceCheck("trace.policy_decision", hasEvent(events, "policy.checked") || (await childRunsSatisfyPolicyContract(platform, workflowChildRuns)), "run records policy decisions before tool execution"),
    conformanceCheck("trace.model_completed", hasEvent(events, "model.completed") || (await childRunsHaveEvent(platform, workflowChildRuns, "model.completed")), "run records model completions"),
    conformanceCheck("trace.terminal_event", events.some((event) => ["run.completed", "run.failed", "run.cancelled", "run.waiting_approval"].includes(event.type)), "run has a terminal or checkpoint event"),
    conformanceCheck("tool.output_envelope", hasToolResultEnvelope(events), "completed tool calls have artifact-backed summary/preview/artifacts/metadata envelopes"),
    conformanceCheck("artifacts.indexed", artifacts.length > 0 || events.every((event) => event.type !== "artifact.created"), "artifact metadata is queryable when artifacts are created"),
    conformanceCheck("workflow.artifact_refs", hasWorkflowArtifactRefContract(events), "workflow child steps preserve artifact refs when present"),
    conformanceCheck("workflow.cancel_contract", hasWorkflowCancellationContract(events), "workflow cancellations record request and terminal events"),
    conformanceCheck("guardrail.no_high_risk_findings", guardrailResults.every((result) => !["high", "critical"].includes(result.severity ?? "medium")), "recorded run has no high-severity guardrail findings"),
    conformanceCheck("approval.checkpoint_contract", hasApprovalCheckpointContract(events), "approval runs include durable pending/completed tool-call checkpoint state"),
    conformanceCheck("approval.resume_or_decision", hasApprovalResumeOrDecision(events), "approval runs record waiting checkpoint plus an approval decision or reuse event"),
    conformanceCheck("audit.config_mutations", audit.some((entry) => ["config.updated", "policy.updated", "toolset.enabled", "toolset.disabled", "toolset.configured", "provider.tested"].includes(entry.action)), "governance mutations are auditable"),
    conformanceCheck("audit.export_push", hasExportPushAuditContract(audit, config), "configured export destinations produce audited push results"),
    conformanceCheck("audit.evolution_promotion", hasEvolutionPromotionAuditContract(audit), "evolution promotion and rollback are auditable when used")
  ];
  const ok = checks.every((check) => check.ok);
  await platform.write({
    id: createId("evt"),
    runId,
    type: "conformance.completed",
    ts: new Date().toISOString(),
    data: { ok, checks, contract: "agentbase-local-first-1.0" }
  });
  await platform.writeAudit({ action: "conformance.completed", target: runId, runId, actor: "cli", metadata: { ok, failed: checks.filter((check) => !check.ok).map((check) => check.name) } });
  await platform.close();
  io.stdout(JSON.stringify({ ok, runId, checks }, null, 2));
  if (!ok) {
    throw new Error(`Conformance failed: ${checks.filter((check) => !check.ok).map((check) => check.name).join(", ")}`);
  }
}

async function runReferencePattern(pattern: ReferencePattern, parsed: ParsedFlags): Promise<ReferencePatternRunReport> {
  const explicitTarget = typeof parsed.flags.target === "string" ? parsed.flags.target : undefined;
  const workspace = path.resolve(process.cwd(), explicitTarget ?? (await mkdtemp(path.join(tmpdir(), `agentbase-pattern-${pattern.id}-`))));
  const keep = Boolean(explicitTarget) || !parsed.flags.discard;
  try {
    await scaffoldReferencePattern(pattern, workspace, true);
    const runOutput = await captureCliOutput((io) => commandRun([defaultPatternPrompt(pattern.id), "--mock", "--cwd", workspace], io));
    const runId = parseRunId(runOutput);
    const evalFile = path.join(workspace, ".agentbase", "evals", `${pattern.id}.yaml`);
    const evalOutput = await captureCliOutput((io) => commandEval(["run", "--suite", evalFile, "--run", runId, "--cwd", workspace], io));
    const evalReport = JSON.parse(evalOutput);
    const report: ReferencePatternRunReport = {
      ok: Boolean(evalReport && typeof evalReport === "object" && "failed" in evalReport && evalReport.failed === 0),
      patternId: pattern.id,
      title: pattern.title,
      workspace,
      prompt: defaultPatternPrompt(pattern.id),
      runId,
      reportFile: path.join(workspace, ".agentbase", "pattern-runs", `${pattern.id}-${runId}.json`),
      eval: evalReport,
      kept: keep
    };
    await mkdir(path.dirname(report.reportFile), { recursive: true });
    await writeFile(report.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!report.ok) {
      throw new Error(`Pattern ${pattern.id} failed eval gate.`);
    }
    return report;
  } finally {
    if (!keep) {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

async function captureCliOutput(operation: (io: CliIo) => Promise<void>): Promise<string> {
  const output: string[] = [];
  await operation({
    stdout: (message) => output.push(message),
    stderr: (message) => output.push(message)
  });
  return output.join("\n");
}

function parseRunId(output: string): string {
  const match = output.match(/Run \w+: (run_[A-Za-z0-9_-]+)/);
  if (!match) {
    throw new Error(`Could not parse pattern run id from:\n${output}`);
  }
  return match[1];
}

async function scaffoldReferencePattern(pattern: ReferencePattern, targetDir: string, force: boolean): Promise<void> {
  await mkdir(path.join(targetDir, ".agentbase", "evals"), { recursive: true });
  await mkdir(path.join(targetDir, "src"), { recursive: true });
  await cp(patternFixtureDir(pattern), targetDir, { recursive: true, force, errorOnExist: force });

  const configFile = path.join(targetDir, ".agentbase", "config.json");
  let config: AgentBaseConfig;
  try {
    config = await loadConfig(targetDir);
  } catch {
    config = defaultConfig(path.basename(targetDir));
  }
  let nextConfig = patchConfig(config, { provider: { type: "mock", model: "mock/repo-analyst" } });
  for (const toolset of pattern.requiredToolsets) {
    nextConfig = enableToolset(nextConfig, toolset);
  }
  await writeFile(configFile, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  const agentText = await readFile(patternAgentFile(pattern), "utf8");
  const evalText = await readFile(patternEvalFile(pattern), "utf8");
  await writePatternFile(path.join(targetDir, ".agentbase", "agent.json"), agentText, force);
  await writePatternFile(path.join(targetDir, ".agentbase", "evals", `${pattern.id}.yaml`), evalText, force);
  await writePatternFile(
    path.join(targetDir, "AGENTBASE_PATTERN.md"),
    [
      `# ${pattern.title}`,
      "",
      pattern.description,
      "",
      "```bash",
      `pnpm agentbase run "${defaultPatternPrompt(pattern.id)}" --mock --cwd ${targetDir}`,
      `pnpm agentbase patterns eval ${pattern.id} --cwd ${targetDir} --run <run-id>`,
      "```",
      ""
    ].join("\n"),
    force
  );
}

async function writePatternFile(file: string, value: string, force: boolean): Promise<void> {
  if (force) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value.endsWith("\n") ? value : `${value}\n`, "utf8");
    return;
  }
  await writeTextIfAbsent(file, value.endsWith("\n") ? value : `${value}\n`);
}

async function loadTools(cwd: string, config: AgentBaseConfig, platform?: SqlitePlatformStore): Promise<Tool[]> {
  const tools: Tool[] = [];

  for (const name of enabledToolsets(config)) {
    if (name === "@agentbase/tools-fs") {
      tools.push(...createFsTools());
    } else if (name === "@agentbase/tools-shell") {
      tools.push(createShellTool());
    } else if (name === "@agentbase/tools-git") {
      tools.push(...createGitTools());
    } else if (name === "@agentbase/tools-web") {
      tools.push(...createWebTools({ searchProvider: loadSearchProvider(config) }));
    } else if (name === "@agentbase/tools-http") {
      tools.push(...createHttpTools({ ...(config.http ?? {}), artifactStore: loadArtifactStore(cwd, config, platform) }));
    } else if (name === "@agentbase/tools-browser") {
      tools.push(...createBrowserTools(config.browser ?? { mode: "managed", headless: true }));
    } else if (name === "@agentbase/tools-database") {
      tools.push(...createDatabaseTools({ connections: config.database?.connections ?? [] }));
    } else if (name === "@agentbase/code-index") {
      const store = platform ?? loadPlatformStore(cwd, config);
      tools.push(...createCodeIndexTools({ store, maxFiles: config.codeIndex?.maxFiles }));
    } else if (name === "@agentbase/mcp") {
      for (const server of config.mcp?.servers ?? []) {
        tools.push(...(await loadMcpServerTools(server)));
      }
    } else {
      throw new Error(`Unsupported tool package: ${name}`);
    }
  }

  tools.push(createMaterializeRefTool(loadArtifactStore(cwd, config, platform)));
  if (config.memory?.enabled) {
    tools.push(...createMemoryTools(loadMemoryStore(cwd, config, platform)));
  }
  return tools;
}

function loadSearchProvider(config: AgentBaseConfig) {
  if (config.search?.type === "http" && config.search.endpoint) {
    return createHttpSearchProvider({
      endpoint: config.search.endpoint,
      apiKeyEnv: config.search.apiKeyEnv
    });
  }

  if (config.search?.type === "static") {
    return createStaticSearchProvider(config.search.results ?? []);
  }

  return createStaticSearchProvider([]);
}

function csvFlag(value: string | boolean | undefined): string[] | undefined {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
}

function numberFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function valueFlag(...values: Array<string | boolean | undefined>): string | boolean | undefined {
  return values.find((value) => value !== undefined);
}

function cliToolContext(cwd: string) {
  return {
    runId: "cli",
    workspaceRoot: cwd,
    signal: new AbortController().signal,
    policy: { name: "trusted" as const },
    env: process.env,
    trace: {
      async write(input: { type: string; data?: Record<string, unknown> }) {
        return { id: createId("evt"), runId: "cli", ts: new Date().toISOString(), type: input.type, data: input.data ?? {} };
      }
    }
  };
}

function loadModelProvider(config: AgentBaseConfig, forceMock: boolean): ModelProvider {
  if (forceMock || config.provider.type === "mock") {
    return createMockModelProvider();
  }

  if (!config.provider.model) {
    throw new Error(`Provider ${config.provider.type} requires provider.model in .agentbase/config.json`);
  }

  if (config.provider.type === "openai-compatible") {
    return createOpenAICompatibleProvider({
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
      apiKeyEnv: config.provider.apiKeyEnv,
      name: "openai-compatible"
    });
  }

  if (config.provider.type === "litellm") {
    return createLiteLLMProvider({
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
      apiKeyEnv: config.provider.apiKeyEnv,
      teamId: config.provider.teamId
    });
  }
  if (config.provider.type === "ollama") {
    return createOllamaProvider({
      baseUrl: config.provider.baseUrl,
      model: config.provider.model
    });
  }

  return createMockModelProvider();
}

function loadArtifactStore(cwd: string, config: AgentBaseConfig, platform?: SqlitePlatformStore): ArtifactStore {
  if (platform) {
    return platform;
  }
  return new FileArtifactStore({ dir: path.resolve(cwd, config.stores?.artifactsDir ?? ".agentbase/artifacts") });
}

function loadMemoryStore(cwd: string, config: AgentBaseConfig, platform?: SqlitePlatformStore): MemoryStore {
  if (platform) {
    return platform.asMemoryStore();
  }
  return new JsonMemoryStore({ file: path.resolve(cwd, config.stores?.memoryFile ?? ".agentbase/memory/memory.json") });
}

function loadMemoryProposalStore(cwd: string, config: AgentBaseConfig, store: MemoryStore, platform?: SqlitePlatformStore): MemoryProposalStore {
  if (platform) {
    return platform;
  }
  const memoryFile = path.resolve(cwd, config.stores?.memoryFile ?? ".agentbase/memory/memory.json");
  return new JsonMemoryProposalStore({ file: path.join(path.dirname(memoryFile), "proposals.json"), memoryStore: store });
}

function loadContextManager(cwd: string, config: AgentBaseConfig, platform: SqlitePlatformStore | undefined, artifacts: ArtifactStore) {
  const repoWiki = platform ? undefined : loadWiki(cwd, config);
  return createDefaultContextManager({
    memory: config.memory?.enabled ? loadMemoryStore(cwd, config, platform) : undefined,
    wiki: {
      query(query, options) {
        return platform ? platform.query(query, options) : repoWiki!.query(query, options?.limit ?? 6) as never;
      }
    },
    codeIndex: platform,
    artifacts,
    maxContextTokens: Number(config.limits.maxContextTokens ?? 24_000)
  });
}

function loadWiki(cwd: string, config: AgentBaseConfig): RepoWiki {
  return new RepoWiki({
    workspaceRoot: path.resolve(cwd, config.workspaceRoot),
    dir: path.resolve(cwd, config.stores?.wikiDir ?? ".agentbase/wiki"),
    memory: config.memory?.enabled ? new JsonMemoryStore({ file: path.resolve(cwd, config.stores?.memoryFile ?? ".agentbase/memory/memory.json") }) : undefined
  });
}

async function loadWorkflowSpec(cwd: string, file: string): Promise<WorkflowSpec> {
  const workflowFile = path.resolve(cwd, file);
  if (!workflowFile.endsWith(".json")) {
    throw new Error("Workflow files currently support JSON. Use --workflow workflow.json");
  }
  const workflow = JSON.parse(await readFile(workflowFile, "utf8")) as WorkflowSpec;
  validateWorkflowSpec(workflow);
  return workflow;
}

function defaultWorkflow(input: string): WorkflowSpec {
  if (!input) {
    throw new Error("Missing task. Usage: agentbase team run <task> [--workflow <file>]");
  }
  return {
    name: "default-team",
    mode: "crew",
    agents: defaultAgentSpecs(),
    tasks: [
      { id: "plan", input, agent: "planner" },
      { id: "research", input, agent: "researcher", dependsOn: ["plan"] },
      { id: "execute", input, agent: "coder", dependsOn: ["research"] },
      { id: "review", input, agent: "critic", dependsOn: ["execute"] }
    ]
  };
}

function validateWorkflowSpec(workflow: WorkflowSpec): void {
  const issues: string[] = [];
  if (!workflow.name) issues.push("workflow.name is required");
  if (!Array.isArray(workflow.agents) || workflow.agents.length === 0) issues.push("workflow.agents must include at least one agent");
  if (!Array.isArray(workflow.tasks) || workflow.tasks.length === 0) issues.push("workflow.tasks must include at least one task");
  const taskIds = new Set(workflow.tasks?.map((task) => task.id) ?? []);
  for (const task of workflow.tasks ?? []) {
    if (!task.id) issues.push("workflow.tasks[].id is required");
    if (!task.input) issues.push(`workflow task ${task.id ?? "<unnamed>"} requires input`);
    for (const dependency of task.dependsOn ?? []) {
      if (!taskIds.has(dependency)) issues.push(`workflow task ${task.id} depends on unknown task ${dependency}`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Invalid workflow:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  }
}

function loadPlatformStore(cwd: string, config: AgentBaseConfig): SqlitePlatformStore {
  return new SqlitePlatformStore({ file: sqliteFileFor(cwd, config) });
}

function sqliteFileFor(cwd: string, config: AgentBaseConfig): string {
  return path.resolve(cwd, config.stores?.sqliteFile ?? ".agentbase/agentbase.sqlite");
}

function isSqliteConfig(config: AgentBaseConfig): boolean {
  return config.trace.type !== "jsonl";
}

async function recordGovernanceEvent(cwd: string, config: AgentBaseConfig, type: string, data: Record<string, unknown>, actor: string): Promise<void> {
  if (!isSqliteConfig(config)) {
    return;
  }
  const platform = loadPlatformStore(cwd, config);
  try {
    const event = {
      id: createId("evt"),
      runId: "governance",
      type,
      ts: new Date().toISOString(),
      data
    };
    await platform.write(event);
    await platform.writeAudit({ action: type, target: ".agentbase/config.json", actor, metadata: data });
  } finally {
    await platform.close();
  }
}

function nonClosingTraceStore(store: SqlitePlatformStore): TraceStore {
  return {
    write(event: RuntimeEvent) {
      return store.write(event);
    }
  };
}

function conformanceCheck(name: string, ok: boolean, message: string): { name: string; ok: boolean; message: string } {
  return { name, ok, message };
}

function hasEvent(events: RuntimeEvent[], type: string): boolean {
  return events.some((event) => event.type === type);
}

function eventHasToolEnvelope(event: RuntimeEvent): boolean {
  const data = event.data;
  if (!isRecord(data)) return false;
  return (
    (typeof data.summary === "string" && typeof data.preview === "string" && Array.isArray(data.artifacts) && isRecord(data.metadata)) ||
    (typeof data.outputPreview === "string" && isRecord(data.metadata))
  );
}

function hasToolResultEnvelope(events: RuntimeEvent[]): boolean {
  const completedIds = events
    .filter((event) => event.type === "tool.completed")
    .map((event) => (isRecord(event.data) && typeof event.data.id === "string" ? event.data.id : undefined))
    .filter((id): id is string => Boolean(id));
  if (completedIds.length === 0) return true;
  const artifactEvents = events.filter((event) => event.type === "artifact.created");
  return completedIds.every((id) =>
    artifactEvents.some((event) => {
      if (!eventHasToolEnvelope(event)) return false;
      return isRecord(event.data) && event.data.toolCallId === id;
    })
  );
}

function hasApprovalCheckpointContract(events: RuntimeEvent[]): boolean {
  if (!hasEvent(events, "approval.required")) return true;
  return events.some((event) => {
    if (event.type !== "run.checkpoint" || !isRecord(event.data)) return false;
    return isRunState(event.data.state) && Array.isArray(event.data.pendingToolCalls) && Array.isArray(event.data.completedToolCallIds);
  });
}

function hasCheckpointPhaseContract(events: RuntimeEvent[]): boolean {
  const checkpoints = events.filter((event) => event.type === "run.checkpoint");
  if (checkpoints.length === 0) return true;
  return checkpoints.every((event) => {
    const phase = String(event.data.phase ?? event.data.reason ?? "");
    return ["context_prepared", "model_completed", "tools_completed", "waiting_approval"].includes(phase);
  });
}

function hasApprovalResumeOrDecision(events: RuntimeEvent[]): boolean {
  if (!hasEvent(events, "approval.required")) return true;
  return hasEvent(events, "run.waiting_approval") && (hasEvent(events, "approval.used") || hasEvent(events, "approval.approved") || hasEvent(events, "approval.denied"));
}

function hasWorkflowArtifactRefContract(events: RuntimeEvent[]): boolean {
  const workflowSteps = events.filter((event) => event.type === "workflow.step.completed");
  if (workflowSteps.length === 0) return true;
  return workflowSteps.every((event) => Array.isArray(event.data.artifactRefs));
}

function hasWorkflowCancellationContract(events: RuntimeEvent[]): boolean {
  if (!hasEvent(events, "workflow.cancel_requested")) return true;
  return hasEvent(events, "workflow.cancelled") && hasEvent(events, "run.cancelled");
}

function workflowChildRunIds(events: RuntimeEvent[]): string[] {
  return [...new Set(events.map((event) => (typeof event.data.childRunId === "string" ? event.data.childRunId : undefined)).filter((runId): runId is string => Boolean(runId)))];
}

async function childRunsHaveEvent(platform: SqlitePlatformStore, runIds: string[], type: string): Promise<boolean> {
  if (runIds.length === 0) {
    return false;
  }
  for (const runId of runIds) {
    const events = await platform.readRun(runId);
    if (!hasEvent(events, type)) {
      return false;
    }
  }
  return true;
}

async function childRunsSatisfyPolicyContract(platform: SqlitePlatformStore, runIds: string[]): Promise<boolean> {
  if (runIds.length === 0) {
    return false;
  }
  let sawToolExecution = false;
  for (const runId of runIds) {
    const events = await platform.readRun(runId);
    const ranTool = hasEvent(events, "tool.started") || hasEvent(events, "tool.completed") || hasEvent(events, "tool.failed");
    if (!ranTool) {
      continue;
    }
    sawToolExecution = true;
    if (!hasEvent(events, "policy.checked")) {
      return false;
    }
  }
  return sawToolExecution;
}

function hasExportPushAuditContract(audit: Awaited<ReturnType<SqlitePlatformStore["listAudit"]>>, config: AgentBaseConfig): boolean {
  if ((config.exports?.destinations ?? []).length === 0) {
    return true;
  }
  return audit.some((entry) => entry.action === "export.completed" || entry.action === "export.failed");
}

function hasEvolutionPromotionAuditContract(audit: Awaited<ReturnType<SqlitePlatformStore["listAudit"]>>): boolean {
  const promoted = audit.some((entry) => entry.action === "evolution.promoted");
  if (!promoted) {
    return true;
  }
  return audit.some((entry) => entry.action === "evolution.rolled_back");
}

function isPolicyName(value: unknown): value is PolicyName {
  return value === "read-only" || value === "workspace-write" || value === "developer" || value === "trusted";
}

async function loadReplayEvents(target: string, cwd: string, config: AgentBaseConfig, platform?: SqlitePlatformStore): Promise<RuntimeEvent[]> {
  if (target.endsWith(".jsonl")) {
    return loadReplayTrace(path.resolve(cwd, target));
  }
  if (platform) {
    return platform.readRun(target);
  }
  return loadReplayTrace(path.resolve(cwd, config.trace.dir, `${target}.jsonl`));
}

async function loadResumeState(platform: SqlitePlatformStore, runId: string): Promise<RunState | undefined> {
  const checkpoint = [...(await platform.readRun(runId))].reverse().find((event) => event.type === "run.checkpoint");
  const state = checkpoint?.data.state;
  if (!isRunState(state)) {
    return undefined;
  }
  return state;
}

function isRunState(value: unknown): value is RunState {
  if (!isRecord(value)) return false;
  return (
    typeof value.runId === "string" &&
    typeof value.input === "string" &&
    Array.isArray(value.messages) &&
    typeof value.steps === "number" &&
    typeof value.toolErrors === "number" &&
    Array.isArray(value.artifacts) &&
    typeof value.startedAt === "string" &&
    isRecord(value.metadata)
  );
}

async function loadExportEvents(cwd: string, config: AgentBaseConfig, platform: SqlitePlatformStore | undefined, runId?: string): Promise<RuntimeEvent[]> {
  if (runId) {
    return loadReplayEvents(runId, cwd, config, platform);
  }
  if (!platform) {
    throw new Error("Exporting all traces requires sqlite trace store. Provide --run <run-id> for jsonl trace directories.");
  }
  const runs = await platform.listRuns({ limit: 10_000 });
  const events: RuntimeEvent[] = [];
  for (const run of runs) {
    events.push(...(await platform.readRun(run.runId)));
  }
  return events;
}

function parseTraceExportFormat(value: string | boolean | undefined): TraceExportFormat {
  if (value === undefined || value === false || value === true) {
    return "jsonl";
  }
  if (value === "jsonl" || value === "otel" || value === "openinference" || value === "langfuse" || value === "phoenix") {
    return value;
  }
  throw new Error("Trace export format must be jsonl, otel, openinference, langfuse, or phoenix");
}

function findExportDestination(config: AgentBaseConfig, name: string): ExportDestinationConfig {
  const destination = (config.exports?.destinations ?? []).find((candidate) => candidate.name === name);
  if (!destination) {
    throw new Error(`Export destination not found: ${name}`);
  }
  return destination;
}

function exportFormatForDestination(destination: ExportDestinationConfig): Exclude<TraceExportFormat, "jsonl"> {
  if (destination.format) {
    return destination.format;
  }
  if (destination.type === "langfuse") {
    return "langfuse";
  }
  if (destination.type === "phoenix") {
    return "phoenix";
  }
  return "openinference";
}

async function pushTraceExport(destination: ExportDestinationConfig, events: RuntimeEvent[]): Promise<{ status: number; bytes: number; format: string }> {
  const format = exportFormatForDestination(destination);
  const body = serializeTraceExport(events, format);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(destination.headers ?? {})
  };
  if (destination.apiKeyEnv && process.env[destination.apiKeyEnv]) {
    headers.authorization = `Bearer ${process.env[destination.apiKeyEnv]}`;
  }
  const response = await fetch(destination.url, { method: "POST", headers, body });
  if (!response.ok) {
    throw new Error(`Export push failed with HTTP ${response.status}`);
  }
  return { status: response.status, bytes: Buffer.byteLength(body), format };
}

async function loadAgent(cwd: string): Promise<Agent> {
  const file = path.join(cwd, ".agentbase", "agent.json");
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as Agent;
}

function defaultAgent(): Agent {
  return {
    name: "repo-analyst",
    instructions: "You are a careful repo analyst. Inspect files before answering. Prefer concise evidence-backed summaries.",
    defaultTools: ["list_files", "read_file", "search_files", "git_status"]
  };
}

async function writeJsonIfAbsent(file: string, value: unknown): Promise<void> {
  await writeTextIfAbsent(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextIfAbsent(file: string, value: string): Promise<void> {
  try {
    await readFile(file, "utf8");
  } catch {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value, "utf8");
  }
}

async function appendJsonArray(file: string, value: unknown): Promise<void> {
  let values: unknown[] = [];
  try {
    values = JSON.parse(await readFile(file, "utf8")) as unknown[];
  } catch {
    values = [];
  }
  values.push(value);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

async function writeJsonArray(file: string, values: unknown[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

async function readJsonArray(file: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function evolutionPromotionsFile(cwd: string, config: AgentBaseConfig): string {
  return path.resolve(cwd, ".agentbase/evolution/promotions.json");
}

async function loadEvolutionProposal(file: string, proposalId: string): Promise<EvolutionProposal> {
  const proposal = (await readJsonArray(file)).find((item) => isRecord(item) && item.id === proposalId) as EvolutionProposal | undefined;
  if (!proposal) {
    throw new Error(`Evolution proposal not found: ${proposalId}`);
  }
  return proposal;
}

async function saveEvolutionProposal(file: string, proposal: EvolutionProposal): Promise<void> {
  const proposals = await readJsonArray(file);
  const updated = proposals.map((item) => (isRecord(item) && item.id === proposal.id ? proposal : item));
  await writeJsonArray(file, updated);
}

async function promoteEvolutionProposal(cwd: string, config: AgentBaseConfig, proposal: EvolutionProposal): Promise<EvolutionPromotion> {
  const now = new Date().toISOString();
  if (proposal.kind === "memory") {
    return {
      id: createId("evoprom"),
      proposalId: proposal.id,
      kind: proposal.kind,
      status: "promoted",
      createdAt: now,
      promotedAt: now,
      metadata: { mode: "memory-note" }
    };
  }

  if (proposal.kind === "prompt") {
    const file = path.join(cwd, ".agentbase", "agent.json");
    const agent = await loadAgent(cwd);
    if (!proposal.patch) {
      throw new Error(`Prompt proposal ${proposal.id} requires patch text.`);
    }
    const snapshot = { instructions: agent.instructions };
    await writeFile(file, `${JSON.stringify({ ...agent, instructions: proposal.patch }, null, 2)}\n`, "utf8");
    return { id: createId("evoprom"), proposalId: proposal.id, kind: proposal.kind, status: "promoted", target: file, snapshot, createdAt: now, promotedAt: now };
  }

  if (proposal.kind === "policy") {
    const file = path.join(cwd, ".agentbase", "config.json");
    const nextPolicy = proposal.patch;
    if (!nextPolicy || !isPolicyName(nextPolicy)) {
      throw new Error(`Policy proposal ${proposal.id} requires a valid policy patch.`);
    }
    const snapshot = { policy: config.policy };
    const next = patchConfig(config, { policy: nextPolicy } as never);
    await writeConfig(cwd, next);
    return { id: createId("evoprom"), proposalId: proposal.id, kind: proposal.kind, status: "promoted", target: file, snapshot, createdAt: now, promotedAt: now };
  }

  if (proposal.kind === "tool" || proposal.kind === "skill") {
    const file = path.join(cwd, ".agentbase", "evolution", "skills", `${proposal.id}.md`);
    await mkdir(path.dirname(file), { recursive: true });
    const previous = await readFile(file, "utf8").catch(() => "");
    await writeFile(file, `${proposal.patch ?? proposal.rationale}\n`, "utf8");
    return { id: createId("evoprom"), proposalId: proposal.id, kind: proposal.kind, status: "promoted", target: file, snapshot: { content: previous }, createdAt: now, promotedAt: now };
  }

  throw new Error(`Unsupported evolution proposal kind: ${proposal.kind}`);
}

async function rollbackEvolutionPromotion(cwd: string, config: AgentBaseConfig, promotionId: string): Promise<EvolutionRollbackResult> {
  const file = evolutionPromotionsFile(cwd, config);
  const promotions = (await readJsonArray(file)) as EvolutionPromotion[];
  const promotion = promotions.find((item) => isRecord(item) && item.id === promotionId) as EvolutionPromotion | undefined;
  if (!promotion) {
    throw new Error(`Evolution promotion not found: ${promotionId}`);
  }
  if (promotion.rolledBackAt) {
    return { promotion, restored: true, target: promotion.target };
  }

  let restored = false;
  if (promotion.kind === "prompt" && promotion.target && isRecord(promotion.snapshot) && typeof promotion.snapshot.instructions === "string") {
    const agent = await loadAgent(cwd);
    await writeFile(promotion.target, `${JSON.stringify({ ...agent, instructions: promotion.snapshot.instructions }, null, 2)}\n`, "utf8");
    restored = true;
  } else if (promotion.kind === "policy" && isRecord(promotion.snapshot) && isPolicyName(promotion.snapshot.policy)) {
    const next = patchConfig(config, { policy: promotion.snapshot.policy } as never);
    await writeConfig(cwd, next);
    restored = true;
  } else if ((promotion.kind === "tool" || promotion.kind === "skill") && promotion.target && isRecord(promotion.snapshot) && typeof promotion.snapshot.content === "string") {
    await writeFile(promotion.target, promotion.snapshot.content, "utf8");
    restored = true;
  } else if (promotion.kind === "memory") {
    restored = true;
  }

  const updatedPromotion: EvolutionPromotion = { ...promotion, status: "rolled_back", rolledBackAt: new Date().toISOString() };
  await writeJsonArray(
    file,
    promotions.map((item) => (isRecord(item) && item.id === promotionId ? updatedPromotion : item))
  );
  return { promotion: updatedPromotion, restored, target: promotion.target };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type ParsedFlags = {
  flags: Record<string, string | boolean>;
  positionals: string[];
};

function parseFlags(args: string[]): ParsedFlags {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { flags, positionals };
}

function formatEventData(data: Record<string, unknown>): string {
  const compact = JSON.stringify(data);
  return compact.length > 300 ? `${compact.slice(0, 300)}...` : compact;
}

function helpText(): string {
  return [
    "AgentBase v0.1",
    "",
    "Commands:",
    "  agentbase init [target]",
    "  agentbase run <prompt> --mock [--cwd <dir>] [--session <id>] [--resume <run-id>]",
    "  agentbase run cancel <run-id> [--cwd <dir>] [--reason <text>]",
    "  agentbase config show|doctor|set [--cwd <dir>]",
    "  agentbase policy show|set [--cwd <dir>]",
    "  agentbase provider show|set|test [--cwd <dir>]",
    "  agentbase patterns list|show|init|eval",
    "  agentbase store migrate|doctor|compact|prune [--cwd <dir>] [--days <n>] [--keep-last <n>] [--dry-run]",
    "  agentbase tools list|inspect|enable|disable [--cwd <dir>]",
    "  agentbase tools configure http|browser|database|mcp|code-index [--cwd <dir>]",
    "  agentbase tools mcp list|inspect [--cwd <dir>]",
    "  agentbase tools db test|schema [--cwd <dir>]",
    "  agentbase tools browser doctor [--cwd <dir>]",
    "  agentbase session list|show|pause|resume [--cwd <dir>]",
    "  agentbase approval list|show|approve|deny [--cwd <dir>]",
    "  agentbase memory list|search|add|promote|propose|proposals|review|promote-proposal [--cwd <dir>]",
    "  agentbase wiki index|query|open [--cwd <dir>]",
    "  agentbase replay run|diff <run-id-or-jsonl> [--cwd <dir>]",
    "  agentbase eval run [--suite <file>] [--run <run-id-or-jsonl>] [--output <text>] [--cwd <dir>]",
    "  agentbase evolve propose|test|promote|rollback [--suite <file>] [--run <run-id-or-jsonl>] [--cwd <dir>]",
    "  agentbase guardrail scan [text] [--run <run-id-or-jsonl>] [--cwd <dir>] [--json]",
    "  agentbase team run|cancel <task-or-workflow-run-id> [--workflow <file>] [--resume <workflow-run-id>] [--cwd <dir>]",
    "  agentbase studio [--cwd <dir>] [--once]",
    "  agentbase serve [--cwd <dir>] [--once]",
    "  agentbase export traces|push [--format jsonl|otel|openinference|langfuse|phoenix] [--target <name>] [--cwd <dir>] [--run <run-id>] [--out <file>]",
    "  agentbase backup create|restore [--cwd <dir>] [--out <file>]",
    "  agentbase conformance run [--cwd <dir>] [--run <run-id>]",
    "  agentbase trace list [--cwd <dir>]",
    "  agentbase trace show <run-id> [--cwd <dir>]"
  ].join("\n");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
