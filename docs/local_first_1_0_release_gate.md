# AgentBase Local-First 1.0 Release Gate

This repo treats "100%" as local-first OSS 1.0, not hosted SaaS. The release gate is intentionally operational:

```bash
pnpm release:check
```

`pnpm release:check` expands to build, contract tests, test, E2E, reference-pattern, and
conformance gates.

## Current Gate Coverage

- Package build for all workspace packages.
- Contract tests for provider/tool/tool-result/workflow interface invariants.
- Unit and integration tests across runtime, tools, stores, server, replay, eval, memory, wiki, code index, MCP, and CLI.
- Local-first E2E smoke covering:
  - `init`
  - `config doctor`
  - `patterns list/show/init/run`
  - shared `@agentbase/config` validation/redaction/patching
  - `provider set/test`, `policy set`, `tools enable/disable/configure`
  - mock `run`
  - `trace list/show`
  - `export traces --format openinference`
  - `replay run`
  - `run --resume` from recorded checkpoints
  - YAML `eval run --suite --run`
  - `guardrail scan --run` and eval guardrail assertions
  - `export push --target`
  - `evolve propose/test` through the eval gate
  - `evolve promote/rollback`
  - `memory add/search`
  - `memory propose/review/promote-proposal`
  - `wiki index/query`
  - runtime-backed `team run`
  - `store doctor/compact/prune --dry-run`
  - `backup create/restore`
  - `serve --once`
  - `studio --once`
- Conformance pack covering runtime-contract invariants:
  - config validity
  - start/resume trace event
  - context snapshot
  - policy decision
  - model completion
  - terminal run event
  - tool output envelope
  - artifact index
  - guardrail scan with no high-severity findings on conforming runs
  - approval checkpoint payload with pending and completed parallel tool-call state
  - approval decision/reuse before deterministic resume
  - workflow approval resume without rerunning completed child tasks
  - config mutation audit
- Contract tests now cover not only tool/provider/envelope/workflow shape, but also specialist manifests, context snapshot layers, relay mailbox transitions, and local runtime security tokens.
- Reference-pattern validation covering `repo-analyst`, `test-runner`, `research-agent`, `tool-designer`, and `memory-curator`.

## 1.0 Production Baseline In Place

- Stable public runtime/store/approval/audit/eval/replay/guardrail/studio config types are exported from `@agentbase/core`.
- SQLite platform store owns schema versioning, migration guardrails, integrity doctor, FTS tables, backup, compact, retention prune, approvals, and audit log.
- Runtime can pause as `waiting_approval` when policy requires approval, persist pending and already-completed parallel tool-call checkpoint state plus approval request, reuse approved requests on `run --resume`, skip completed tool calls, and cancel cleanly on denied approval.
- Context manager is budget-planned and can assemble stable prefix, pinned/relevant memory, wiki hits, code symbols, artifact refs, working set, and latest tool preview with snapshot reasons.
- Multi-agent workflow can execute through the real runtime. Each workflow has a parent run, each task has a deterministic child run, workflow/handoff events are written to the same trace store, and approval resume skips completed child tasks.
- Replay/eval/guardrail/evolution gate is connected: replay extracts output, run metadata, and events from recorded traces; eval suites support JSON/YAML, runtime assertions, trace event assertions, tool-sequence assertions, and guardrail assertions; evolution test attaches eval evidence before promotion.
- Durable resume now writes boundary checkpoints for context/model/tool/approval phases, and `run --resume` can continue from the latest durable boundary without rerunning completed model/tool work.
- Memory promotion now has an explicit governance path: proposal, review, optional eval evidence, and promotion into durable scoped memory.
- Experience and capability assets now have local stores and CLI entry points, so successful task runs can become event/atom/lesson records and promoted reusable capabilities.
- Relay mailbox provides a shared local state machine for run/team/approval/export/eval handoff messages through CLI and server API.
- Specialist manifests let orchestrator agents advertise trigger, handoff, freshness, risk, and result contracts.
- Context snapshots now expose named layers for stable prefix, memory, wiki/code, artifacts, working set, and dynamic suffix.
- Local runtime security helper provides per-launch token, random local port, injected auth headers, and token hashing for desktop/server pairing.
- These newly absorbed runtime patterns are wired into `pnpm contracts`, so future implementations must preserve the public shape and behavior rather than merely compile.
- Observability export supports redacted JSONL, OpenTelemetry-ish, OpenInference/Phoenix-ish, and Langfuse-ish payloads from CLI and local server, plus HTTP push through configured export destinations.
- CLI exposes `approval`, `config`, `policy`, `provider`, `patterns`, `tools`, `conformance`, `store`, `backup restore`, and the previous runtime/tool/memory/wiki/replay/eval commands.
- Local server exposes health/readiness, config/provider/tool/policy control-plane APIs, runs, context snapshots, replay diff, conformance reports, sessions, approvals, guardrail scan/audit, artifacts, memory promotion, wiki, evals, code search, audit, store doctor/compact/prune/backup, export push, and trace export with token auth and response redaction.
- Studio now has a Vite/React UI served by the local Studio server, with panels for run timeline, context snapshots, tool calls, replay diff, conformance reports, approval approve/deny, guardrail scans, memory promotion, typed artifact inspection, wiki, evals, audit, store health, settings, backup, export push, compact, and retention prune dry-runs.
- Multi-agent orchestration now carries child artifact refs through the workflow blackboard, supports bounded `flow` parallelism, and can cancel pending tasks at workflow boundaries through `team cancel`.
- Evolution promotion is no longer test-only: prompt/policy/skill proposals can be promoted with snapshots and rolled back through CLI.
- Public-preview release materials are in place: MIT license, changelog, v0.1 release notes, contributing and security docs, GitHub issue/PR templates, a `pnpm agentbase` source CLI shortcut, and a Studio quick demo path.

## Still Not Claimed As Done

- Context ranking is still lexical/FTS-first; vector retrieval remains a later plugin.
