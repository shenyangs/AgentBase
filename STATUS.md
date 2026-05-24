# AgentBase Status

AgentBase is a `v0.1.0 public preview / Local Runtime Preview`. It is useful as a
source-built agent runtime prototype, but it should not be presented as a
finished npm 1.0 platform yet.

This file separates what is usable today from what is still preview,
experimental, or planned. The intent is to make the project easier to trust:
developers should be able to tell which parts are verified and which parts are
still runtime research.

## Status Levels

- `Usable`: implemented, covered by tests or release gates, and safe to try from
  source in local workspaces.
- `Preview`: implemented enough to exercise the workflow, but the interface or
  UX may still change.
- `Experimental`: available for exploration, with limited depth, compatibility,
  or sandbox guarantees.
- `Planned`: intentionally not claimed as part of the current release.

## Release Posture

- The repository is source-first. The root package is still `"private": true`;
  npm publishing metadata is planned, not ready.
- The supported local path is `pnpm install`, `pnpm build`, and the source CLI
  through `pnpm agentbase`.
- Node.js `24+` and pnpm `11+` are required. This is a deliberate compatibility
  tradeoff because the local SQLite store uses `node:sqlite`.
- The strongest first use case is a local repo agent with trace, replay, eval,
  approvals, and Studio inspection. Broader platform claims should be treated as
  roadmap until backed by examples and tests.

## Capability Matrix

| Area | Status | Current Evidence | Notes |
| --- | --- | --- | --- |
| Core runtime loop | Usable | `packages/core`, runtime tests, conformance | Run state, max steps/time, checkpoints, approval pause/resume, cancellation, trace events. |
| Tool registry/executor | Usable | `packages/core`, contract tests | JSON Schema validation, policy check, approval request/reuse, retries, timeout guard, trace events. |
| Trace store/export | Usable | `packages/trace`, CLI/server tests, release gate | Append-only JSONL traces and redacted export formats. |
| Tool-result envelope | Usable | `packages/artifacts`, contract tests, conformance | Large outputs should become artifact-backed summaries/refs/previews. |
| Filesystem tools | Usable | `packages/tools-fs` tests | Workspace path guard is in place; symlink escape coverage is part of the test surface. |
| Git tools | Usable | `packages/tools-git` tests | Read-focused git inspection. Write/push workflows should remain approval-gated or out of scope. |
| Context planner | Usable | `packages/context-default` tests | Budgeted layers, snapshots, memory/wiki/code/artifact refs, untrusted evidence labeling. |
| Replay | Usable | `packages/replay` tests, CLI/server paths | Deterministic replay and diff are available for recorded traces. |
| Eval runner | Usable | `packages/evals` tests, examples | JSON/YAML suites with status, event, tool, latency, cost, and guardrail assertions. |
| Guardrails | Usable | `packages/guardrails` tests, conformance | Scans for prompt injection, secret exfiltration, workspace escape, dangerous actions, memory poisoning. |
| Reference patterns | Usable | `examples/*`, `pnpm references` | Repo analyst, test runner, research agent, tool designer, memory curator. |
| SQLite local store | Preview | `packages/stores-sqlite` tests | Local data layer for runs, events, artifacts, memory, wiki, evals, approvals, audit, backup. Schema may still evolve. |
| CLI | Preview | `packages/cli` tests, E2E | Broad command surface is available from source; first-run UX still needs polish. |
| Local server | Preview | `packages/server` tests | Single-tenant local API with token auth, redaction, settings, runs, approvals, artifacts, evals, export. |
| Studio | Preview | `packages/studio`, `packages/studio-ui` | Local governance UI for inspection and approval. Useful for demos; not a hardened product UI. |
| Memory governance | Preview | `packages/memory`, CLI/server tests | Proposal, review, promotion, and rollback flows exist; real-world curation examples need more proof. |
| Wiki/code index | Preview | `packages/wiki`, `packages/code-index` tests | Lexical/FTS-first project context, useful for local repositories. |
| Experience/capability ledger | Preview | `packages/experience`, `packages/capabilities` tests | Converts successful runs into reusable records; product semantics still emerging. |
| Multi-agent orchestration | Preview | `packages/orchestrator` tests | Workflow execution and approval resume exist; external developer ergonomics are still early. |
| Relay mailbox | Preview | `packages/relay` tests | Local async control plane for approvals, exports, evals, and handoffs. |
| OpenAI-compatible provider | Experimental | Provider tests | Minimal chat-completions adapter. Streaming, richer response formats, vendor-specific tool quirks, retries, and signal handling need hardening. |
| LiteLLM/AI SDK/Ollama providers | Experimental | Package implementations | Useful adapters, but not yet the main reliability claim. |
| Shell tool | Experimental | `packages/tools-shell` tests | Timeout/output limits and policy checks exist. Non-zero exit is returned as tool output because failed tests are useful evidence. Policy is not sandboxing. |
| HTTP/web tools | Experimental | Tool tests | Useful for local experiments; external content must stay untrusted evidence. |
| Browser tools | Experimental | Tool tests | Playwright/CDP workflows exist, but compatibility and isolation need more real-world runs. |
| Database tools | Experimental | Tool tests | Workspace-safe SQLite handling and policy gates exist; broader DB safety needs deployment guidance. |
| MCP integration | Experimental | `packages/mcp` tests | Manifest/loading/adaptation path exists; server compatibility matrix is still open. |
| Vector retrieval | Planned | Release notes | Not claimed in v0.1; lexical/FTS-first is the current route. |
| Hosted SaaS/control plane | Planned | Release notes | AgentBase is local-first in this release. |
| npm 1.0 packages | Planned | Release notes | Package publishing should come after metadata, compatibility, and stability boundaries are tighter. |

## Security Boundary

AgentBase currently provides local policy gates, approvals, trace/audit facts,
redaction, and workspace path guards. These are governance controls.

They are not a strong sandbox. In particular:

- shell policy checks are pattern-based and should be treated as a guardrail, not
  process isolation;
- browser, HTTP, database, and MCP tools may touch external or user-controlled
  systems when configured;
- untrusted web/tool/database content must enter context as evidence and cannot
  override system, developer, or policy instructions;
- stronger isolation should use containers, dedicated OS users, network
  restrictions, or platform sandboxes.

## Best v0.1 Demo Path

The clearest public demo should stay narrow:

```bash
pnpm install
pnpm build
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase provider set mock --model mock/repo-analyst --cwd /tmp/agentbase-demo
pnpm agentbase run "analyze this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase trace show <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

The story to prove first is: a local repo agent can run, leave an auditable trace,
pause for approval, resume deterministically, run evals, and show the result in
Studio.
