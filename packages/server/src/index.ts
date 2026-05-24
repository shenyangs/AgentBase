import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
import { serializeTraceExport, type TraceExportFormat } from "@agentbase/trace";

export type AgentBaseServer = {
  url: string;
  close(): Promise<void>;
};

export type AgentBaseServerOptions = {
  sqliteFile: string;
  configFile?: string;
  port?: number;
  token?: string;
  corsAllowlist?: string[];
};

export async function startAgentBaseServer(options: AgentBaseServerOptions): Promise<AgentBaseServer> {
  const store = new SqlitePlatformStore({ file: path.resolve(options.sqliteFile) });
  const server = createServer(async (req, res) => {
    try {
      applyCors(req, res, options.corsAllowlist);
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (!authorize(req, options.token)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/health") {
        sendJson(res, 200, { ok: true, store: store.file });
        return;
      }

      if (url.pathname === "/ready") {
        sendJson(res, 200, await store.doctor());
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
        await writeGovernance(store, "config.updated", { patch: redactSecrets(body) }, "server");
        sendJson(res, 200, { config: redactConfig(next), summary: summarizeConfig(next), issues: validateConfig(next) });
        return;
      }

      if (url.pathname === "/api/provider/test" && req.method === "POST") {
        const config = await requireConfig(options);
        const result = testProviderSettings(config, process.env);
        await writeGovernance(store, "provider.tested", { provider: config.provider.type, model: config.provider.model, ok: result.ok }, "server");
        sendJson(res, 200, result);
        return;
      }

      const toolsetEnable = url.pathname.match(/^\/api\/tools\/([^/]+)\/enable$/);
      if (toolsetEnable && req.method === "POST") {
        const config = await requireConfig(options);
        const name = normalizeToolsetName(decodeURIComponent(toolsetEnable[1]));
        const next = enableToolset(config, name);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(store, "toolset.enabled", { toolset: name }, "server");
        sendJson(res, 200, { config: redactConfig(next), summary: summarizeConfig(next) });
        return;
      }

      const toolsetDisable = url.pathname.match(/^\/api\/tools\/([^/]+)\/disable$/);
      if (toolsetDisable && req.method === "POST") {
        const config = await requireConfig(options);
        const name = normalizeToolsetName(decodeURIComponent(toolsetDisable[1]));
        const next = disableToolset(config, name);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(store, "toolset.disabled", { toolset: name }, "server");
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
        await writeGovernance(store, "toolset.configured", { toolset: name, config: redactSecrets(body) }, "server");
        sendJson(res, 200, { config: redactConfig(next), summary: summarizeConfig(next) });
        return;
      }

      if (url.pathname === "/api/policy" && req.method === "PATCH") {
        const body = await readJsonBody(req);
        const policy = stringField(body, "policy");
        const config = await requireConfig(options);
        const next = patchConfig(config, { policy } as never);
        await writeConfigFile(options.configFile!, next);
        await writeGovernance(store, "policy.updated", { previous: config.policy, policy }, "server");
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

      if (url.pathname === "/api/runs") {
        sendJson(res, 200, await store.listRuns({ limit: numberParam(url, "limit") ?? 100 }));
        return;
      }

      const runEvents = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (runEvents) {
        sendJson(res, 200, await store.readRun(decodeURIComponent(runEvents[1])));
        return;
      }

      const runContext = url.pathname.match(/^\/api\/runs\/([^/]+)\/context$/);
      if (runContext && req.method === "GET") {
        const events = await store.readRun(decodeURIComponent(runContext[1]));
        const contexts = events.filter((event) => event.type === "context.prepared");
        sendJson(res, 200, { runId: decodeURIComponent(runContext[1]), latest: contexts.at(-1) ?? null, contexts });
        return;
      }

      if (url.pathname === "/api/guardrail/scan" && req.method === "POST") {
        const body = await readJsonBody(req);
        const runId = stringField(body, "runId") ?? url.searchParams.get("runId") ?? undefined;
        const text = stringField(body, "text") ?? "";
        if (!runId && !text.trim()) {
          throw new Error("guardrail scan requires text or runId");
        }
        const results = runId ? scanRuntimeEvents(await store.readRun(runId), { source: "server.run" }) : scanTextForGuardrails(text, { source: "server.text" });
        const summary = summarizeGuardrailResults(results);
        const ts = new Date().toISOString();
        await store.write({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          runId: runId ?? "guardrail",
          type: "guardrail.completed",
          ts,
          data: {
            allowed: summary.allowed,
            count: summary.count,
            highestSeverity: summary.highestSeverity,
            categories: summary.categories,
            source: runId ? "run" : "text"
          }
        });
        await store.writeAudit({
          action: "guardrail.scanned",
          target: runId ?? "inline-text",
          runId,
          actor: "server",
          metadata: {
            allowed: summary.allowed,
            count: summary.count,
            highestSeverity: summary.highestSeverity,
            categories: summary.categories,
            source: runId ? "run" : "text"
          }
        });
        sendJson(res, 200, { ok: summary.allowed, runId, summary, results });
        return;
      }

      if (url.pathname === "/api/sessions") {
        sendJson(res, 200, await store.listSessions({ limit: numberParam(url, "limit") ?? 100 }));
        return;
      }

      if (url.pathname === "/api/approvals") {
        sendJson(
          res,
          200,
          await store.listApprovals({
            runId: url.searchParams.get("runId") ?? undefined,
            status: (url.searchParams.get("status") as never) ?? undefined,
            limit: numberParam(url, "limit") ?? 100
          })
        );
        return;
      }

      const approvalItem = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
      if (approvalItem && req.method === "GET") {
        sendJson(res, 200, (await store.getApproval(decodeURIComponent(approvalItem[1]))) ?? null);
        return;
      }

      const approvalDecision = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
      if (approvalDecision && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(
          res,
          200,
          await store.decideApproval({
            approvalId: decodeURIComponent(approvalDecision[1]),
            decision: approvalDecision[2] === "approve" ? "approved" : "denied",
            decidedBy: stringField(body, "actor") ?? "server",
            reason: stringField(body, "reason")
          })
        );
        return;
      }

      if (url.pathname === "/api/artifacts") {
        sendJson(
          res,
          200,
          await store.list({
            runId: url.searchParams.get("runId") ?? undefined,
            kind: url.searchParams.get("kind") ?? undefined,
            limit: numberParam(url, "limit") ?? 100
          })
        );
        return;
      }

      const artifactItem = url.pathname.match(/^\/api\/artifacts\/(.+)$/);
      if (artifactItem) {
        sendJson(res, 200, (await store.materialize(decodeURIComponent(artifactItem[1]))) ?? null);
        return;
      }

      if (url.pathname === "/api/memory") {
        const q = url.searchParams.get("q") ?? "";
        sendJson(res, 200, q ? await store.search(q, { limit: numberParam(url, "limit") ?? 20 }) : await store.listMemories({ limit: numberParam(url, "limit") ?? 50 }));
        return;
      }

      if (url.pathname === "/api/memory/proposals" && req.method === "GET") {
        sendJson(
          res,
          200,
          await store.listProposals({
            status: (url.searchParams.get("status") as never) ?? undefined,
            limit: numberParam(url, "limit") ?? 50
          })
        );
        return;
      }

      if (url.pathname === "/api/memory/proposals" && req.method === "POST") {
        const body = await readJsonBody(req);
        const memory = isRecord(body.memory) ? body.memory : body;
        sendJson(
          res,
          200,
          await store.propose({
            memory: {
              scope: (stringField(memory, "scope") ?? "project") as never,
              text: requiredString(memory, "text"),
              kind: stringField(memory, "kind") as never,
              tags: stringArrayField(memory, "tags"),
              source: stringField(memory, "source"),
              metadata: isRecord(memory.metadata) ? memory.metadata : undefined
            },
            rationale: stringField(body, "rationale") ?? "Proposed through Studio/server for reviewed memory promotion.",
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
          await store.reviewProposal(decodeURIComponent(proposalReview[1]), {
            decision: stringField(body, "decision") === "rejected" ? "rejected" : "approved",
            reviewedBy: stringField(body, "actor") ?? "server",
            reason: stringField(body, "reason")
          })
        );
        return;
      }

      const proposalTest = url.pathname.match(/^\/api\/memory\/proposals\/([^/]+)\/test$/);
      if (proposalTest && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await store.testProposal(decodeURIComponent(proposalTest[1]), Array.isArray(body.evalResults) ? (body.evalResults as never) : []));
        return;
      }

      const proposalPromotion = url.pathname.match(/^\/api\/memory\/proposals\/([^/]+)\/promote$/);
      if (proposalPromotion && req.method === "POST") {
        sendJson(res, 200, await store.promoteProposal(decodeURIComponent(proposalPromotion[1])));
        return;
      }

      const memoryPromotion = url.pathname.match(/^\/api\/memory\/([^/]+)\/promote$/);
      if (memoryPromotion && req.method === "POST") {
        sendJson(res, 200, await store.promote(decodeURIComponent(memoryPromotion[1])));
        return;
      }

      if (url.pathname === "/api/wiki") {
        const q = url.searchParams.get("q") ?? "";
        sendJson(res, 200, q ? await store.query(q, { limit: numberParam(url, "limit") ?? 20 }) : await store.listPages({ limit: numberParam(url, "limit") ?? 50 }));
        return;
      }

      if (url.pathname === "/api/evals") {
        sendJson(res, 200, await store.listEvalResults({ limit: numberParam(url, "limit") ?? 100 }));
        return;
      }

      if (url.pathname === "/api/replay/diff" && req.method === "GET") {
        const left = url.searchParams.get("left");
        const right = url.searchParams.get("right");
        if (!left || !right) throw new Error("replay diff requires left and right run ids");
        sendJson(res, 200, diffReplay(await store.readRun(left), await store.readRun(right)));
        return;
      }

      if (url.pathname === "/api/conformance/reports" && req.method === "GET") {
        sendJson(res, 200, await conformanceReports(store));
        return;
      }

      if (url.pathname === "/api/code/search") {
        const q = url.searchParams.get("q") ?? "";
        sendJson(res, 200, q ? await store.searchCodeSymbols(q, { limit: numberParam(url, "limit") ?? 50 }) : await store.listCodeFiles({ limit: numberParam(url, "limit") ?? 100 }));
        return;
      }

      if (url.pathname === "/api/audit") {
        sendJson(
          res,
          200,
          await store.listAudit({
            action: url.searchParams.get("action") ?? undefined,
            runId: url.searchParams.get("runId") ?? undefined,
            limit: numberParam(url, "limit") ?? 100
          })
        );
        return;
      }

      if (url.pathname === "/api/store/doctor") {
        sendJson(res, 200, await store.doctor());
        return;
      }

      if (url.pathname === "/api/store/compact" && req.method === "POST") {
        await store.compact();
        await store.writeAudit({ action: "store.compacted", target: store.file, actor: "server" });
        sendJson(res, 200, { ok: true, store: store.file });
        return;
      }

      if (url.pathname === "/api/store/prune" && req.method === "POST") {
        const body = await readJsonBody(req);
        const report = await store.prune({
          before: stringField(body, "before"),
          olderThanDays: numberField(body, "olderThanDays"),
          keepLastRuns: numberField(body, "keepLastRuns"),
          dryRun: booleanField(body, "dryRun") ?? true
        });
        sendJson(res, 200, report);
        return;
      }

      if (url.pathname === "/api/store/backup" && req.method === "POST") {
        const body = await readJsonBody(req);
        const target = stringField(body, "out") ?? defaultBackupFile(store.file);
        await store.backupTo(target);
        await store.writeAudit({ action: "store.backup", target, actor: "server" });
        sendJson(res, 200, { ok: true, file: target });
        return;
      }

      if (url.pathname === "/api/export/traces") {
        const format = parseTraceExportFormat(url.searchParams.get("format") ?? undefined);
        const runId = url.searchParams.get("runId") ?? undefined;
        const events = runId ? await store.readRun(runId) : await readAllEvents(store);
        res.statusCode = 200;
        res.setHeader("content-type", format === "jsonl" ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8");
        res.end(serializeTraceExport(events, format));
        await store.writeAudit({ action: "export.traces", target: "/api/export/traces", runId, actor: "server", metadata: { format, eventCount: events.length } });
        return;
      }

      if (url.pathname === "/api/export/push" && req.method === "POST") {
        const body = await readJsonBody(req);
        const config = await requireConfig(options);
        const target = requiredString(body, "target");
        const runId = stringField(body, "runId");
        const destination = findExportDestination(config, target);
        const events = runId ? await store.readRun(runId) : await readAllEvents(store);
        try {
          const result = await pushTraceExport(destination, events);
          await store.write({ id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`, runId: runId ?? "export", type: "export.completed", ts: new Date().toISOString(), data: { target, destinationType: destination.type, status: result.status, eventCount: events.length } });
          await store.writeAudit({ action: "export.completed", target, runId, actor: "server", metadata: { destinationType: destination.type, status: result.status, eventCount: events.length } });
          sendJson(res, 200, { ok: true, target, ...result });
        } catch (error) {
          await store.write({ id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`, runId: runId ?? "export", type: "export.failed", ts: new Date().toISOString(), data: { target, destinationType: destination.type, error: error instanceof Error ? error.message : String(error), eventCount: events.length } });
          await store.writeAudit({ action: "export.failed", target, runId, actor: "server", metadata: { destinationType: destination.type, error: error instanceof Error ? error.message : String(error), eventCount: events.length } });
          throw error;
        }
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
          await store.close();
          error ? reject(error) : resolve();
        })
      )
  };
}

function authorize(req: IncomingMessage, token?: string): boolean {
  if (!token) {
    return true;
  }
  return req.headers.authorization === `Bearer ${token}`;
}

function numberParam(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowlist?: string[]): void {
  const origin = req.headers.origin;
  if (!origin) return;
  if (!allowlist || allowlist.length === 0 || allowlist.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  }
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

async function requireConfig(options: AgentBaseServerOptions): Promise<AgentBaseConfig> {
  if (!options.configFile) {
    throw new Error("Server was started without a configFile.");
  }
  return loadConfigFile(options.configFile);
}

function workspaceRootForConfig(configFile: string | undefined): string | undefined {
  return configFile ? path.dirname(path.dirname(path.resolve(configFile))) : undefined;
}

async function writeGovernance(store: SqlitePlatformStore, type: string, data: Record<string, unknown>, actor: string): Promise<void> {
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

function parseTraceExportFormat(value: string | undefined): TraceExportFormat {
  if (!value) return "jsonl";
  if (value === "jsonl" || value === "otel" || value === "openinference" || value === "langfuse" || value === "phoenix") {
    return value;
  }
  throw new Error("Trace export format must be jsonl, otel, openinference, langfuse, or phoenix");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(redactSecrets(payload)));
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, isSecretKey(key) ? "[REDACTED]" : redactSecrets(child)])
    );
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
