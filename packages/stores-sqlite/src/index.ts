import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  createId,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalStatus,
  type ApprovalStore,
  type ArtifactRecord,
  type ArtifactStore,
  type AuditRecord,
  type AuditStore,
  type CodeIndexFileRecord,
  type CodeIndexStore,
  type CodeReferenceRecord,
  type CodeSymbolRecord,
  type EvalResult,
  type EvalStore,
  type MaterializedRef,
  type MemoryBlock,
  type MemoryProposal,
  type MemoryProposalStatus,
  type MemoryProposalStore,
  type MemoryScope,
  type MemoryStore,
  type RunRecord,
  type RunStore,
  type RuntimeEvent,
  type SessionRecord,
  type SessionStore,
  type TraceStore,
  type WikiPageRecord,
  type WikiStore
} from "@agentbase/core";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
const CURRENT_SCHEMA_VERSION = 4;

export type StoreRetentionOptions = {
  before?: string | Date;
  olderThanDays?: number;
  keepLastRuns?: number;
  dryRun?: boolean;
};

export type StoreRetentionReport = {
  dryRun: boolean;
  cutoff?: string;
  keepLastRuns: number;
  runIds: string[];
  deleted: {
    runs: number;
    events: number;
    artifacts: number;
    approvals: number;
    audit: number;
    sessionsUpdated: number;
  };
};

export class SqlitePlatformStore implements TraceStore, ArtifactStore, WikiStore, EvalStore, RunStore, SessionStore, CodeIndexStore, ApprovalStore, AuditStore, MemoryProposalStore {
  readonly file: string;
  readonly db: DatabaseSyncType;
  private ftsEnabled = false;

