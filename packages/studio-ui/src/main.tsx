import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Archive,
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  FileText,
  GitBranch,
  Library,
  Pin,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  TimerReset,
  XCircle
} from "lucide-react";
import "./styles.css";

type RunRecord = {
  runId: string;
  status: string;
  agent?: string;
  input?: string;
  startedAt?: string;
  completedAt?: string;
  steps?: number;
};

type RuntimeEvent = {
  id: string;
  runId: string;
  type: string;
  ts: string;
  data: Record<string, unknown>;
};

type ApprovalRequest = {
  id: string;
  runId: string;
  toolName?: string;
  reason: string;
  status: string;
  requestedAt: string;
  permissions?: string[];
};

type ArtifactRecord = {
  ref: string;
  kind: string;
  runId?: string;
  toolName?: string;
  summary?: string;
  preview?: string;
  createdAt?: string;
};

type MemoryBlock = {
  id: string;
  scope: string;
  text: string;
  kind?: string;
  pinned?: boolean;
  promoted?: boolean;
  updatedAt?: string;
  tags?: string[];
};

type MemoryProposal = {
  id: string;
  memory: {
    scope: string;
    text: string;
    kind?: string;
    tags?: string[];
  };
  rationale: string;
  status: string;
  evidence?: Array<{ type: string; ref?: string; summary: string }>;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewReason?: string;
  promotedMemoryId?: string;
  updatedAt?: string;
};

type ConfigView = {
  config: Record<string, unknown>;
  summary: Record<string, unknown>;
  issues: Array<{ path: string; message: string; severity: string }>;
};

type ReferencePattern = {
  id: string;
  title: string;
  description: string;
  requiredToolsets: string[];
};

type ReferencePatternRunReport = {
  ok: boolean;
  patternId: string;
  title: string;
  workspace: string;
  prompt: string;
  runId: string;
  reportFile: string;
  kept: boolean;
  eval?: unknown;
};

type PatternCatalogView = {
  version: number;
  patterns: ReferencePattern[];
  reports?: ReferencePatternRunReport[];
};

type GuardrailResult = {
  allowed: boolean;
  reason: string;
  category?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
};

type GuardrailReport = {
  ok: boolean;
  runId?: string;
  summary: {
    allowed: boolean;
    count: number;
    highestSeverity?: string;
    categories: Record<string, number>;
  };
  results: GuardrailResult[];
};

type ContextView = {
  runId: string;
  latest?: RuntimeEvent | null;
  contexts: RuntimeEvent[];
};

type ConformanceReport = {
  runId: string;
  createdAt: string;
  ok: boolean;
  checks?: Array<{ name: string; ok: boolean; message: string }>;
};

type ReplayDiffView = {
  left?: Record<string, unknown>;
  right?: Record<string, unknown>;
  [key: string]: unknown;
};

type PanelKey =
  | "timeline"
  | "context"
  | "tools"
  | "approvals"
  | "memory"
  | "memory-proposals"
  | "wiki"
  | "artifacts"
  | "evals"
  | "patterns"
  | "replay-diff"
  | "conformance"
  | "guardrails"
  | "audit"
  | "store"
  | "settings";

const panels: Array<{ key: PanelKey; label: string; endpoint?: string; icon: typeof Activity }> = [
  { key: "timeline", label: "Timeline", icon: Activity },
  { key: "context", label: "Context", icon: FileText },
  { key: "tools", label: "Tool Calls", icon: TerminalSquare },
  { key: "approvals", label: "Approvals", endpoint: "/api/approvals", icon: ShieldCheck },
  { key: "memory", label: "Memory", endpoint: "/api/memory", icon: Brain },
  { key: "memory-proposals", label: "Memory Gate", endpoint: "/api/memory/proposals", icon: Pin },
  { key: "wiki", label: "Wiki", endpoint: "/api/wiki", icon: FileText },
  { key: "artifacts", label: "Artifacts", endpoint: "/api/artifacts", icon: Archive },
  { key: "evals", label: "Evals", endpoint: "/api/evals", icon: CheckCircle2 },
  { key: "patterns", label: "Patterns", endpoint: "/api/patterns", icon: Library },
  { key: "replay-diff", label: "Replay Diff", icon: GitBranch },
  { key: "conformance", label: "Conformance", endpoint: "/api/conformance/reports", icon: ShieldCheck },
  { key: "guardrails", label: "Guardrails", icon: ShieldCheck },
  { key: "audit", label: "Audit", endpoint: "/api/audit", icon: GitBranch },
  { key: "store", label: "Store", endpoint: "/api/store/doctor", icon: Database },
  { key: "settings", label: "Settings", endpoint: "/api/config", icon: SlidersHorizontal }
];

