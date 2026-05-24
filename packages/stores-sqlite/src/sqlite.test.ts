import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqlitePlatformStore } from "./index";

describe("SqlitePlatformStore", () => {
  it("persists runs, events, artifacts, memory, wiki pages, evals, sessions, and exports", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-sqlite-"));
    const store = new SqlitePlatformStore({ file: path.join(dir, "agentbase.sqlite") });
    await store.createSession({ id: "ses_1", status: "active", input: "hello" });
    await store.write({ id: "evt_1", runId: "run_1", type: "run.started", ts: "2026-05-20T00:00:00.000Z", data: { agent: "agent", input: "hello", sessionId: "ses_1" } });
    await store.write({ id: "evt_2", runId: "run_1", type: "run.completed", ts: "2026-05-20T00:00:01.000Z", data: { steps: 1 } });
    await store.put({ ref: "tool-result://run_1/call_1", kind: "tool_result", runId: "run_1", content: { ok: true }, summary: "ok" });
    const memory = await store.add({ scope: "project", text: "sqlite memory works" });
    await store.putPage({ id: "README.md", title: "Readme", path: "README.md", summary: "sqlite wiki", updatedAt: "2026-05-20T00:00:00.000Z" });
    await store.putEvalResult({ id: "eval_1", passed: true, score: 1, details: ["ok"] });
    const proposal = await store.propose({
      memory: { scope: "project", text: "sqlite proposal memory", kind: "decision" },
      rationale: "needs review"
    });
    await store.reviewProposal(proposal.id, { decision: "approved", reviewedBy: "test" });
    const promotedProposal = await store.promoteProposal(proposal.id);
    await store.upsertCodeFile({ path: "src/index.ts", hash: "hash", summary: "code file", language: "ts", updatedAt: "2026-05-20T00:00:00.000Z" });
    await store.upsertCodeSymbols([{ id: "src/index.ts#hello", path: "src/index.ts", name: "hello", kind: "function", line: 1 }]);
    await store.upsertCodeReferences([{ symbolId: "src/index.ts#hello", path: "src/index.ts", line: 2, preview: "hello();" }]);
    const approval = await store.createApproval({
      runId: "run_1",
      toolCallId: "call_approval",
      toolName: "run_shell",
      input: { command: "echo ok" },
      permissions: ["shell:run"],
      reason: "read-only policy blocks shell:run"
    });
    await store.decideApproval({ approvalId: approval.id, decision: "approved", decidedBy: "test" });
    await store.writeAudit({ action: "test.audit", target: "fixture", runId: "run_1" });
    await store.exportJsonl(path.join(dir, "events.jsonl"));
    await store.backupTo(path.join(dir, "backup.sqlite"));

    expect((await store.listRuns())[0].status).toBe("completed");
    expect((await store.readRun("run_1")).map((event) => event.type)).toEqual(expect.arrayContaining(["run.started", "run.completed", "approval.approved"]));
    expect((await store.materialize("tool-result://run_1/call_1"))?.summary).toBe("ok");
    expect((await store.search("sqlite")).map((item) => item.id)).toContain(memory.id);
    expect((await store.query("wiki"))[0].path).toBe("README.md");
    expect((await store.listEvalResults())[0].passed).toBe(true);
    expect((await store.listProposals({ status: "promoted" }))[0].id).toBe(proposal.id);
    expect(promotedProposal.memory.promoted).toBe(true);
    expect((await store.listSessions())[0].id).toBe("ses_1");
    expect((await store.searchCodeSymbols("hello"))[0].id).toBe("src/index.ts#hello");
    expect((await store.findCodeReferences("src/index.ts#hello"))[0].preview).toBe("hello();");
    expect((await store.listApprovals({ status: "approved" }))[0].id).toBe(approval.id);
    expect((await store.listAudit({ action: "test.audit" }))[0].target).toBe("fixture");
    expect((await store.doctor()).schemaVersion).toBe(3);
    await store.compact();
    await store.close();
  });

  it("records approval denial as a cancelled run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-sqlite-"));
    const store = new SqlitePlatformStore({ file: path.join(dir, "agentbase.sqlite") });
    await store.write({ id: "evt_waiting_started", runId: "run_waiting", type: "run.started", ts: "2026-05-20T00:00:00.000Z", data: { input: "dangerous action" } });
    const approval = await store.createApproval({
      runId: "run_waiting",
      toolCallId: "call_shell",
      toolName: "run_shell",
      input: { command: "rm -rf fixture" },
      permissions: ["shell:run"],
      reason: "high-risk shell command"
    });

    const denied = await store.decideApproval({ approvalId: approval.id, decision: "denied", decidedBy: "test", reason: "too risky" });

    expect(denied.status).toBe("denied");
    expect((await store.getRun("run_waiting"))?.status).toBe("cancelled");
    expect((await store.readRun("run_waiting")).map((event) => event.type)).toEqual(expect.arrayContaining(["approval.denied", "run.cancelled"]));
    await store.close();
  });

  it("prunes old terminal runs while retaining recent runs and writing maintenance audit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentbase-sqlite-"));
    const store = new SqlitePlatformStore({ file: path.join(dir, "agentbase.sqlite") });
    await store.createSession({ id: "ses_old", status: "active", activeRunId: "run_old", input: "old" });
    await store.write({ id: "evt_old_started", runId: "run_old", type: "run.started", ts: "2020-01-01T00:00:00.000Z", data: { input: "old" } });
    await store.write({ id: "evt_old_completed", runId: "run_old", type: "run.completed", ts: "2020-01-01T00:00:01.000Z", data: { steps: 1 } });
    await store.put({ ref: "tool-result://run_old/call_1", kind: "tool_result", runId: "run_old", content: { old: true } });
    await store.createApproval({ runId: "run_old", toolName: "run_shell", permissions: ["shell:run"], reason: "old approval" });
    await store.writeAudit({ action: "old.audit", target: "fixture", runId: "run_old" });
    await store.write({ id: "evt_recent_started", runId: "run_recent", type: "run.started", ts: "2026-01-01T00:00:00.000Z", data: { input: "recent" } });
    await store.write({ id: "evt_recent_completed", runId: "run_recent", type: "run.completed", ts: "2026-01-01T00:00:01.000Z", data: { steps: 1 } });

    const dryRun = await store.prune({ before: "2021-01-01T00:00:00.000Z", keepLastRuns: 0, dryRun: true });
    expect(dryRun.runIds).toEqual(["run_old"]);
    expect((await store.getRun("run_old"))?.status).toBe("completed");

    const report = await store.prune({ before: "2021-01-01T00:00:00.000Z", keepLastRuns: 0 });

    expect(report.deleted).toEqual(expect.objectContaining({ runs: 1, events: 2, artifacts: 1, approvals: 1, audit: 2, sessionsUpdated: 1 }));
    expect(await store.getRun("run_old")).toBeUndefined();
    expect((await store.getRun("run_recent"))?.status).toBe("completed");
    expect((await store.getSession("ses_old"))?.activeRunId).toBeUndefined();
    expect((await store.getSession("ses_old"))?.status).toBe("paused");
    expect((await store.listAudit({ action: "store.pruned" }))[0].target).toBe(store.file);
    await store.close();
  });
});