  constructor(options: { file: string }) {
    this.file = path.resolve(options.file);
    mkdirSyncForFile(this.file);
    this.db = new DatabaseSync(this.file);
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const versionRow = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
    const currentVersion = versionRow?.value ? Number(versionRow.value) : 0;
    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(`SQLite store schema version ${currentVersion} is newer than this AgentBase build supports (${CURRENT_SCHEMA_VERSION}). Upgrade AgentBase before opening this store.`);
    }

    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        agent TEXT,
        input TEXT,
        session_id TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        steps INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT NOT NULL,
        active_run_id TEXT,
        input TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        ts TEXT NOT NULL,
        data TEXT NOT NULL,
        UNIQUE(run_id, seq)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        ref TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        run_id TEXT,
        tool_call_id TEXT,
        tool_name TEXT,
        content TEXT NOT NULL,
        summary TEXT,
        preview TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_run_kind ON artifacts(run_id, kind);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        text TEXT NOT NULL,
        kind TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        score REAL,
        pinned INTEGER NOT NULL DEFAULT 0,
        promoted INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);

      CREATE TABLE IF NOT EXISTS memory_proposals (
        id TEXT PRIMARY KEY,
        memory TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '[]',
        eval_results TEXT NOT NULL DEFAULT '[]',
        reviewed_by TEXT,
        reviewed_at TEXT,
        review_reason TEXT,
        promoted_memory_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_proposals_status ON memory_proposals(status, updated_at);

      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        summary TEXT NOT NULL,
        links TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_path ON wiki_pages(path);

      CREATE TABLE IF NOT EXISTS eval_results (
        id TEXT NOT NULL,
        suite TEXT,
        passed INTEGER NOT NULL,
        score REAL NOT NULL,
        details TEXT NOT NULL,
        run_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (id, created_at)
      );

      CREATE TABLE IF NOT EXISTS code_files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        summary TEXT NOT NULL,
        language TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS code_symbols (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        column INTEGER,
        signature TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(name);
      CREATE INDEX IF NOT EXISTS idx_code_symbols_path ON code_symbols(path);
      CREATE TABLE IF NOT EXISTS code_references (
        symbol_id TEXT NOT NULL,
        path TEXT NOT NULL,
        line INTEGER NOT NULL,
        preview TEXT NOT NULL,
        PRIMARY KEY (symbol_id, path, line)
      );
      CREATE INDEX IF NOT EXISTS idx_code_references_symbol ON code_references(symbol_id);

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT,
        tool_call_id TEXT,
        tool_name TEXT,
        input TEXT,
        permissions TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT,
        decision_reason TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status, requested_at);
      CREATE INDEX IF NOT EXISTS idx_approval_run ON approval_requests(run_id);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        actor TEXT,
        action TEXT NOT NULL,
        target TEXT,
        run_id TEXT,
        session_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    `);

    this.ensureEventsAppendOnlySchema();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);
      CREATE INDEX IF NOT EXISTS idx_events_run_ts ON events(run_id, ts);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    `);

    this.enableFts();
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)")
      .run(String(CURRENT_SCHEMA_VERSION));
  }

  asMemoryStore(): MemoryStore {
    return {
      add: (memory) => this.add(memory),
      search: (query, options) => this.search(query, options),
      list: (options) => this.listMemories(options),
      promote: (id) => this.promote(id)
    };
  }

  async write(event: RuntimeEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO events (id, run_id, seq, type, ts, data)
         VALUES (?, ?, (SELECT coalesce(max(seq), 0) + 1 FROM events WHERE run_id = ?), ?, ?, ?)`
      )
      .run(event.id, event.runId, event.runId, event.type, event.ts, stringify(event.data));

    if (event.type === "run.started") {
      await this.putRun({
        runId: event.runId,
        status: "running",
        agent: stringValue(event.data.agent),
        input: stringValue(event.data.input),
        sessionId: stringValue(event.data.sessionId),
        startedAt: event.ts,
        metadata: event.data
      });
    } else if (event.type === "run.resumed") {
      await this.updateRun(event.runId, {
        status: "running",
        metadata: event.data
      });
    } else if (event.type === "run.waiting_approval") {
      await this.updateRun(event.runId, {
        status: "waiting_approval",
        steps: numberValue(event.data.steps),
        metadata: event.data
      });
    } else if (event.type === "run.paused") {
      await this.updateRun(event.runId, {
        status: "paused",
        steps: numberValue(event.data.steps),
        metadata: event.data
      });
    } else if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
      await this.updateRun(event.runId, {
        status: event.type === "run.completed" ? "completed" : event.type === "run.cancelled" ? "cancelled" : "failed",
        completedAt: event.ts,
        steps: numberValue(event.data.steps),
        metadata: event.data
      });
    }
  }

  async readRun(runId: string): Promise<RuntimeEvent[]> {
    return this.db
      .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY seq ASC")
      .all(runId)
      .map(rowToEvent);
  }

  async exportJsonl(file: string, runId?: string): Promise<void> {
    const events = runId ? await this.readRun(runId) : this.db.prepare("SELECT * FROM events ORDER BY ts ASC, run_id ASC, seq ASC").all().map(rowToEvent);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }

  async backupTo(file: string): Promise<void> {
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    this.db.exec(`VACUUM INTO '${path.resolve(file).replaceAll("'", "''")}'`);
  }

  async compact(): Promise<void> {
    this.db.exec("PRAGMA optimize");
    this.db.exec("VACUUM");
  }

  async doctor(): Promise<{
    ok: boolean;
    schemaVersion: number;
    ftsEnabled: boolean;
    integrity: string[];
    foreignKeyViolations: number;
    sizeBytes: number;
    counts: Record<string, number>;
  }> {
    const versionRow = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
    const tables = ["runs", "sessions", "events", "artifacts", "memories", "memory_proposals", "wiki_pages", "eval_results", "code_files", "code_symbols", "code_references", "approval_requests", "audit_log"];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const row = this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number };
      counts[table] = row.count;
    }
    const integrity = this.db.prepare("PRAGMA integrity_check").all().map((row: any) => String(row.integrity_check ?? row[0] ?? "unknown"));
    const foreignKeyViolations = this.db.prepare("PRAGMA foreign_key_check").all().length;
    const pageCount = Number((this.db.prepare("PRAGMA page_count").get() as any)?.page_count ?? 0);
    const pageSize = Number((this.db.prepare("PRAGMA page_size").get() as any)?.page_size ?? 0);
    const schemaVersion = Number(versionRow?.value ?? 0);
    return {
      ok: schemaVersion === CURRENT_SCHEMA_VERSION && integrity.every((line) => line === "ok") && foreignKeyViolations === 0,
      schemaVersion,
      ftsEnabled: this.ftsEnabled,
      integrity,
      foreignKeyViolations,
      sizeBytes: pageCount * pageSize,
      counts
    };
  }

  async prune(options: StoreRetentionOptions = {}): Promise<StoreRetentionReport> {
    const keepLastRuns = Math.max(0, Math.floor(options.keepLastRuns ?? 100));
    const cutoff = retentionCutoff(options);
    const terminalRuns = this.db
      .prepare(
        `SELECT * FROM runs
         WHERE status IN ('completed', 'failed', 'cancelled')
         ORDER BY coalesce(completed_at, started_at) DESC, started_at DESC`
      )
      .all()
      .map(rowToRun);
    const retained = new Set(terminalRuns.slice(0, keepLastRuns).map((run) => run.runId));
    const runIds = terminalRuns
      .filter((run) => !retained.has(run.runId))
      .filter((run) => !cutoff || (run.completedAt ?? run.startedAt) < cutoff)
      .map((run) => run.runId);
    const report: StoreRetentionReport = {
      dryRun: Boolean(options.dryRun),
      cutoff,
      keepLastRuns,
      runIds,
      deleted: {
        runs: runIds.length,
        events: countByRunIds(this.db, "events", runIds),
        artifacts: countByRunIds(this.db, "artifacts", runIds),
        approvals: countByRunIds(this.db, "approval_requests", runIds),
        audit: countByRunIds(this.db, "audit_log", runIds),
        sessionsUpdated: countSessionsByActiveRunIds(this.db, runIds)
      }
    };
    if (options.dryRun || runIds.length === 0) {
      return report;
    }

    this.db.exec("BEGIN");
    try {
      const deleteEvents = this.db.prepare("DELETE FROM events WHERE run_id = ?");
      const deleteArtifacts = this.db.prepare("DELETE FROM artifacts WHERE run_id = ?");
      const deleteApprovals = this.db.prepare("DELETE FROM approval_requests WHERE run_id = ?");
      const deleteAudit = this.db.prepare("DELETE FROM audit_log WHERE run_id = ?");
      const updateSessions = this.db.prepare("UPDATE sessions SET active_run_id = NULL, status = CASE WHEN status = 'active' THEN 'paused' ELSE status END, updated_at = ? WHERE active_run_id = ?");
      const deleteRun = this.db.prepare("DELETE FROM runs WHERE run_id = ?");
      const now = new Date().toISOString();
      for (const runId of runIds) {
        deleteEvents.run(runId);
        deleteArtifacts.run(runId);
        deleteApprovals.run(runId);
        deleteAudit.run(runId);
        updateSessions.run(now, runId);
        deleteRun.run(runId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    await this.writeAudit({
      action: "store.pruned",
      target: this.file,
      actor: "system",
      metadata: {
        cutoff,
        keepLastRuns,
        deleted: report.deleted,
        runIds: runIds.slice(0, 100)
      }
    });
    return report;
  }

  async putRun(run: RunRecord): Promise<RunRecord> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runs (run_id, status, agent, input, session_id, started_at, completed_at, steps, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(run.runId, run.status, run.agent ?? null, run.input ?? null, run.sessionId ?? null, run.startedAt, run.completedAt ?? null, run.steps ?? null, stringify(run.metadata ?? {}));
    return run;
  }

  async updateRun(runId: string, patch: Partial<Omit<RunRecord, "runId" | "startedAt">>): Promise<RunRecord> {
    const existing = (await this.getRun(runId)) ?? {
      runId,
      status: "running",
      startedAt: new Date().toISOString(),
      metadata: {}
    };
    const next: RunRecord = { ...existing, ...patch, metadata: { ...(existing.metadata ?? {}), ...(patch.metadata ?? {}) } };
    return this.putRun(next);
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId);
    return row ? rowToRun(row) : undefined;
  }

  async listRuns(filter: { status?: RunRecord["status"]; sessionId?: string; limit?: number } = {}): Promise<RunRecord[]> {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY started_at DESC").all().map(rowToRun);
    return rows.filter((run) => (!filter.status || run.status === filter.status) && (!filter.sessionId || run.sessionId === filter.sessionId)).slice(0, filter.limit ?? rows.length);
  }

  async createSession(session: Omit<SessionRecord, "createdAt" | "updatedAt"> & Partial<Pick<SessionRecord, "createdAt" | "updatedAt">>): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const record: SessionRecord = { ...session, createdAt: session.createdAt ?? now, updatedAt: session.updatedAt ?? now };
    this.db
      .prepare("INSERT OR REPLACE INTO sessions (id, name, status, active_run_id, input, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.name ?? null, record.status, record.activeRunId ?? null, record.input ?? null, stringify(record.metadata ?? {}), record.createdAt, record.updatedAt);
    return record;
  }

  async updateSession(id: string, patch: Partial<Omit<SessionRecord, "id" | "createdAt">>): Promise<SessionRecord> {
    const existing = await this.getSession(id);
    if (!existing) {
      throw new Error(`Session not found: ${id}`);
    }
    return this.createSession({ ...existing, ...patch, updatedAt: new Date().toISOString(), metadata: { ...(existing.metadata ?? {}), ...(patch.metadata ?? {}) } });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? rowToSession(row) : undefined;
  }

  async listSessions(filter: { status?: SessionRecord["status"]; limit?: number } = {}): Promise<SessionRecord[]> {
    const rows = this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all().map(rowToSession);
    return rows.filter((session) => !filter.status || session.status === filter.status).slice(0, filter.limit ?? rows.length);
  }

  async put(record: Omit<ArtifactRecord, "createdAt"> & { createdAt?: string }): Promise<ArtifactRecord> {
    const stored: ArtifactRecord = { ...record, createdAt: record.createdAt ?? new Date().toISOString() };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts (ref, kind, run_id, tool_call_id, tool_name, content, summary, preview, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stored.ref,
        stored.kind,
        stored.runId ?? null,
        stored.toolCallId ?? null,
        stored.toolName ?? null,
        stringify(stored.content),
        stored.summary ?? null,
        stored.preview ?? null,
        stringify(stored.metadata ?? {}),
        stored.createdAt
      );
    return stored;
  }

  async get(ref: string): Promise<ArtifactRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE ref = ?").get(ref);
    return row ? rowToArtifact(row) : undefined;
  }

  async materialize(ref: string): Promise<MaterializedRef | undefined> {
    const record = await this.get(ref);
    return record ? { ref: record.ref, kind: record.kind, content: record.content, summary: record.summary, preview: record.preview, metadata: record.metadata } : undefined;
  }

  async list(filter: { runId?: string; kind?: string; limit?: number } = {}): Promise<ArtifactRecord[]> {
    const rows = this.db.prepare("SELECT * FROM artifacts ORDER BY created_at DESC").all().map(rowToArtifact);
    return rows.filter((artifact) => (!filter.runId || artifact.runId === filter.runId) && (!filter.kind || artifact.kind === filter.kind)).slice(0, filter.limit ?? rows.length);
  }

  async add(memory: Omit<MemoryBlock, "id" | "createdAt" | "updatedAt"> & Partial<Pick<MemoryBlock, "id" | "createdAt" | "updatedAt">>): Promise<MemoryBlock> {
    const now = new Date().toISOString();
    const block: MemoryBlock = {
      id: memory.id ?? createId("mem"),
      scope: memory.scope,
      text: memory.text,
      kind: memory.kind,
      tags: memory.tags ?? [],
      score: memory.score,
      pinned: memory.pinned ?? false,
      promoted: memory.promoted ?? false,
      source: memory.source,
      metadata: memory.metadata,
      createdAt: memory.createdAt ?? now,
      updatedAt: memory.updatedAt ?? now
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memories (id, scope, text, kind, tags, score, pinned, promoted, source, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        block.id,
        block.scope,
        block.text,
        block.kind ?? null,
        stringify(block.tags ?? []),
        block.score ?? null,
        block.pinned ? 1 : 0,
        block.promoted ? 1 : 0,
        block.source ?? null,
        stringify(block.metadata ?? {}),
        block.createdAt,
        block.updatedAt
      );
    this.syncMemoryFts(block);
    return block;
  }

  async search(query: string, options: { scopes?: MemoryScope[]; tags?: string[]; limit?: number } = {}): Promise<MemoryBlock[]> {
    const ftsQuery = toFtsQuery(query);
    if (this.ftsEnabled && ftsQuery) {
      try {
        const rows = this.db
          .prepare(
            `SELECT memories.* FROM memories
             JOIN memories_fts ON memories.id = memories_fts.id
             WHERE memories_fts MATCH ?
             ORDER BY bm25(memories_fts), memories.pinned DESC, memories.updated_at DESC
             LIMIT ?`
          )
          .all(ftsQuery, Math.max(options.limit ?? 20, 100))
          .map(rowToMemory);
        return rows
          .filter((memory) => !options.scopes || options.scopes.includes(memory.scope))
          .filter((memory) => !options.tags || options.tags.every((tag) => memory.tags?.includes(tag)))
          .slice(0, options.limit ?? 20);
      } catch {
        // Some SQLite builds have FTS5 tokenization quirks. Fall back to deterministic local scoring.
      }
    }
    const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
    const rows = await this.listMemories();
    return rows
      .filter((memory) => !options.scopes || options.scopes.includes(memory.scope))
      .filter((memory) => !options.tags || options.tags.every((tag) => memory.tags?.includes(tag)))
      .map((memory) => ({ memory, score: scoreMemory(memory, terms) }))
      .filter((hit) => terms.length === 0 || hit.score > 0 || hit.memory.pinned)
      .sort((a, b) => Number(b.memory.pinned) - Number(a.memory.pinned) || b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
      .slice(0, options.limit ?? 20)
      .map((hit) => hit.memory);
  }

  async listMemories(options: { scope?: MemoryScope; limit?: number } = {}): Promise<MemoryBlock[]> {
    const rows = this.db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(rowToMemory);
    return rows.filter((memory) => !options.scope || memory.scope === options.scope).slice(0, options.limit ?? rows.length);
  }

  async promote(id: string): Promise<MemoryBlock> {
    const memory = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    if (!memory) {
      throw new Error(`Memory not found: ${id}`);
    }
    const updated = { ...rowToMemory(memory), promoted: true, pinned: true, updatedAt: new Date().toISOString() };
    await this.add(updated);
    return updated;
  }

  async propose(proposal: Omit<MemoryProposal, "id" | "status" | "createdAt" | "updatedAt"> & Partial<Pick<MemoryProposal, "id" | "status" | "createdAt" | "updatedAt">>): Promise<MemoryProposal> {
    const now = new Date().toISOString();
    const record: MemoryProposal = {
      ...proposal,
      id: proposal.id ?? createId("memprop"),
      status: proposal.status ?? "proposed",
      evidence: proposal.evidence ?? [],
      evalResults: proposal.evalResults ?? [],
      createdAt: proposal.createdAt ?? now,
      updatedAt: proposal.updatedAt ?? now
    };
    await this.putMemoryProposal(record);
    await this.writeAudit({ action: "memory.proposed", target: record.id, actor: "system", metadata: { scope: record.memory.scope, kind: record.memory.kind, status: record.status } });
    return record;
  }

  async getProposal(id: string): Promise<MemoryProposal | undefined> {
    const row = this.db.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id);
    return row ? rowToMemoryProposal(row) : undefined;
  }

  async listProposals(filter: { status?: MemoryProposalStatus; limit?: number } = {}): Promise<MemoryProposal[]> {
    const rows = this.db.prepare("SELECT * FROM memory_proposals ORDER BY updated_at DESC").all().map(rowToMemoryProposal);
    return rows.filter((proposal) => !filter.status || proposal.status === filter.status).slice(0, filter.limit ?? rows.length);
  }

  async reviewProposal(id: string, review: { decision: "approved" | "rejected"; reviewedBy?: string; reason?: string }): Promise<MemoryProposal> {
    const proposal = await this.requireMemoryProposal(id);
    const now = new Date().toISOString();
    const updated: MemoryProposal = {
      ...proposal,
      status: review.decision === "approved" ? "reviewed" : "rejected",
      reviewedBy: review.reviewedBy,
      reviewedAt: now,
      reviewReason: review.reason,
      updatedAt: now
    };
    await this.putMemoryProposal(updated);
    await this.writeAudit({ action: `memory.${review.decision === "approved" ? "reviewed" : "rejected"}`, target: updated.id, actor: review.reviewedBy, metadata: { reason: review.reason } });
    return updated;
  }

  async testProposal(id: string, evalResults: EvalResult[]): Promise<MemoryProposal> {
    const proposal = await this.requireMemoryProposal(id);
    const passed = evalResults.length > 0 && evalResults.every((result) => result.passed);
    const updated: MemoryProposal = {
      ...proposal,
      evalResults,
      status: passed ? "tested" : "rejected",
      updatedAt: new Date().toISOString()
    };
    await this.putMemoryProposal(updated);
    await this.writeAudit({ action: passed ? "memory.tested" : "memory.rejected", target: updated.id, actor: "system", metadata: { evalCount: evalResults.length, passed } });
    return updated;
  }

  async promoteProposal(id: string): Promise<{ proposal: MemoryProposal; memory: MemoryBlock }> {
    const proposal = await this.requireMemoryProposal(id);
    if (proposal.status !== "reviewed" && proposal.status !== "tested") {
      throw new Error(`Memory proposal ${id} must be reviewed or tested before promotion.`);
    }
    const memory = await this.add({
      ...proposal.memory,
      pinned: true,
      promoted: true,
      metadata: {
        ...(proposal.memory.metadata ?? {}),
        proposalId: proposal.id,
        evidence: proposal.evidence ?? [],
        rationale: proposal.rationale
      }
    });
    const updated: MemoryProposal = {
      ...proposal,
      status: "promoted",
      promotedMemoryId: memory.id,
      updatedAt: new Date().toISOString()
    };
    await this.putMemoryProposal(updated);
    await this.writeAudit({ action: "memory.promoted", target: updated.id, actor: "system", metadata: { memoryId: memory.id } });
    return { proposal: updated, memory };
  }

  async putPage(page: WikiPageRecord): Promise<WikiPageRecord> {
    this.db
      .prepare("INSERT OR REPLACE INTO wiki_pages (id, title, path, summary, links, metadata, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(page.id, page.title, page.path, page.summary, stringify(page.links ?? []), stringify(page.metadata ?? {}), page.updatedAt);
    this.syncWikiFts(page);
    return page;
  }

  async query(query: string, options: { limit?: number } = {}): Promise<WikiPageRecord[]> {
    const ftsQuery = toFtsQuery(query);
    if (this.ftsEnabled && ftsQuery) {
      try {
        return this.db
          .prepare(
            `SELECT wiki_pages.* FROM wiki_pages
             JOIN wiki_pages_fts ON wiki_pages.id = wiki_pages_fts.id
             WHERE wiki_pages_fts MATCH ?
             ORDER BY bm25(wiki_pages_fts), wiki_pages.path ASC
             LIMIT ?`
          )
          .all(ftsQuery, options.limit ?? 10)
          .map(rowToWikiPage);
      } catch {
        // Fall through to stable substring ranking.
      }
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const pages = await this.listPages();
    return pages
      .map((page) => ({ page, score: terms.reduce((score, term) => score + (`${page.title} ${page.summary} ${page.path}`.toLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter((hit) => terms.length === 0 || hit.score > 0)
      .sort((a, b) => b.score - a.score || a.page.path.localeCompare(b.page.path))
      .slice(0, options.limit ?? 10)
      .map((hit) => hit.page);
  }

  async listPages(options: { limit?: number } = {}): Promise<WikiPageRecord[]> {
    return this.db.prepare("SELECT * FROM wiki_pages ORDER BY path ASC").all().map(rowToWikiPage).slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);
  }

  async putEvalResult(result: EvalResult & { suite?: string; createdAt?: string }): Promise<EvalResult & { suite?: string; createdAt: string }> {
    const stored = { ...result, createdAt: result.createdAt ?? new Date().toISOString() };
    this.db
      .prepare("INSERT OR REPLACE INTO eval_results (id, suite, passed, score, details, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(stored.id, stored.suite ?? null, stored.passed ? 1 : 0, stored.score, stringify(stored.details), stored.runId ?? null, stored.createdAt);
    return stored;
  }

  async listEvalResults(filter: { suite?: string; limit?: number } = {}): Promise<Array<EvalResult & { suite?: string; createdAt: string }>> {
    const rows = this.db.prepare("SELECT * FROM eval_results ORDER BY created_at DESC").all().map(rowToEvalResult);
    return rows.filter((result) => !filter.suite || result.suite === filter.suite).slice(0, filter.limit ?? rows.length);
  }

  async upsertCodeFile(file: CodeIndexFileRecord): Promise<CodeIndexFileRecord> {
    this.db
      .prepare("INSERT OR REPLACE INTO code_files (path, hash, summary, language, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(file.path, file.hash, file.summary, file.language ?? null, file.updatedAt);
    return file;
  }

  async upsertCodeSymbols(symbols: CodeSymbolRecord[]): Promise<void> {
    const statement = this.db.prepare("INSERT OR REPLACE INTO code_symbols (id, path, name, kind, line, column, signature) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const deleteFts = this.ftsEnabled ? this.db.prepare("DELETE FROM code_symbols_fts WHERE id = ?") : undefined;
    const insertFts = this.ftsEnabled ? this.db.prepare("INSERT INTO code_symbols_fts (id, name, signature, path) VALUES (?, ?, ?, ?)") : undefined;
    this.db.exec("BEGIN");
    try {
      for (const symbol of symbols) {
        statement.run(symbol.id, symbol.path, symbol.name, symbol.kind, symbol.line, symbol.column ?? null, symbol.signature ?? null);
        deleteFts?.run(symbol.id);
        insertFts?.run(symbol.id, symbol.name, symbol.signature ?? "", symbol.path);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async upsertCodeReferences(references: CodeReferenceRecord[]): Promise<void> {
    const statement = this.db.prepare("INSERT OR REPLACE INTO code_references (symbol_id, path, line, preview) VALUES (?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const reference of references) {
        statement.run(reference.symbolId, reference.path, reference.line, reference.preview);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async searchCodeSymbols(query: string, options: { limit?: number } = {}): Promise<CodeSymbolRecord[]> {
    const ftsQuery = toFtsQuery(query);
    if (this.ftsEnabled && ftsQuery) {
      try {
        return this.db
          .prepare(
            `SELECT code_symbols.* FROM code_symbols
             JOIN code_symbols_fts ON code_symbols.id = code_symbols_fts.id
             WHERE code_symbols_fts MATCH ?
             ORDER BY bm25(code_symbols_fts), code_symbols.name ASC
             LIMIT ?`
          )
          .all(ftsQuery, options.limit ?? 50)
          .map(rowToCodeSymbol);
      } catch {
        // Fall through to LIKE search.
      }
    }
    const normalized = `%${query.toLowerCase()}%`;
    return this.db
      .prepare("SELECT * FROM code_symbols WHERE lower(name) LIKE ? OR lower(signature) LIKE ? ORDER BY name ASC LIMIT ?")
      .all(normalized, normalized, options.limit ?? 50)
      .map(rowToCodeSymbol);
  }

  async findCodeReferences(symbolId: string, options: { limit?: number } = {}): Promise<CodeReferenceRecord[]> {
    return this.db
      .prepare("SELECT * FROM code_references WHERE symbol_id = ? ORDER BY path ASC, line ASC LIMIT ?")
      .all(symbolId, options.limit ?? 100)
      .map(rowToCodeReference);
  }

  async listCodeFiles(options: { limit?: number } = {}): Promise<CodeIndexFileRecord[]> {
    return this.db.prepare("SELECT * FROM code_files ORDER BY path ASC LIMIT ?").all(options.limit ?? 500).map(rowToCodeFile);
  }

  async createApproval(
    request: Omit<ApprovalRequest, "id" | "status" | "requestedAt"> & Partial<Pick<ApprovalRequest, "id" | "status" | "requestedAt">>
  ): Promise<ApprovalRequest> {
    const existing = request.id ? await this.getApproval(request.id) : undefined;
    const record: ApprovalRequest = {
      ...request,
      id: request.id ?? createId("appr"),
      status: request.status ?? "pending",
      requestedAt: request.requestedAt ?? new Date().toISOString(),
      permissions: request.permissions ?? []
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO approval_requests
         (id, run_id, session_id, tool_call_id, tool_name, input, permissions, reason, status, requested_at, decided_at, decided_by, decision_reason, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.runId,
        record.sessionId ?? null,
        record.toolCallId ?? null,
        record.toolName ?? null,
        stringify(record.input),
        stringify(record.permissions),
        record.reason,
        record.status,
        record.requestedAt,
        record.decidedAt ?? null,
        record.decidedBy ?? null,
        record.decisionReason ?? null,
        stringify(record.metadata ?? {})
      );
    if (!existing) {
      await this.writeAudit({ action: "approval.requested", target: record.id, runId: record.runId, sessionId: record.sessionId, metadata: { toolName: record.toolName, permissions: record.permissions } });
    }
    return record;
  }

  async getApproval(id: string): Promise<ApprovalRequest | undefined> {
    const row = this.db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id);
    return row ? rowToApproval(row) : undefined;
  }

  async listApprovals(filter: { runId?: string; status?: ApprovalStatus; limit?: number } = {}): Promise<ApprovalRequest[]> {
    const rows = this.db.prepare("SELECT * FROM approval_requests ORDER BY requested_at DESC").all().map(rowToApproval);
    return rows.filter((approval) => (!filter.runId || approval.runId === filter.runId) && (!filter.status || approval.status === filter.status)).slice(0, filter.limit ?? rows.length);
  }

  async decideApproval(decision: ApprovalDecision): Promise<ApprovalRequest> {
    const approval = await this.getApproval(decision.approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${decision.approvalId}`);
    }
    if (approval.status !== "pending") {
      return approval;
    }
    const updated: ApprovalRequest = {
      ...approval,
      status: decision.decision === "approved" ? "approved" : "denied",
      decidedAt: decision.decidedAt ?? new Date().toISOString(),
      decidedBy: decision.decidedBy,
      decisionReason: decision.reason
    };
    await this.createApproval(updated);
    await this.write({
      id: createId("evt"),
      runId: updated.runId,
      ts: updated.decidedAt ?? new Date().toISOString(),
      type: decision.decision === "approved" ? "approval.approved" : "approval.denied",
      data: {
        approvalId: updated.id,
        toolCallId: updated.toolCallId,
        toolName: updated.toolName,
        decidedBy: updated.decidedBy,
        reason: updated.decisionReason
      }
    });
    if (decision.decision === "denied") {
      await this.write({
        id: createId("evt"),
        runId: updated.runId,
        ts: updated.decidedAt ?? new Date().toISOString(),
        type: "run.cancelled",
        data: {
          steps: undefined,
          reason: updated.decisionReason ?? "approval denied",
          approvalId: updated.id,
          toolCallId: updated.toolCallId,
          toolName: updated.toolName
        }
      });
    }
    await this.writeAudit({ action: `approval.${decision.decision}`, target: updated.id, runId: updated.runId, sessionId: updated.sessionId, actor: updated.decidedBy, metadata: { reason: updated.decisionReason } });
    return updated;
  }

  async writeAudit(record: Omit<AuditRecord, "id" | "ts"> & Partial<Pick<AuditRecord, "id" | "ts">>): Promise<AuditRecord> {
    const stored: AuditRecord = {
      ...record,
      id: record.id ?? createId("aud"),
      ts: record.ts ?? new Date().toISOString()
    };
    this.db
      .prepare("INSERT OR REPLACE INTO audit_log (id, ts, actor, action, target, run_id, session_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(stored.id, stored.ts, stored.actor ?? null, stored.action, stored.target ?? null, stored.runId ?? null, stored.sessionId ?? null, stringify(stored.metadata ?? {}));
    return stored;
  }

  async listAudit(filter: { action?: string; runId?: string; limit?: number } = {}): Promise<AuditRecord[]> {
    const rows = this.db.prepare("SELECT * FROM audit_log ORDER BY ts DESC").all().map(rowToAudit);
    return rows.filter((record) => (!filter.action || record.action === filter.action) && (!filter.runId || record.runId === filter.runId)).slice(0, filter.limit ?? rows.length);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private enableFts(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, text, tags);
        CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(id UNINDEXED, title, path, summary);
        CREATE VIRTUAL TABLE IF NOT EXISTS code_symbols_fts USING fts5(id UNINDEXED, name, signature, path);
      `);
      this.ftsEnabled = true;
      this.rebuildFts();
    } catch {
      this.ftsEnabled = false;
    }
  }

  private ensureEventsAppendOnlySchema(): void {
    const columns = tableColumnNames(this.db, "events");
    if (columns.has("seq")) {
      return;
    }

    this.db.exec("BEGIN");
    try {
      this.db.exec(`
        ALTER TABLE events RENAME TO events_legacy_append_migration;
        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          ts TEXT NOT NULL,
          data TEXT NOT NULL,
          UNIQUE(run_id, seq)
        );
        INSERT INTO events (id, run_id, seq, type, ts, data)
        SELECT
          legacy.id,
          legacy.run_id,
          (
            SELECT count(*)
            FROM events_legacy_append_migration AS prior
            WHERE prior.run_id = legacy.run_id
              AND (
                prior.ts < legacy.ts
                OR (prior.ts = legacy.ts AND prior.rowid <= legacy.rowid)
              )
          ) AS seq,
          legacy.type,
          legacy.ts,
          legacy.data
        FROM events_legacy_append_migration AS legacy
        ORDER BY legacy.run_id ASC, legacy.ts ASC, legacy.rowid ASC;
        DROP TABLE events_legacy_append_migration;
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private rebuildFts(): void {
    if (!this.ftsEnabled) return;
    this.db.exec(`
      DELETE FROM memories_fts;
      INSERT INTO memories_fts (id, text, tags) SELECT id, text, tags FROM memories;
      DELETE FROM wiki_pages_fts;
      INSERT INTO wiki_pages_fts (id, title, path, summary) SELECT id, title, path, summary FROM wiki_pages;
      DELETE FROM code_symbols_fts;
      INSERT INTO code_symbols_fts (id, name, signature, path) SELECT id, name, coalesce(signature, ''), path FROM code_symbols;
    `);
  }

  private syncMemoryFts(memory: MemoryBlock): void {
    if (!this.ftsEnabled) return;
    this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(memory.id);
    this.db.prepare("INSERT INTO memories_fts (id, text, tags) VALUES (?, ?, ?)").run(memory.id, memory.text, (memory.tags ?? []).join(" "));
  }

  private syncWikiFts(page: WikiPageRecord): void {
    if (!this.ftsEnabled) return;
    this.db.prepare("DELETE FROM wiki_pages_fts WHERE id = ?").run(page.id);
    this.db.prepare("INSERT INTO wiki_pages_fts (id, title, path, summary) VALUES (?, ?, ?, ?)").run(page.id, page.title, page.path, page.summary);
  }

  private async putMemoryProposal(proposal: MemoryProposal): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memory_proposals
         (id, memory, rationale, status, evidence, eval_results, reviewed_by, reviewed_at, review_reason, promoted_memory_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        proposal.id,
        stringify(proposal.memory),
        proposal.rationale,
        proposal.status,
        stringify(proposal.evidence ?? []),
        stringify(proposal.evalResults ?? []),
        proposal.reviewedBy ?? null,
        proposal.reviewedAt ?? null,
        proposal.reviewReason ?? null,
        proposal.promotedMemoryId ?? null,
        stringify(proposal.metadata ?? {}),
        proposal.createdAt,
        proposal.updatedAt
      );
  }

  private async requireMemoryProposal(id: string): Promise<MemoryProposal> {
    const proposal = await this.getProposal(id);
    if (!proposal) {
      throw new Error(`Memory proposal not found: ${id}`);
    }
    return proposal;
  }
}

function rowToEvent(row: any): RuntimeEvent {
  return { id: row.id, runId: row.run_id, type: row.type, ts: row.ts, data: parseJson(row.data, {}) };
}

function tableColumnNames(db: DatabaseSyncType, table: string): Set<string> {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row: any) => String(row.name))
  );
}

function rowToRun(row: any): RunRecord {
  return {
    runId: row.run_id,
    status: row.status,
    agent: row.agent ?? undefined,
    input: row.input ?? undefined,
    sessionId: row.session_id ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    steps: row.steps ?? undefined,
    metadata: parseJson(row.metadata, {})
  };
}

function rowToSession(row: any): SessionRecord {
  return {
    id: row.id,
    name: row.name ?? undefined,
    status: row.status,
    activeRunId: row.active_run_id ?? undefined,
    input: row.input ?? undefined,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToArtifact(row: any): ArtifactRecord {
  return {
    ref: row.ref,
    kind: row.kind,
    runId: row.run_id ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    content: parseJson(row.content, undefined),
    summary: row.summary ?? undefined,
    preview: row.preview ?? undefined,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at
  };
}

function rowToMemory(row: any): MemoryBlock {
  return {
    id: row.id,
    scope: row.scope,
    text: row.text,
    kind: row.kind ?? undefined,
    tags: parseJson(row.tags, []),
    score: row.score ?? undefined,
    pinned: Boolean(row.pinned),
    promoted: Boolean(row.promoted),
    source: row.source ?? undefined,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToMemoryProposal(row: any): MemoryProposal {
  return {
    id: row.id,
    memory: parseJson(row.memory, { scope: "project", text: "" }),
    rationale: row.rationale,
    status: row.status,
    evidence: parseJson(row.evidence, []),
    evalResults: parseJson(row.eval_results, []),
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewReason: row.review_reason ?? undefined,
    promotedMemoryId: row.promoted_memory_id ?? undefined,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToWikiPage(row: any): WikiPageRecord {
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    summary: row.summary,
    links: parseJson(row.links, []),
    metadata: parseJson(row.metadata, {}),
    updatedAt: row.updated_at
  };
}

function rowToEvalResult(row: any): EvalResult & { suite?: string; createdAt: string } {
  return {
    id: row.id,
    suite: row.suite ?? undefined,
    passed: Boolean(row.passed),
    score: row.score,
    details: parseJson(row.details, []),
    runId: row.run_id ?? undefined,
    createdAt: row.created_at
  };
}

function rowToCodeFile(row: any): CodeIndexFileRecord {
  return { path: row.path, hash: row.hash, summary: row.summary, language: row.language ?? undefined, updatedAt: row.updated_at };
}

function rowToCodeSymbol(row: any): CodeSymbolRecord {
  return { id: row.id, path: row.path, name: row.name, kind: row.kind, line: row.line, column: row.column ?? undefined, signature: row.signature ?? undefined };
}

function rowToCodeReference(row: any): CodeReferenceRecord {
  return { symbolId: row.symbol_id, path: row.path, line: row.line, preview: row.preview };
}

function rowToApproval(row: any): ApprovalRequest {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    input: parseJson(row.input, undefined),
    permissions: parseJson(row.permissions, []),
    reason: row.reason,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at ?? undefined,
    decidedBy: row.decided_by ?? undefined,
    decisionReason: row.decision_reason ?? undefined,
    metadata: parseJson(row.metadata, {})
  };
}

function rowToAudit(row: any): AuditRecord {
  return {
    id: row.id,
    ts: row.ts,
    actor: row.actor ?? undefined,
    action: row.action,
    target: row.target ?? undefined,
    runId: row.run_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    metadata: parseJson(row.metadata, {})
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function scoreMemory(memory: MemoryBlock, terms: string[]): number {
  const haystack = `${memory.text} ${memory.tags?.join(" ") ?? ""} ${memory.kind ?? ""}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) + (memory.score ?? 0);
}

function toFtsQuery(query: string): string | undefined {
  const terms = query
    .split(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (terms.length === 0) {
    return undefined;
  }
  return terms.map((term) => `${term.replaceAll('"', "")}*`).join(" OR ");
}

function retentionCutoff(options: StoreRetentionOptions): string | undefined {
  if (options.before instanceof Date) {
    return options.before.toISOString();
  }
  if (typeof options.before === "string" && options.before.trim()) {
    const date = new Date(options.before);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid retention cutoff: ${options.before}`);
    }
    return date.toISOString();
  }
  if (typeof options.olderThanDays === "number") {
    if (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 0) {
      throw new Error("olderThanDays must be a non-negative number.");
    }
    return new Date(Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  }
  return undefined;
}

function countByRunIds(db: DatabaseSyncType, table: string, runIds: string[]): number {
  if (runIds.length === 0) return 0;
  const statement = db.prepare(`SELECT count(*) AS count FROM ${table} WHERE run_id = ?`);
  return runIds.reduce((count, runId) => count + Number((statement.get(runId) as any)?.count ?? 0), 0);
}

function countSessionsByActiveRunIds(db: DatabaseSyncType, runIds: string[]): number {
  if (runIds.length === 0) return 0;
  const statement = db.prepare("SELECT count(*) AS count FROM sessions WHERE active_run_id = ?");
  return runIds.reduce((count, runId) => count + Number((statement.get(runId) as any)?.count ?? 0), 0);
}

function mkdirSyncForFile(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
}