function App() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [panel, setPanel] = useState<PanelKey>("timeline");
  const [platformData, setPlatformData] = useState<unknown>();
  const [artifactDetail, setArtifactDetail] = useState<unknown>();
  const [maintenanceResult, setMaintenanceResult] = useState<unknown>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    loadRuns().catch((cause) => setError(messageOf(cause)));
  }, []);

  async function loadRuns() {
    setLoading(true);
    const nextRuns = await getJson<RunRecord[]>("/api/runs");
    setRuns(nextRuns);
    setLoading(false);
    if (nextRuns[0]) {
      await selectRun(nextRuns[0].runId);
    }
  }

  async function selectRun(runId: string) {
    setSelectedRunId(runId);
    setPanel("timeline");
    setEvents(await getJson<RuntimeEvent[]>(`/api/runs/${encodeURIComponent(runId)}/events`));
  }

  async function openPanel(nextPanel: PanelKey) {
    setPanel(nextPanel);
    setArtifactDetail(undefined);
    setMaintenanceResult(undefined);
    if (nextPanel === "context" && selectedRunId) {
      setPlatformData(await getJson(`/api/runs/${encodeURIComponent(selectedRunId)}/context`));
      return;
    }
    if (nextPanel === "replay-diff" && selectedRunId) {
      const compareTarget = runs.find((run) => run.runId !== selectedRunId)?.runId;
      if (!compareTarget) {
        setPlatformData({ message: "Need at least two runs for replay diff." });
        return;
      }
      setPlatformData(await getJson(`/api/replay/diff?left=${encodeURIComponent(selectedRunId)}&right=${encodeURIComponent(compareTarget)}`));
      return;
    }
    const config = panels.find((item) => item.key === nextPanel);
    if (!config?.endpoint) return;
    const suffix = nextPanel === "memory" || nextPanel === "wiki" ? searchParams(query) : "";
    setPlatformData(await getJson(`${config.endpoint}${suffix}`));
  }

  async function decideApproval(id: string, decision: "approve" | "deny") {
    const approval = await postJson<ApprovalRequest>(`/api/approvals/${encodeURIComponent(id)}/${decision}`, {
      actor: "studio",
      reason: decision === "approve" ? "approved in studio" : "denied in studio"
    });
    await openPanel("approvals");
    if (selectedRunId) {
      setEvents(await getJson<RuntimeEvent[]>(`/api/runs/${encodeURIComponent(selectedRunId)}/events`));
    }
    setRuns(await getJson<RunRecord[]>("/api/runs"));
    setNotice(`${approval.id} ${approval.status}`);
  }

  async function openArtifact(ref: string) {
    setArtifactDetail(await getJson(`/api/artifacts/${encodeURIComponent(ref)}`));
  }

  async function promoteMemory(id: string) {
    const memory = await postJson<MemoryBlock>(`/api/memory/${encodeURIComponent(id)}/promote`, {});
    await openPanel("memory");
    setNotice(`${memory.id} promoted`);
  }

  async function proposeMemory(text: string, scope: string, rationale: string) {
    const proposal = await postJson<MemoryProposal>("/api/memory/proposals", {
      memory: { scope, text, kind: "fact" },
      rationale: rationale.trim() || "Proposed in Studio for reviewed memory promotion."
    });
    await openPanel("memory-proposals");
    setNotice(`${proposal.id} proposed`);
  }

  async function reviewMemoryProposal(id: string, decision: "approved" | "rejected") {
    const proposal = await postJson<MemoryProposal>(`/api/memory/proposals/${encodeURIComponent(id)}/review`, {
      decision,
      actor: "studio",
      reason: decision === "approved" ? "reviewed in studio" : "rejected in studio"
    });
    await openPanel("memory-proposals");
    setNotice(`${proposal.id} ${proposal.status}`);
  }

  async function promoteMemoryProposal(id: string) {
    const result = await postJson<{ proposal: MemoryProposal; memory: MemoryBlock }>(`/api/memory/proposals/${encodeURIComponent(id)}/promote`, {});
    await openPanel("memory-proposals");
    setNotice(`${result.proposal.id} promoted to ${result.memory.id}`);
  }

  async function compactStore() {
    setMaintenanceResult(await postJson("/api/store/compact", {}));
    setPlatformData(await getJson("/api/store/doctor"));
    setNotice("Store compacted");
  }

  async function backupStore() {
    const result = await postJson("/api/store/backup", {});
    setMaintenanceResult(result);
    setNotice("Store backup created");
  }

  async function pruneStore(dryRun: boolean) {
    if (!dryRun && !window.confirm("Prune old terminal runs according to the configured retention policy?")) {
      return;
    }
    const result = await postJson("/api/store/prune", { dryRun });
    setMaintenanceResult(result);
    setPlatformData(await getJson("/api/store/doctor"));
    setNotice(dryRun ? "Prune dry-run completed" : "Store pruned");
  }

  async function patchSettings(patch: Record<string, unknown>) {
    const result = await requestJson<ConfigView>("/api/config", "PATCH", { patch });
    setPlatformData(result);
    setNotice("Settings updated");
  }

  async function testProvider() {
    const result = await postJson("/api/provider/test", {});
    setMaintenanceResult(result);
    setNotice("Provider test recorded");
  }

  async function setPolicy(policy: string) {
    await requestJson("/api/policy", "PATCH", { policy });
    setPlatformData(await getJson("/api/config"));
    setNotice(`Policy updated: ${policy}`);
  }

  async function setToolset(toolset: string, enabled: boolean) {
    const endpoint = `/api/tools/${encodeURIComponent(toolset)}/${enabled ? "enable" : "disable"}`;
    const result = await postJson<ConfigView>(endpoint, {});
    setPlatformData(result);
    setNotice(`${toolset} ${enabled ? "enabled" : "disabled"}`);
  }

  async function scanGuardrail(input: { text?: string; runId?: string }) {
    const result = await postJson<GuardrailReport>("/api/guardrail/scan", input);
    setPlatformData(result);
    setNotice(result.ok ? "Guardrail scan passed" : `Guardrail findings: ${result.summary.count}`);
  }

  async function pushExport(target: string, runId?: string) {
    const result = await postJson("/api/export/push", { target, runId });
    setMaintenanceResult(result);
    setNotice(`Export pushed: ${target}`);
  }

  const selectedRun = runs.find((run) => run.runId === selectedRunId);
  const toolEvents = useMemo(() => events.filter((event) => event.type.startsWith("tool.") || event.type === "policy.checked"), [events]);
  const contextEvents = useMemo(() => events.filter((event) => event.type.startsWith("context.")), [events]);
  const modelEvents = useMemo(() => events.filter((event) => event.type.startsWith("model.")), [events]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={20} />
          <div>
            <strong>AgentBase Studio</strong>
            <span>Local runtime governance</span>
          </div>
        </div>
        <div className="search-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory or wiki" />
          <button aria-label="Refresh" title="Refresh runs" onClick={() => loadRuns()}>
            <TimerReset size={16} />
          </button>
        </div>
        <section className="side-section">
          <h2>Runs</h2>
          {loading ? <div className="empty">Loading runs</div> : null}
          {runs.map((run) => (
            <button className={`run-button ${run.runId === selectedRunId ? "active" : ""}`} key={run.runId} onClick={() => selectRun(run.runId)}>
              <StatusIcon status={run.status} />
              <span>
                <strong>{run.runId}</strong>
                <small>{run.status} · {run.agent ?? "agent"}</small>
              </span>
            </button>
          ))}
          {!loading && runs.length === 0 ? <div className="empty">No runs found</div> : null}
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Selected Run</p>
            <h1>{selectedRun?.runId ?? "No run selected"}</h1>
            <p className="subtle">{selectedRun?.input ?? selectedRun?.startedAt ?? "Run a local agent to populate Studio."}</p>
          </div>
          <div className="metrics">
            <Metric label="Events" value={events.length} />
            <Metric label="Model" value={modelEvents.length} />
            <Metric label="Tools" value={toolEvents.length} />
            <Metric label="Context" value={contextEvents.length} />
          </div>
        </header>

        <nav className="tabs" aria-label="Studio sections">
          {panels.map((item) => {
            const Icon = item.icon;
            return (
              <button className={panel === item.key ? "active" : ""} key={item.key} onClick={() => openPanel(item.key)}>
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {error ? <div className="error">{error}</div> : null}
        {notice ? <div className="notice">{notice}</div> : null}
        <section className="content">
          {panel === "timeline" ? <Timeline events={events} /> : null}
          {panel === "context" ? <ContextPanel view={asContextView(platformData)} /> : null}
          {panel === "tools" ? <ToolCalls events={toolEvents} /> : null}
          {panel === "approvals" ? <ApprovalsPanel approvals={asArray<ApprovalRequest>(platformData)} onDecision={decideApproval} /> : null}
          {panel === "memory" ? <MemoryPanel memories={asArray<MemoryBlock>(platformData)} onPromote={promoteMemory} /> : null}
          {panel === "memory-proposals" ? <MemoryProposalsPanel proposals={asArray<MemoryProposal>(platformData)} onPropose={proposeMemory} onReview={reviewMemoryProposal} onPromote={promoteMemoryProposal} /> : null}
          {panel === "artifacts" ? <ArtifactsPanel artifacts={asArray<ArtifactRecord>(platformData)} detail={artifactDetail} onOpen={openArtifact} /> : null}
          {panel === "patterns" ? <PatternsPanel view={asPatternCatalogView(platformData)} /> : null}
          {panel === "replay-diff" ? <ReplayDiffPanel diff={asReplayDiff(platformData)} /> : null}
          {panel === "conformance" ? <ConformancePanel reports={asArray<ConformanceReport>(platformData)} /> : null}
          {panel === "guardrails" ? <GuardrailsPanel selectedRunId={selectedRunId} report={asGuardrailReport(platformData)} onScan={scanGuardrail} /> : null}
          {panel === "store" ? <StorePanel doctor={platformData} result={maintenanceResult} onCompact={compactStore} onBackup={backupStore} onPrune={pruneStore} onPushExport={pushExport} selectedRunId={selectedRunId} /> : null}
          {panel === "settings" ? (
            <SettingsPanel view={asConfigView(platformData)} providerResult={maintenanceResult} onPatch={patchSettings} onProviderTest={testProvider} onPolicy={setPolicy} onToolset={setToolset} />
          ) : null}
          {panel !== "timeline" && panel !== "context" && panel !== "tools" && panel !== "approvals" && panel !== "memory" && panel !== "memory-proposals" && panel !== "artifacts" && panel !== "patterns" && panel !== "replay-diff" && panel !== "conformance" && panel !== "guardrails" && panel !== "store" && panel !== "settings" ? <JsonPanel value={platformData} /> : null}
        </section>
      </main>
    </div>
  );
}

function Timeline({ events }: { events: RuntimeEvent[] }) {
  if (events.length === 0) return <div className="empty">No events for this run</div>;
  return (
    <div className="timeline">
      {events.map((event) => (
        <article className="event-card" key={event.id}>
          <div className="event-head">
            <span className="event-type">{event.type}</span>
            <time>{formatTime(event.ts)}</time>
          </div>
          <p>{summarizeEvent(event)}</p>
          <details>
            <summary>Payload</summary>
            <pre>{JSON.stringify(event.data, null, 2)}</pre>
          </details>
        </article>
      ))}
    </div>
  );
}

function ToolCalls({ events }: { events: RuntimeEvent[] }) {
  if (events.length === 0) return <div className="empty">No tool events for this run</div>;
  return (
    <div className="tool-grid">
      {events.map((event) => (
        <article className="event-card" key={event.id}>
          <div className="event-head">
            <span className="event-type">{event.type}</span>
            <time>{formatTime(event.ts)}</time>
          </div>
          <p>{String(event.data.name ?? event.data.toolName ?? event.data.reason ?? "tool event")}</p>
          <pre>{JSON.stringify(event.data, null, 2)}</pre>
        </article>
      ))}
    </div>
  );
}

function ContextPanel({ view }: { view?: ContextView }) {
  if (!view) return <div className="empty">No context snapshot available</div>;
  const latest = view.latest;
  const items = Array.isArray(latest?.data.items) ? latest?.data.items : [];
  return (
    <div className="split-panel">
      <section className="event-card">
        <div className="event-head">
          <span className="event-type">Latest Context Snapshot</span>
          <span className="pill">{items.length} item(s)</span>
        </div>
        <p>messageCount={String(latest?.data.messageCount ?? 0)} · tokenEstimate={String(latest?.data.tokenEstimate ?? 0)}</p>
        <div className="list-panel compact-list">
          {items.map((item, index) => {
            const record = asRecord(item) ?? {};
            return (
              <article className="event-card" key={`${record.id ?? index}`}>
                <div className="event-head">
                  <span className="event-type">{String(record.type ?? "item")}</span>
                  <span className={`pill ${record.included ? "approved" : "pending"}`}>{record.included ? "included" : "excluded"}</span>
                </div>
                <p>{String(record.reason ?? "no reason")}</p>
                <div className="meta-line">{String(record.id ?? `item-${index}`)}</div>
              </article>
            );
          })}
        </div>
      </section>
      <JsonPanel value={view} />
    </div>
  );
}

function JsonPanel({ value }: { value: unknown }) {
  if (value === undefined) return <div className="empty">Open a panel to load data</div>;
  return <pre className="json-panel">{JSON.stringify(value, null, 2)}</pre>;
}

function ApprovalsPanel({ approvals, onDecision }: { approvals: ApprovalRequest[]; onDecision: (id: string, decision: "approve" | "deny") => Promise<void> }) {
  if (approvals.length === 0) return <div className="empty">No approvals found</div>;
  return (
    <div className="list-panel">
      {approvals.map((approval) => (
        <article className="event-card" key={approval.id}>
          <div className="event-head">
            <span className="event-type">{approval.toolName ?? approval.id}</span>
            <span className={`pill ${approval.status}`}>{approval.status}</span>
          </div>
          <p>{approval.reason}</p>
          <div className="meta-line">{approval.runId} · {(approval.permissions ?? []).join(", ") || "no permissions"}</div>
          {approval.status === "pending" ? (
            <div className="actions">
              <button className="action-button success" onClick={() => onDecision(approval.id, "approve")}>
                <CheckCircle2 size={16} />
                Approve
              </button>
              <button className="action-button danger" onClick={() => onDecision(approval.id, "deny")}>
                <XCircle size={16} />
                Deny
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function MemoryPanel({ memories, onPromote }: { memories: MemoryBlock[]; onPromote: (id: string) => Promise<void> }) {
  if (memories.length === 0) return <div className="empty">No memory entries found</div>;
  return (
    <div className="list-panel">
      {memories.map((memory) => (
        <article className="event-card" key={memory.id}>
          <div className="event-head">
            <span className="event-type">{memory.scope}{memory.kind ? ` · ${memory.kind}` : ""}</span>
            <span className={`pill ${memory.promoted ? "approved" : "pending"}`}>{memory.promoted ? "promoted" : "draft"}</span>
          </div>
          <p>{memory.text}</p>
          <div className="meta-line">{memory.id} · {(memory.tags ?? []).join(", ") || "no tags"}</div>
          {!memory.promoted ? (
            <div className="actions">
              <button className="action-button" onClick={() => onPromote(memory.id)}>
                <Pin size={16} />
                Promote
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function MemoryProposalsPanel({
  proposals,
  onPropose,
  onReview,
  onPromote
}: {
  proposals: MemoryProposal[];
  onPropose: (text: string, scope: string, rationale: string) => Promise<void>;
  onReview: (id: string, decision: "approved" | "rejected") => Promise<void>;
  onPromote: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState("project");
  const [rationale, setRationale] = useState("");
  return (
    <div className="split-panel">
      <section className="event-card">
        <div className="event-head">
          <span className="event-type">New Memory Proposal</span>
          <span className="pill">review gate</span>
        </div>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim()) return;
            void onPropose(text.trim(), scope, rationale).then(() => {
              setText("");
              setRationale("");
            });
          }}
        >
          <label>
            Scope
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="session">session</option>
              <option value="project">project</option>
              <option value="user">user</option>
              <option value="agent">agent</option>
              <option value="procedural">procedural</option>
              <option value="episodic">episodic</option>
              <option value="semantic">semantic</option>
            </select>
          </label>
          <label>
            Memory text
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="A durable, scoped memory candidate" />
          </label>
          <label>
            Rationale
            <input value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Why this should become durable memory" />
          </label>
          <button className="action-button success" type="submit">
            <CheckCircle2 size={16} />
            Propose
          </button>
        </form>
      </section>
      <section className="list-panel">
        {proposals.length === 0 ? <div className="empty">No memory proposals found</div> : null}
        {proposals.map((proposal) => (
          <article className="event-card" key={proposal.id}>
            <div className="event-head">
              <span className="event-type">{proposal.memory.scope}{proposal.memory.kind ? ` · ${proposal.memory.kind}` : ""}</span>
              <span className={`pill ${proposal.status === "promoted" || proposal.status === "reviewed" || proposal.status === "tested" ? "approved" : proposal.status === "rejected" ? "denied" : "pending"}`}>{proposal.status}</span>
            </div>
            <p>{proposal.memory.text}</p>
            <div className="meta-line">{proposal.id} · {proposal.rationale}</div>
            {proposal.evidence?.length ? <div className="meta-line">Evidence: {proposal.evidence.map((item) => item.summary).join("; ")}</div> : null}
            <div className="actions">
              {proposal.status === "proposed" ? (
                <>
                  <button className="action-button success" onClick={() => void onReview(proposal.id, "approved")}>
                    <CheckCircle2 size={16} />
                    Approve
                  </button>
                  <button className="action-button danger" onClick={() => void onReview(proposal.id, "rejected")}>
                    <XCircle size={16} />
                    Reject
                  </button>
                </>
              ) : null}
              {proposal.status === "reviewed" || proposal.status === "tested" ? (
                <button className="action-button" onClick={() => void onPromote(proposal.id)}>
                  <Pin size={16} />
                  Promote
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ArtifactsPanel({ artifacts, detail, onOpen }: { artifacts: ArtifactRecord[]; detail: unknown; onOpen: (ref: string) => Promise<void> }) {
  if (artifacts.length === 0) return <div className="empty">No artifacts found</div>;
  return (
    <div className="split-panel">
      <div className="list-panel">
        {artifacts.map((artifact) => (
          <article className="event-card" key={artifact.ref}>
            <div className="event-head">
              <span className="event-type">{artifact.kind}</span>
              <span className="pill">{artifact.toolName ?? "artifact"}</span>
            </div>
            <p>{artifact.summary ?? artifact.preview ?? artifact.ref}</p>
            <div className="meta-line">{artifact.runId ?? "no run"} · {artifact.ref}</div>
            <div className="actions">
              <button className="action-button" onClick={() => onOpen(artifact.ref)}>
                <Eye size={16} />
                Open
              </button>
            </div>
          </article>
        ))}
      </div>
      <ArtifactDetailView detail={detail} />
    </div>
  );
}

function PatternsPanel({ view }: { view?: PatternCatalogView }) {
  if (!view) return <div className="empty">Patterns API is not available</div>;
  const reports = view.reports ?? [];
  return (
    <div className="patterns-layout">
      <section className="pattern-catalog">
        {view.patterns.map((pattern) => (
          <article className="event-card" key={pattern.id}>
            <div className="event-head">
              <span className="event-type">{pattern.title}</span>
              <span className="pill">{pattern.id}</span>
            </div>
            <p>{pattern.description}</p>
            <div className="chip-row">
              {pattern.requiredToolsets.map((toolset) => (
                <span className="chip" key={toolset}>{toolset.replace("@agentbase/", "")}</span>
              ))}
            </div>
          </article>
        ))}
      </section>
      <section className="event-card">
        <div className="event-head">
          <span className="event-type">Recent Pattern Runs</span>
          <span className="pill">{reports.length} report(s)</span>
        </div>
        {reports.length === 0 ? <p>No pattern run reports found.</p> : null}
        <div className="list-panel compact-list">
          {reports.map((report) => (
            <article className="report-row" key={`${report.patternId}-${report.runId}`}>
              <div>
                <strong>{report.title || report.patternId}</strong>
                <span>{report.runId} · {report.kept ? "kept" : "discarded"}</span>
              </div>
              <span className={`pill ${report.ok ? "approved" : "denied"}`}>{report.ok ? "passed" : "failed"}</span>
              <small>{report.reportFile}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function GuardrailsPanel({
  selectedRunId,
  report,
  onScan
}: {
  selectedRunId?: string;
  report?: GuardrailReport;
  onScan: (input: { text?: string; runId?: string }) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const categories = report ? Object.entries(report.summary.categories) : [];
  return (
    <div className="split-panel">
      <section className="event-card">
        <div className="event-head">
          <span className="event-type">Guardrail Scan</span>
          <span className={`pill ${report ? (report.ok ? "approved" : "denied") : "pending"}`}>{report ? (report.ok ? "clear" : `${report.summary.count} finding(s)`) : "ready"}</span>
        </div>
        <div className="actions">
          <button className="action-button" disabled={!selectedRunId} onClick={() => selectedRunId && void onScan({ runId: selectedRunId })}>
            <ShieldCheck size={16} />
            Scan selected run
          </button>
        </div>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim()) return;
            void onScan({ text: text.trim() });
          }}
        >
          <label>
            Text
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste text or tool output" />
          </label>
          <button className="action-button success" type="submit">
            <CheckCircle2 size={16} />
            Scan text
          </button>
        </form>
        {report ? (
          <div className="guardrail-summary">
            <Metric label="Findings" value={report.summary.count} />
            <Metric label="Categories" value={categories.length} />
            <Metric label="Blocked" value={report.ok ? 0 : 1} />
          </div>
        ) : null}
      </section>
      <section className="list-panel">
        {!report ? <div className="empty">No guardrail scan yet</div> : null}
        {report && report.results.length === 0 ? <div className="empty">No guardrail findings</div> : null}
        {report?.results.map((result, index) => (
          <article className="event-card" key={`${result.category}-${result.severity}-${index}`}>
            <div className="event-head">
              <span className="event-type">{result.category ?? "unknown"}</span>
              <span className={`pill ${result.severity === "critical" || result.severity === "high" ? "denied" : "pending"}`}>{result.severity ?? "medium"}</span>
            </div>
            <p>{result.reason}</p>
            <pre>{JSON.stringify(result.metadata ?? {}, null, 2)}</pre>
          </article>
        ))}
      </section>
    </div>
  );
}

function ReplayDiffPanel({ diff }: { diff?: ReplayDiffView }) {
  if (!diff) return <div className="empty">Replay diff not available</div>;
  return <JsonPanel value={diff} />;
}

function ConformancePanel({ reports }: { reports: ConformanceReport[] }) {
  if (reports.length === 0) return <div className="empty">No conformance reports found</div>;
  return (
    <div className="list-panel">
      {reports.map((report) => (
        <article className="event-card" key={`${report.runId}-${report.createdAt}`}>
          <div className="event-head">
            <span className="event-type">{report.runId}</span>
            <span className={`pill ${report.ok ? "approved" : "denied"}`}>{report.ok ? "passed" : "failed"}</span>
          </div>
          <p>{formatTime(report.createdAt)}</p>
          <div className="meta-line">{(report.checks ?? []).filter((check) => !check.ok).map((check) => check.name).join(", ") || "All checks passed"}</div>
          <JsonPanel value={report} />
        </article>
      ))}
    </div>
  );
}

function ArtifactDetailView({ detail }: { detail: unknown }) {
  const record = asRecord(detail);
  if (!record) return <JsonPanel value={detail} />;
  const content = record.content;
  const metadata = asRecord(record.metadata);
  if (typeof content === "string" && /<!doctype|<html/i.test(content)) {
    return <iframe className="artifact-frame" srcDoc={content} title="artifact html preview" />;
  }
  if (typeof content === "string") {
    return <pre className="json-panel">{content}</pre>;
  }
  if (isDbResult(content)) {
    return (
      <div className="event-card">
        <div className="event-head">
          <span className="event-type">db-result</span>
          <span className="pill">{content.rows.length} row(s)</span>
        </div>
        <JsonPanel value={content.rows} />
      </div>
    );
  }
  if (record.kind === "tool_result") {
    return (
      <div className="split-panel">
        <section className="event-card">
          <div className="event-head">
            <span className="event-type">{String(record.toolName ?? "tool_result")}</span>
            <span className="pill">{String(metadata?.durationMs ?? "n/a")} ms</span>
          </div>
          <p>{String(record.summary ?? record.preview ?? "Tool result")}</p>
          <JsonPanel value={content} />
        </section>
        <JsonPanel value={detail} />
      </div>
    );
  }
  return <JsonPanel value={detail} />;
}

function StorePanel({
  doctor,
  result,
  onCompact,
  onBackup,
  onPrune,
  onPushExport,
  selectedRunId
}: {
  doctor: unknown;
  result: unknown;
  onCompact: () => Promise<void>;
  onBackup: () => Promise<void>;
  onPrune: (dryRun: boolean) => Promise<void>;
  onPushExport: (target: string, runId?: string) => Promise<void>;
  selectedRunId?: string;
}) {
  const [target, setTarget] = useState("local-observer");
  return (
    <div className="split-panel">
      <div className="event-card">
        <div className="event-head">
          <span className="event-type">Store Maintenance</span>
          <span className="pill">local</span>
        </div>
        <div className="actions">
          <button className="action-button" onClick={onCompact}>
            <Database size={16} />
            Compact
          </button>
          <button className="action-button" onClick={onBackup}>
            <Archive size={16} />
            Backup
          </button>
          <button className="action-button" onClick={() => onPrune(true)}>
            <Eye size={16} />
            Dry-run prune
          </button>
          <button className="action-button danger" onClick={() => onPrune(false)}>
            <XCircle size={16} />
            Prune
          </button>
        </div>
        <div className="settings-form compact">
          <label>
            Export target
            <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="local-observer" />
          </label>
          <button className="action-button" onClick={() => void onPushExport(target, selectedRunId)}>
            <GitBranch size={16} />
            Push export
          </button>
        </div>
        <JsonPanel value={result ?? { status: "No maintenance action yet" }} />
      </div>
      <JsonPanel value={doctor} />
    </div>
  );
}

function SettingsPanel({
  view,
  providerResult,
  onPatch,
  onProviderTest,
  onPolicy,
  onToolset
}: {
  view?: ConfigView;
  providerResult: unknown;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onProviderTest: () => Promise<void>;
  onPolicy: (policy: string) => Promise<void>;
  onToolset: (toolset: string, enabled: boolean) => Promise<void>;
}) {
  const provider = asRecord(view?.config.provider);
  const [providerType, setProviderType] = useState(String(provider?.type ?? "mock"));
  const [model, setModel] = useState(String(provider?.model ?? ""));
  const [baseUrl, setBaseUrl] = useState(String(provider?.baseUrl ?? ""));
  const [apiKeyEnv, setApiKeyEnv] = useState(String(provider?.apiKeyEnv ?? ""));
  const [policy, setPolicyDraft] = useState(String(view?.config.policy ?? "workspace-write"));
  const [httpConfig, setHttpConfig] = useState("{}");
  const [browserConfig, setBrowserConfig] = useState("{}");
  const [databaseConfig, setDatabaseConfig] = useState("{}");
  const [mcpConfig, setMcpConfig] = useState("{}");
  const [codeIndexConfig, setCodeIndexConfig] = useState("{}");
  const [exportConfig, setExportConfig] = useState("{}");

  useEffect(() => {
    const nextProvider = asRecord(view?.config.provider);
    setProviderType(String(nextProvider?.type ?? "mock"));
    setModel(String(nextProvider?.model ?? ""));
    setBaseUrl(String(nextProvider?.baseUrl ?? ""));
    setApiKeyEnv(String(nextProvider?.apiKeyEnv ?? ""));
    setPolicyDraft(String(view?.config.policy ?? "workspace-write"));
    setHttpConfig(JSON.stringify(view?.config.http ?? {}, null, 2));
    setBrowserConfig(JSON.stringify(view?.config.browser ?? {}, null, 2));
    setDatabaseConfig(JSON.stringify(view?.config.database ?? {}, null, 2));
    setMcpConfig(JSON.stringify(view?.config.mcp ?? {}, null, 2));
    setCodeIndexConfig(JSON.stringify(view?.config.codeIndex ?? {}, null, 2));
    setExportConfig(JSON.stringify(view?.config.exports ?? {}, null, 2));
  }, [view]);

  if (!view) return <div className="empty">Settings API is not available</div>;

  const enabled = new Set(asStringArray(view.config.toolsets ?? view.config.tools));
  const toolsets = [
    ["@agentbase/tools-fs", "Filesystem"],
    ["@agentbase/tools-shell", "Shell"],
    ["@agentbase/tools-git", "Git"],
    ["@agentbase/code-index", "Code Index"],
    ["@agentbase/tools-http", "HTTP"],
    ["@agentbase/tools-browser", "Browser"],
    ["@agentbase/tools-database", "Database"],
    ["@agentbase/mcp", "MCP"],
    ["@agentbase/tools-web", "Web/Search"]
  ];

  return (
    <div className="settings-grid">
      <section className="event-card">
        <div className="event-head">
          <span className="event-type">Provider</span>
          <span className="pill">{providerType}</span>
        </div>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onPatch({
              provider: {
                type: providerType,
                model: model.trim() || undefined,
                baseUrl: baseUrl.trim() || undefined,
                apiKeyEnv: apiKeyEnv.trim() || undefined
              }
            });
          }}
        >
          <label>
            Type
            <select value={providerType} onChange={(event) => setProviderType(event.target.value)}>
              <option value="mock">mock</option>
              <option value="openai-compatible">openai-compatible</option>
              <option value="litellm">litellm</option>
              <option value="ollama">ollama</option>
            </select>
          </label>
          <label>
            Model
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="mock/repo-analyst" />
          </label>
          <label>
            Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" />
          </label>
          <label>
            API key env
            <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value)} placeholder="OPENAI_API_KEY" />
          </label>
          <div className="actions">
            <button className="action-button success" type="submit">
              <CheckCircle2 size={16} />
              Save provider
            </button>
            <button className="action-button" type="button" onClick={() => void onProviderTest()}>
              <ShieldCheck size={16} />
              Test provider
            </button>
          </div>
        </form>
        <JsonPanel value={providerResult ?? { status: "Provider test not run" }} />
      </section>

      <section className="event-card">
        <div className="event-head">
          <span className="event-type">Policy</span>
          <span className="pill">{policy}</span>
        </div>
        <div className="settings-form compact">
          <label>
            Policy mode
            <select value={policy} onChange={(event) => setPolicyDraft(event.target.value)}>
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
              <option value="developer">developer</option>
              <option value="trusted">trusted</option>
            </select>
          </label>
          <button className="action-button success" onClick={() => void onPolicy(policy)}>
            <CheckCircle2 size={16} />
            Save policy
          </button>
        </div>
      </section>

      <section className="event-card wide">
        <div className="event-head">
          <span className="event-type">Toolsets</span>
          <span className="pill">{enabled.size} enabled</span>
        </div>
        <div className="toolset-list">
          {toolsets.map(([toolset, label]) => {
            const active = enabled.has(toolset);
            return (
              <button className={`toolset-toggle ${active ? "active" : ""}`} key={toolset} onClick={() => void onToolset(toolset, !active)}>
                <span>{label}</span>
                <small>{toolset}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="event-card wide">
        <div className="event-head">
          <span className="event-type">Config Health</span>
          <span className={`pill ${view.issues.length === 0 ? "approved" : "pending"}`}>{view.issues.length === 0 ? "valid" : `${view.issues.length} issue(s)`}</span>
        </div>
        {view.issues.length === 0 ? <p>No config issues found.</p> : null}
        {view.issues.map((issue) => (
          <p className="meta-line" key={`${issue.path}-${issue.message}`}>
            {issue.severity}: {issue.path} · {issue.message}
          </p>
        ))}
        <JsonPanel value={view.summary} />
      </section>

      <JsonConfigSection title="HTTP" value={httpConfig} onChange={setHttpConfig} onSave={() => void onPatch({ http: parseJsonInput(httpConfig) })} />
      <JsonConfigSection title="Browser" value={browserConfig} onChange={setBrowserConfig} onSave={() => void onPatch({ browser: parseJsonInput(browserConfig) })} />
      <JsonConfigSection title="Database" value={databaseConfig} onChange={setDatabaseConfig} onSave={() => void onPatch({ database: parseJsonInput(databaseConfig) })} />
      <JsonConfigSection title="MCP" value={mcpConfig} onChange={setMcpConfig} onSave={() => void onPatch({ mcp: parseJsonInput(mcpConfig) })} />
      <JsonConfigSection title="Code Index" value={codeIndexConfig} onChange={setCodeIndexConfig} onSave={() => void onPatch({ codeIndex: parseJsonInput(codeIndexConfig) })} />
      <JsonConfigSection title="Exports" value={exportConfig} onChange={setExportConfig} onSave={() => void onPatch({ exports: parseJsonInput(exportConfig) })} />
    </div>
  );
}

function JsonConfigSection({
  title,
  value,
  onChange,
  onSave
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="event-card wide">
      <div className="event-head">
        <span className="event-type">{title}</span>
        <span className="pill">json patch</span>
      </div>
      <label className="settings-form">
        <span>{title} config</span>
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={8} />
      </label>
      <div className="actions">
        <button className="action-button success" onClick={onSave}>
          <CheckCircle2 size={16} />
          Save {title}
        </button>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="status ok" size={16} />;
  if (status === "failed" || status === "cancelled") return <XCircle className="status bad" size={16} />;
  if (status === "waiting_approval") return <ShieldCheck className="status wait" size={16} />;
  return <Clock3 className="status run" size={16} />;
}

async function getJson<T = unknown>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
  return (await response.json()) as T;
}

async function postJson<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
  return (await response.json()) as T;
}

async function requestJson<T = unknown>(endpoint: string, method: "PATCH", body: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
  return (await response.json()) as T;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asConfigView(value: unknown): ConfigView | undefined {
  if (!isPlainRecord(value) || !isPlainRecord(value.config) || !isPlainRecord(value.summary) || !Array.isArray(value.issues)) {
    return undefined;
  }
  return value as ConfigView;
}

function asPatternCatalogView(value: unknown): PatternCatalogView | undefined {
  if (!isPlainRecord(value) || !Array.isArray(value.patterns)) {
    return undefined;
  }
  return value as PatternCatalogView;
}

function asContextView(value: unknown): ContextView | undefined {
  if (!isPlainRecord(value) || !Array.isArray(value.contexts)) {
    return undefined;
  }
  return value as ContextView;
}

function asGuardrailReport(value: unknown): GuardrailReport | undefined {
  if (!isPlainRecord(value) || !isPlainRecord(value.summary) || !Array.isArray(value.results)) {
    return undefined;
  }
  return value as GuardrailReport;
}

function asReplayDiff(value: unknown): ReplayDiffView | undefined {
  return isPlainRecord(value) ? (value as ReplayDiffView) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDbResult(value: unknown): value is { rows: unknown[] } {
  return isPlainRecord(value) && Array.isArray(value.rows);
}

function parseJsonInput(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed);
  return isPlainRecord(parsed) ? parsed : {};
}

function searchParams(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
}

function summarizeEvent(event: RuntimeEvent): string {
  const data = event.data;
  if (typeof data.outputPreview === "string") return data.outputPreview;
  if (typeof data.summary === "string") return data.summary;
  if (typeof data.reason === "string") return data.reason;
  if (typeof data.status === "string") return data.status;
  return Object.keys(data).slice(0, 5).join(", ") || "No payload";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById("root")!).render(<App />);
