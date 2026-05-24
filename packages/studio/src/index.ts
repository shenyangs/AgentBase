import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  disableToolset,
  enableToolset,
  loadConfigFile,
  patchConfig,
  redactConfig,
  summarizeConfig,
  testProviderSettings,
  validateConfig,
  writeConfigFile,
  type AgentBaseConfig,
  type ExportDestinationConfig
} from "@agentbase/config";
import { scanRuntimeEvents, scanTextForGuardrails, summarizeGuardrailResults } from "@agentbase/guardrails";
import { describeReferencePattern, getReferencePattern, listPatternRunReports, loadReferencePatternCatalog } from "@agentbase/patterns";
import { diffReplay } from "@agentbase/replay";
import { SqlitePlatformStore } from "@agentbase/stores-sqlite";
import { JsonlTraceStore, serializeTraceExport, type TraceExportFormat } from "@agentbase/trace";

export type StudioServer = {
  url: string;
  close(): Promise<void>;
};

export type StudioServerOptions = {
  traceDir?: string;
  sqliteFile?: string;
  configFile?: string;
  port?: number;
  uiDist?: string;
};

const nodeRequire = createRequire(import.meta.url);

export async function startStudioServer(options: StudioServerOptions): Promise<StudioServer> {
  const sqlite = options.sqliteFile ? new SqlitePlatformStore({ file: path.resolve(options.sqliteFile) }) : undefined;
  const jsonl = sqlite ? undefined : new JsonlTraceStore({ dir: path.resolve(options.traceDir ?? ".agentbase/runs") });
  const uiDist = options.uiDist ? path.resolve(options.uiDist) : resolveStudioUiDist();
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && uiDist && !url.pathname.startsWith("/api/")) {
        const served = await serveStaticStudio(uiDist, url, res, Boolean(sqlite));
        if (served) {
          return;
        }
      }

      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(renderStudioHtml(Boolean(sqlite)));
        return;
      }

      if (url.pathname === "/api/runs") {
        sendJson(res, 200, sqlite ? await sqlite.listRuns({ limit: numberParam(url, "limit") ?? 100 }) : await jsonl!.listRuns());
        return;
      }

      const runEvents = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (runEvents) {
        sendJson(res, 200, sqlite ? await sqlite.readRun(decodeURIComponent(runEvents[1])) : await jsonl!.readRun(decodeURIComponent(runEvents[1])));
        return;
      }

      const runContext = url.pathname.match(/^\/api\/runs\/([^/]+)\/context$/);
      if (runContext && req.method === "GET") {
        const runId = decodeURIComponent(runContext[1]);
        const events = sqlite ? await sqlite.readRun(runId) : await jsonl!.readRun(runId);
        const contexts = events.filter((event) => event.type === "context.prepared");
        sendJson(res, 200, { runId, latest: contexts.at(-1) ?? null, contexts });
        return;
      }

      if (url.pathname === "/api/guardrail/scan" && req.method === "POST") {
        const body = await readJsonBody(req);
        const runId = stringField(body, "runId") ?? url.searchParams.get("runId") ?? undefined;
        const text = stringField(body, "text") ?? "";
        if (!runId && !text.trim()) {
          throw new Error("guardrail scan requires text or runId");
        }
        const events = runId ? (sqlite ? await sqlite.readRun(runId) : await jsonl!.readRun(runId)) : undefined;
        const results = events ? scanRuntimeEvents(events, { source: "studio.run" }) : scanTextForGuardrails(text, { source: "studio.text" });
        const summary = summarizeGuardrailResults(results);
        if (sqlite) {
          await sqlite.write({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            runId: runId ?? "guardrail",
            type: "guardrail.completed",
            ts: new Date().toISOString(),
            data: {
              allowed: summary.allowed,
              count: summary.count,
              highestSeverity: summary.highestSeverity,
              categories: summary.categories,
              source: runId ? "run" : "text"
            }
          });
          await sqlite.writeAudit({
            action: "guardrail.scanned",
            target: runId ?? "inline-text",
            runId,
            actor: "studio",
            metadata: {
              allowed: summary.allowed,
              count: summary.count,
              highestSeverity: summary.highestSeverity,
              categories: summary.categories,
              source: runId ? "run" : "text"
            }
          });
        }
        sendJson(res, 200, { ok: summary.allowed, runId, summary, results });
        return;
      }

      if (url.pathname === "/api/config" && req.method === "GET") {
        const config = await requireConfig(options);
        sendJson(res, 200, { config: redactConfig(config), summary: summarizeConfig(config), issues: validateConfig(config) });
        return;
      }

      if (url.pathname === "/api/config" && req.method === "PATCH") {
        const body = await readJsonBody(req);
        const current = await requireConfig(options);
        const next = patchConfig(current, (isRecord(body.patch) ? body.patch : body) as never);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(sqlite, "config.updated", { patch: redactSecrets(body) }, "studio");
        sendJson(res, 200, { config: redactConfig(next), summary: summarizeConfig(next), issues: validateConfig(next) });
        return;
      }

      if (url.pathname === "/api/provider/test" && req.method === "POST") {
        const config = await requireConfig(options);
        const result = testProviderSettings(config, process.env);
        await writeGovernance(sqlite, "provider.tested", { provider: config.provider.type, model: config.provider.model, ok: result.ok }, "studio");
        sendJson(res, 200, result);
        return;
      }

      const toolsetEnable = url.pathname.match(/^\/api\/tools\/([^/]+)\/enable$/);
      if (toolsetEnable && req.method === "POST") {
        const config = await requireConfig(options);
        const name = normalizeToolsetName(decodeURIComponent(toolsetEnable[1]));
        const next = enableToolset(config, name);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(sqlite, "toolset.enabled", { toolset: name }, "studio");
        sendJson(res, 200, { config: redactConfig(next), summary: summarizeConfig(next) });
        return;
      }

      const toolsetDisable = url.pathname.match(/^\/api\/tools\/([^/]+)\/disable$/);
      if (toolsetDisable && req.method === "POST") {
        const config = await requireConfig(options);
        const name = normalizeToolsetName(decodeURIComponent(toolsetDisable[1]));
        const next = disableToolset(config, name);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(sqlite, "toolset.disabled", { toolset: name }, "studio");
        sendJson(res, 200, { config: redactConfig(next), summary: summarizeConfig(next) });
        return;
      }

      const toolsetConfig = url.pathname.match(/^\/api\/tools\/([^/]+)\/config$/);
      if (toolsetConfig && req.method === "PATCH") {
        const body = await readJsonBody(req);
        const config = await requireConfig(options);
        const name = normalizeToolsetName(decodeURIComponent(toolsetConfig[1]));
        const next = enableToolset(patchConfig(config, toolsetPatch(name, body)), name);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(sqlite, "toolset.configured", { toolset: name, config: redactSecrets(body) }, "studio");
        sendJson(res, 200, { config: redactConfig(next), summary: summarizeConfig(next) });
        return;
      }

      if (url.pathname === "/api/policy" && req.method === "PATCH") {
        const body = await readJsonBody(req);
        const policy = stringField(body, "policy");
        const config = await requireConfig(options);
        const next = patchConfig(config, { policy } as never);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(sqlite, "policy.updated", { previous: config.policy, policy }, "studio");
        sendJson(res, 200, { policy: next.policy });
        return;
      }

      if (url.pathname === "/api/patterns" && req.method === "GET") {
        const catalog = await loadReferencePatternCatalog();
        const workspaceRoot = workspaceRootForConfig(options.configFile);
        const reports = workspaceRoot ? await listPatternRunReports(workspaceRoot) : [];
        sendJson(res, 200, { ...catalog, reports });
        return;
      }

      if (url.pathname === "/api/pattern-reports" && req.method === "GET") {
        const workspaceRoot = workspaceRootForConfig(options.configFile);
        sendJson(res, 200, workspaceRoot ? await listPatternRunReports(workspaceRoot) : []);
        return;
      }

      const patternItem = url.pathname.match(/^\/api\/patterns\/([^/]+)$/);
      if (patternItem && req.method === "GET") {
        const catalog = await loadReferencePatternCatalog();
        sendJson(res, 200, await describeReferencePattern(getReferencePattern(catalog, decodeURIComponent(patternItem[1]))));
        return;
      }

      if (!sqlite) {
        sendJson(res, 200, { name: "AgentBase Studio", mode: "jsonl", endpoints: ["/", "/api/runs", "/api/runs/:runId/events", "/api/patterns"] });
        return;
      }

      if (url.pathname === "/api/store/doctor") {
        sendJson(res, 200, await sqlite.doctor());
        return;
      }
      if (url.pathname === "/api/store/compact" && req.method === "POST") {
        await sqlite.compact();
        await sqlite.writeAudit({ action: "store.compacted", target: sqlite.file, actor: "studio" });
        sendJson(res, 200, { ok: true, store: sqlite.file });
        return;
      }
      if (url.pathname === "/api/store/prune" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(
          res,
          200,
          await sqlite.prune({
            before: stringField(body, "before"),
            olderThanDays: numberField(body, "olderThanDays"),
            keepLastRuns: numberField(body, "keepLastRuns"),
            dryRun: booleanField(body, "dryRun") ?? true
          })
        );
        return;
      }
      if (url.pathname === "/api/store/backup" && req.method === "POST") {
        const body = await readJsonBody(req);
        const target = stringField(body, "out") ?? defaultBackupFile(sqlite.file);
        await sqlite.backupTo(target);
        await sqlite.writeAudit({ action: "store.backup", target, actor: "studio" });
        sendJson(res, 200, { ok: true, file: target });
        return;
      }
      if (url.pathname === "/api/approvals") {
        sendJson(res, 200, await sqlite.listApprovals({ status: (url.searchParams.get("status") as never) ?? undefined, limit: numberParam(url, "limit") ?? 100 }));
        return;
      }
      const approvalDecision = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
      if (approvalDecision && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(
          res,
          200,
          await sqlite.decideApproval({
            approvalId: decodeURIComponent(approvalDecision[1]),
            decision: approvalDecision[2] === "approve" ? "approved" : "denied",
            decidedBy: stringField(body, "actor") ?? "studio",
            reason: stringField(body, "reason")
          })
        );
        return;
      }
      if (url.pathname === "/api/artifacts") {
        sendJson(res, 200, await sqlite.list({ runId: url.searchParams.get("runId") ?? undefined, limit: numberParam(url, "limit") ?? 100 }));
        return;
      }
      const artifactItem = url.pathname.match(/^\/api\/artifacts\/(.+)$/);
      if (artifactItem && req.method === "GET") {
        sendJson(res, 200, (await sqlite.materialize(decodeURIComponent(artifactItem[1]))) ?? null);
        return;
      }
      if (url.pathname === "/api/memory") {
        const q = url.searchParams.get("q") ?? "";
        sendJson(res, 200, q ? await sqlite.search(q, { limit: 50 }) : await sqlite.listMemories({ limit: 100 }));
        return;
      }
      if (url.pathname === "/api/memory/proposals" && req.method === "GET") {
        sendJson(res, 200, await sqlite.listProposals({ status: (url.searchParams.get("status") as never) ?? undefined, limit: numberParam(url, "limit") ?? 100 }));
        return;
      }
      if (url.pathname === "/api/memory/proposals" && req.method === "POST") {
        const body = await readJsonBody(req);
        const memory = isRecord(body.memory) ? body.memory : body;
        sendJson(
          res,
          200,
          await sqlite.propose({
            memory: {
              scope: (stringField(memory, "scope") ?? "project") as never,
              text: requiredString(memory, "text"),
              kind: stringField(memory, "kind") as never,
              tags: stringArrayField(memory, "tags"),
              source: stringField(memory, "source"),
              metadata: isRecord(memory.metadata) ? memory.metadata : undefined
            },
            rationale: stringField(body, "rationale") ?? "Proposed through Studio for reviewed memory promotion.",
            evidence: Array.isArray(body.evidence) ? (body.evidence as never) : undefined,
            metadata: isRecord(body.metadata) ? body.metadata : undefined
          })
        );
        return;
      }
      const proposalReview = url.pathname.match(/^\/api\/memory\/proposals\/([^/]+)\/review$/);
      if (proposalReview && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(
          res,
          200,
          await sqlite.reviewProposal(decodeURIComponent(proposalReview[1]), {
            decision: stringField(body, "decision") === "rejected" ? "rejected" : "approved",
            reviewedBy: stringField(body, "actor") ?? "studio",
            reason: stringField(body, "reason")
          })
        );
        return;
      }
      const proposalTest = url.pathname.match(/^\/api\/memory\/proposals\/([^/]+)\/test$/);
      if (proposalTest && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await sqlite.testProposal(decodeURIComponent(proposalTest[1]), Array.isArray(body.evalResults) ? (body.evalResults as never) : []));
        return;
      }
      const proposalPromotion = url.pathname.match(/^\/api\/memory\/proposals\/([^/]+)\/promote$/);
      if (proposalPromotion && req.method === "POST") {
        sendJson(res, 200, await sqlite.promoteProposal(decodeURIComponent(proposalPromotion[1])));
        return;
      }
      const memoryPromotion = url.pathname.match(/^\/api\/memory\/([^/]+)\/promote$/);
      if (memoryPromotion && req.method === "POST") {
        sendJson(res, 200, await sqlite.promote(decodeURIComponent(memoryPromotion[1])));
        return;
      }
      if (url.pathname === "/api/wiki") {
        const q = url.searchParams.get("q") ?? "";
        sendJson(res, 200, q ? await sqlite.query(q, { limit: 50 }) : await sqlite.listPages({ limit: 100 }));
        return;
      }
      if (url.pathname === "/api/evals") {
        sendJson(res, 200, await sqlite.listEvalResults({ limit: 100 }));
        return;
      }
      if (url.pathname === "/api/replay/diff" && req.method === "GET") {
        const left = url.searchParams.get("left");
        const right = url.searchParams.get("right");
        if (!left || !right) throw new Error("replay diff requires left and right run ids");
        sendJson(res, 200, diffReplay(await sqlite.readRun(left), await sqlite.readRun(right)));
        return;
      }
      if (url.pathname === "/api/conformance/reports" && req.method === "GET") {
        sendJson(res, 200, await conformanceReports(sqlite));
        return;
      }
      if (url.pathname === "/api/export/push" && req.method === "POST") {
        const body = await readJsonBody(req);
        const config = await requireConfig(options);
        const target = requiredString(body, "target");
        const runId = stringField(body, "runId");
        const destination = findExportDestination(config, target);
        const events = runId ? await sqlite.readRun(runId) : await readAllEvents(sqlite);
        try {
          const result = await pushTraceExport(destination, events);
          await sqlite.write({ id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`, runId: runId ?? "export", type: "export.completed", ts: new Date().toISOString(), data: { target, destinationType: destination.type, status: result.status, eventCount: events.length } });
          await sqlite.writeAudit({ action: "export.completed", target, runId, actor: "studio", metadata: { destinationType: destination.type, status: result.status, eventCount: events.length } });
          sendJson(res, 200, { ok: true, target, ...result });
        } catch (error) {
          await sqlite.write({ id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`, runId: runId ?? "export", type: "export.failed", ts: new Date().toISOString(), data: { target, destinationType: destination.type, error: error instanceof Error ? error.message : String(error), eventCount: events.length } });
          await sqlite.writeAudit({ action: "export.failed", target, runId, actor: "studio", metadata: { destinationType: destination.type, error: error instanceof Error ? error.message : String(error), eventCount: events.length } });
          throw error;
        }
        return;
      }
      if (url.pathname === "/api/audit") {
        sendJson(res, 200, await sqlite.listAudit({ limit: 100 }));
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close(async (error) => {
          await sqlite?.close();
          error ? reject(error) : resolve();
        })
      )
  };
}

function resolveStudioUiDist(): string | undefined {
  try {
    const packageJson = nodeRequire.resolve("@agentbase/studio-ui/package.json");
    return path.join(path.dirname(packageJson), "dist");
  } catch {
    return undefined;
  }
}

async function serveStaticStudio(root: string, url: URL, res: ServerResponse, sqliteMode: boolean): Promise<boolean> {
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`) && resolved !== path.resolve(root, "index.html")) {
    sendJson(res, 403, { error: "forbidden" });
    return true;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return false;
    let body = await readFile(resolved);
    if (resolved.endsWith("index.html")) {
      body = Buffer.from(body.toString("utf8").replace("</head>", `<meta name="agentbase-store-mode" content="${sqliteMode ? "sqlite" : "jsonl"}" /></head>`));
    }
    res.statusCode = 200;
    res.setHeader("content-type", contentType(resolved));
    res.end(body);
    return true;
  } catch {
    if (url.pathname !== "/") return false;
    return false;
  }
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function numberParam(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(redactSecrets(payload)));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = stringField(value, key);
  if (!field) {
    throw new Error(`${key} is required.`);
  }
  return field;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] | undefined {
  const field = value[key];
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string") : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  const parsed = typeof field === "number" ? field : typeof field === "string" ? Number(field) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function defaultBackupFile(sqliteFile: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(path.dirname(sqliteFile), "backups", `agentbase-${timestamp}.sqlite`);
}

async function requireConfig(options: StudioServerOptions): Promise<AgentBaseConfig> {
  if (!options.configFile) {
    throw new Error("Studio was started without a configFile.");
  }
  return loadConfigFile(options.configFile);
}

function workspaceRootForConfig(configFile: string | undefined): string | undefined {
  return configFile ? path.dirname(path.dirname(path.resolve(configFile))) : undefined;
}

async function writeGovernance(store: SqlitePlatformStore | undefined, type: string, data: Record<string, unknown>, actor: string): Promise<void> {
  if (!store) {
    throw new Error("Configuration mutations require SQLite studio mode.");
  }
  await store.write({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    runId: "governance",
    type,
    ts: new Date().toISOString(),
    data
  });
  await store.writeAudit({ action: type, target: ".agentbase/config.json", actor, metadata: data });
}

function normalizeToolsetName(name: string): string {
  const aliases: Record<string, string> = {
    fs: "@agentbase/tools-fs",
    shell: "@agentbase/tools-shell",
    git: "@agentbase/tools-git",
    web: "@agentbase/tools-web",
    http: "@agentbase/tools-http",
    browser: "@agentbase/tools-browser",
    database: "@agentbase/tools-database",
    mcp: "@agentbase/mcp",
    "code-index": "@agentbase/code-index"
  };
  return aliases[name] ?? name;
}

function toolsetPatch(toolset: string, body: Record<string, unknown>): Partial<AgentBaseConfig> {
  const config = isRecord(body.config) ? body.config : body;
  if (toolset === "@agentbase/tools-http") return { http: config as never };
  if (toolset === "@agentbase/tools-browser") return { browser: config as never };
  if (toolset === "@agentbase/tools-database") return { database: config as never };
  if (toolset === "@agentbase/mcp") return { mcp: config as never };
  if (toolset === "@agentbase/code-index") return { codeIndex: config as never };
  return {};
}

async function readAllEvents(store: SqlitePlatformStore) {
  const runs = await store.listRuns({ limit: 10_000 });
  const events = [];
  for (const run of runs) {
    events.push(...(await store.readRun(run.runId)));
  }
  return events;
}

async function conformanceReports(store: SqlitePlatformStore) {
  const events = await readAllEvents(store);
  return events
    .filter((event) => event.type === "conformance.completed")
    .sort((left, right) => right.ts.localeCompare(left.ts))
    .map((event) => ({ runId: event.runId, createdAt: event.ts, ...event.data }));
}

function findExportDestination(config: AgentBaseConfig, name: string): ExportDestinationConfig {
  const destination = (config.exports?.destinations ?? []).find((candidate) => candidate.name === name);
  if (!destination) {
    throw new Error(`Export destination not found: ${name}`);
  }
  return destination;
}

function exportFormatForDestination(destination: ExportDestinationConfig): Exclude<TraceExportFormat, "jsonl"> {
  if (destination.format) return destination.format;
  if (destination.type === "langfuse") return "langfuse";
  if (destination.type === "phoenix") return "phoenix";
  return "openinference";
}

async function pushTraceExport(destination: ExportDestinationConfig, events: Awaited<ReturnType<typeof readAllEvents>>): Promise<{ status: number; bytes: number; format: string }> {
  const format = exportFormatForDestination(destination);
  const body = serializeTraceExport(events, format);
  const headers: Record<string, string> = { "content-type": "application/json", ...(destination.headers ?? {}) };
  if (destination.apiKeyEnv && process.env[destination.apiKeyEnv]) {
    headers.authorization = `Bearer ${process.env[destination.apiKeyEnv]}`;
  }
  const response = await fetch(destination.url, { method: "POST", headers, body });
  if (!response.ok) {
    throw new Error(`Export push failed with HTTP ${response.status}`);
  }
  return { status: response.status, bytes: Buffer.byteLength(body), format };
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, isSecretKey(key) ? "[REDACTED]" : redactSecrets(child)]));
  }
  if (typeof value === "string") {
    return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]").replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]");
  }
  return value;
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  if (normalized === "secretexfiltration") {
    return false;
  }
  return normalized === "authorization" || normalized === "apikey" || normalized === "token" || normalized.includes("secret") || normalized.includes("password") || normalized === "cookie";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renderStudioHtml(sqliteMode: boolean): string {
  const sqliteTabs = sqliteMode
    ? `
      <button data-endpoint="/api/approvals">Approvals</button>
      <button data-endpoint="/api/memory">Memory</button>
      <button data-endpoint="/api/memory/proposals">Memory Gate</button>
      <button data-endpoint="/api/wiki">Wiki</button>
      <button data-endpoint="/api/evals">Evals</button>
      <button data-endpoint="/api/patterns">Patterns</button>
      <button data-endpoint="/api/artifacts">Artifacts</button>
      <button data-endpoint="/api/audit">Audit</button>
      <button data-endpoint="/api/config">Settings</button>
      <button data-endpoint="/api/store/doctor">Store</button>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentBase Studio</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101214; color: #edf0f2; }
    body { margin: 0; display: grid; grid-template-columns: 340px 1fr; min-height: 100vh; }
    aside { border-right: 1px solid #2a2f35; padding: 16px; overflow: auto; background: #15181b; }
    main { padding: 16px; overflow: auto; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    h2 { font-size: 15px; margin: 20px 0 8px; color: #c9d1d9; }
    button { width: 100%; text-align: left; border: 1px solid #30363d; background: #1c2126; color: inherit; padding: 10px; margin-bottom: 8px; border-radius: 6px; cursor: pointer; }
    button:hover { background: #252b31; }
    pre { white-space: pre-wrap; word-break: break-word; background: #15181b; border: 1px solid #30363d; border-radius: 6px; padding: 12px; }
    .muted { color: #9aa4ad; font-size: 12px; }
  </style>
</head>
<body>
  <aside>
    <h1>AgentBase Studio</h1>
    <div class="muted">${sqliteMode ? "SQLite platform store" : "JSONL trace mode"}</div>
    <h2>Runs</h2>
    <div id="runs" class="muted">Loading runs...</div>
    <h2>Platform</h2>
    ${sqliteTabs}
  </aside>
  <main><pre id="details">Select a run or platform view</pre></main>
  <script>
    const details = document.getElementById('details');
    async function fetchJson(endpoint) {
      const value = await fetch(endpoint).then((response) => response.json());
      details.textContent = JSON.stringify(value, null, 2);
      return value;
    }
    async function loadRuns() {
      const runs = await fetch('/api/runs').then((r) => r.json());
      const target = document.getElementById('runs');
      target.innerHTML = runs.length ? '' : 'No runs found';
      for (const run of runs) {
        const button = document.createElement('button');
        button.textContent = run.runId + '  ' + run.status + '  ' + (run.agent || '');
        button.onclick = () => fetchJson('/api/runs/' + encodeURIComponent(run.runId) + '/events');
        target.appendChild(button);
      }
    }
    for (const button of document.querySelectorAll('[data-endpoint]')) {
      button.onclick = () => fetchJson(button.dataset.endpoint);
    }
    loadRuns().catch((error) => { document.getElementById('runs').textContent = String(error); });
  </script>
</body>
</html>`;
}
