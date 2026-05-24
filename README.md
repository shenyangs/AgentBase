# AgentBase

Build agents without rebuilding the agent runtime.

AgentBase is a local-first TypeScript runtime platform for product-grade agents. The current implementation keeps the smallest useful loop intact and adds the platform bones around it:

```txt
CLI -> Runtime -> Context -> ModelProvider -> ToolCall -> ToolExecutor -> Trace
```

## Why AgentBase Matters

The open-source ecosystem has enough one-off agent demos. What is still missing is a reusable runtime contract: append-only traces, policy-first execution, tool result refs, budget-planned context, approval checkpoints, deterministic replay, and eval-gated evolution. AgentBase exists so teams can stop rebuilding the harness and compete on product judgment, domain tools, memory quality, and workflow design.

AgentBase is not a low-code canvas, a single coding agent, or a thin provider wrapper. It is the local-first substrate for building, governing, replaying, and extending agents.

## Release Status

This repository is currently a **v0.1 public preview / Local-First 1.0 release candidate**. It is ready to clone, build, run, inspect, and extend from source. It is not yet claimed as a published npm 1.0 package set.

Use the source CLI through:

```bash
pnpm agentbase --help
```

## Quickstart

Five-minute mock run:

```bash
pnpm install
pnpm build
pnpm test

pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase patterns list
pnpm agentbase patterns init repo-analyst /tmp/agentbase-pattern
pnpm agentbase patterns run repo-analyst --target /tmp/agentbase-pattern-run
pnpm agentbase config show --cwd /tmp/agentbase-demo
pnpm agentbase provider set mock --model mock/repo-analyst --cwd /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase trace list --cwd /tmp/agentbase-demo
```

Fifteen-minute local governance loop:

```bash
pnpm agentbase session list --cwd /tmp/agentbase-demo
pnpm agentbase policy show --cwd /tmp/agentbase-demo
pnpm agentbase tools inspect --cwd /tmp/agentbase-demo
pnpm agentbase tools enable @agentbase/tools-http --cwd /tmp/agentbase-demo
pnpm agentbase provider test --cwd /tmp/agentbase-demo
pnpm agentbase replay run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase run --resume <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase export traces --format openinference --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase export push --target local-observer --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase eval run --suite ./agentbase.eval.yaml --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase guardrail scan --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase memory propose "Prefer bounded tool previews" --scope project --cwd /tmp/agentbase-demo
pnpm agentbase memory review <proposal-id> --approve --cwd /tmp/agentbase-demo
pnpm agentbase memory promote-proposal <proposal-id> --cwd /tmp/agentbase-demo
pnpm agentbase evolve propose <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase evolve test <proposal-id> --suite ./agentbase.eval.yaml --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase evolve promote <proposal-id> --cwd /tmp/agentbase-demo
pnpm agentbase evolve rollback <promotion-id> --cwd /tmp/agentbase-demo
pnpm agentbase team run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase team cancel <workflow-run-id> --cwd /tmp/agentbase-demo
pnpm agentbase store doctor --cwd /tmp/agentbase-demo
pnpm agentbase backup create --cwd /tmp/agentbase-demo
pnpm agentbase serve --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

Production-style contract gate:

```bash
pnpm release:check
```

For a guided UI path, see [Studio Quick Demo](docs/studio_quick_demo.md).

If you are using Codex to create your first custom agent, give it this prompt after cloning and building:

```txt
Use AgentBase from this repository. Initialize a new workspace from the closest reference pattern, edit .agentbase/agent.json for my goal, choose safe default tools, add a small eval suite, run it with --mock, then show me the trace and what to change next.
```

For the manual path, see [Build Your First Agent](docs/build_your_first_agent.md).

## What You Get

- `@agentbase/core`: runtime loop, tool registry, tool executor, policy, approval-aware run state, mock provider.
- `@agentbase/config`: shared config control plane for load/validate/patch/redact/provider test, used by CLI, server, and Studio.
- `@agentbase/patterns`: shared reference pattern catalog, validators, path helpers, default prompts, and pattern run report reader.
- `@agentbase/artifacts`: file-backed artifact store and `materialize_ref` tool.
- `@agentbase/memory`: file-backed memory primitives and memory tools; SQLite projects use the platform store for durable memory plus proposal/review/eval/promotion governance.
- `@agentbase/wiki`: repo wiki indexer that can also write wiki summaries into memory.
- `@agentbase/replay`: trace loader, deterministic replay result, eval metadata extraction, and model/tool diffing.
- `@agentbase/stores-sqlite`: SQLite platform store for runs, sessions, events, artifacts, memory, wiki, evals, code index, approvals, and audit log.
- `@agentbase/server`: local single-tenant HTTP API over the SQLite platform store with token auth, readiness, approvals, guardrail scan/audit, context snapshots, replay diff, conformance reports, export push, memory promotion, store maintenance, audit, artifacts, and redaction.
- `@agentbase/evals`: JSON/YAML eval suite loader, assertion runner, and eval reports for output/status/steps/tool calls/latency/cost.
- `@agentbase/guardrails`: shared prompt-injection, secret, workspace-escape, dangerous-action, and memory-poisoning scanners for CLI, eval, and conformance gates.
- `@agentbase/orchestrator`: multi-agent workflow plan, runtime-backed executor, handoffs, blackboard, deterministic child runs, and default roles.
- `@agentbase/evolution`: eval-gated evolution proposal primitives.
- `@agentbase/provider-openai-compatible`: thin Chat Completions compatible model provider.
- `@agentbase/provider-litellm`: LiteLLM proxy adapter built on the compatible provider.
- `@agentbase/provider-ai-sdk`: adapter for AI SDK-like `generateText` functions.
- `@agentbase/provider-ollama`: local Ollama adapter via OpenAI-compatible endpoints.
- `@agentbase/trace`: JSONL trace store, secret redaction, and observability exporters for JSONL, OpenTelemetry-ish, OpenInference/Phoenix-ish, and Langfuse-ish JSON.
- `@agentbase/context-default`: budget-planned context assembly with stable prefix, pinned/relevant memory, wiki hits, code symbols, artifact refs, working set, and latest preview.
- `@agentbase/code-index`: local code index tools for symbols, references, outlines, and workspace indexing.
- `@agentbase/tools-fs`: workspace-safe read, write, list, and search tools.
- `@agentbase/tools-shell`: policy-checked shell execution.
- `@agentbase/tools-git`: read-only git status, diff, show, and log tools.
- `@agentbase/tools-web`: fetch and search tools backed by a pluggable SearchProvider.
- `@agentbase/tools-http`: policy-gated HTTP requests with redaction and artifact-backed bodies.
- `@agentbase/tools-browser`: Playwright-backed managed/CDP browser tools for snapshots and interaction.
- `@agentbase/tools-database`: SQLite/Postgres/MySQL database tools with read/write policy gates.
- `@agentbase/mcp`: MCP manifest, stdio/http tool loading, and AgentBase tool adaptation.
- `@agentbase/studio-ui`: Vite/React local governance UI for run timelines, context snapshots, tool calls, approval decisions, replay diff, conformance reports, guardrail scans, memory promotion/proposals, typed artifact inspection, wiki, evals, reference patterns, audit, store health, backups, compaction, export push, and retention dry-runs.
- `@agentbase/studio`: local Studio server that serves the React UI and platform API, including guardrail scan/audit, replay diff, conformance reports, and export push, with HTML fallback for source-only builds.
- `@agentbase/cli`: `init`, `run`, `session`, `approval`, `config`, `store`, `tools`, `provider`, `memory`, `wiki`, `replay`, `eval`, `guardrail`, `evolve`, `team`, `studio`, `serve`, `export`, `backup`, and `trace` commands, including `run --resume`, `team cancel`, `export push`, and `evolve rollback`.

## Reference Patterns

AgentBase includes five checked reference patterns: `repo-analyst`, `test-runner`, `research-agent`, `tool-designer`, and `memory-curator`. Each one has an agent spec, eval suite, README, fixture, and manifest entry so teams can copy a working runtime pattern instead of reverse-engineering a demo.

The catalog is available through CLI, SDK package, server API, and Studio: `GET /api/patterns` returns the catalog plus recent `.agentbase/pattern-runs/*.json` reports for the current workspace.

```bash
pnpm references
pnpm agentbase patterns list
pnpm agentbase patterns show test-runner
pnpm agentbase patterns init test-runner /tmp/agentbase-test-runner
pnpm agentbase patterns run test-runner --target /tmp/agentbase-test-runner-run
pnpm agentbase patterns eval test-runner --cwd /tmp/agentbase-test-runner --run <run-id>
```

See [Reference Patterns](docs/reference_patterns.md).

Tool results are represented as append-only ref envelopes in model-visible tool messages. The latest concrete preview is appended at the dynamic suffix so the stable prefix remains cache-friendly while the model still sees fresh evidence.

Context is assembled through a budget planner. The stable prefix stays cache-friendly, while memory, wiki, code index hits, artifacts, working set, and latest tool previews are separate auditable sections in the context snapshot. External/project-derived context is marked as untrusted evidence so it cannot override system, developer, or policy instructions.

## Platform Notes

SQLite is the default local store for new projects. It includes schema versioning, migration guards, integrity doctor, FTS-backed memory/wiki/code lookup, `store compact`, retention-aware `store prune`, and backup/restore. JSONL remains the portable trace export format.

High-risk tools emit `policy.checked` and `approval.required` trace events when blocked. Runtime runs can now enter `waiting_approval`; approval requests are persisted with pending and already-completed tool-call checkpoint state, then approved or denied through CLI/server before deterministic `run --resume`.

Multi-agent workflows run through the same runtime now. `team run` creates a parent workflow run, emits `workflow.*` and `agent.handoff` events, executes each task as a deterministic child run, and carries child artifact refs through the shared blackboard. Approval pauses and checkpoint resumes can continue without rerunning completed child tasks, and `team cancel` stops pending tasks at workflow boundaries.

Replay, eval, guardrails, and export now form a real regression and observability path: `replay run` reconstructs a deterministic replay result from recorded events, `eval run --suite --run` evaluates output, run metadata, required/forbidden trace events, tool sequences, and guardrail assertions, `guardrail scan --run` audits recorded events for injection/secret/escape/danger/memory-poisoning findings, `replay diff` compares model/tool changes, `export traces --format openinference|otel|langfuse|phoenix` emits redacted local JSON payloads, and `export push --target <name>` can post those payloads to a local or remote observer.

The self-evolution path is intentionally gated: proposals are produced as auditable artifacts, `evolve test --suite --run` attaches eval evidence, `evolve promote` writes auditable local changes with snapshots, and `evolve rollback` restores those snapshots. Durable memory has the same conservative path through `memory propose`, `memory review`, optional eval evidence, and `memory promote-proposal`; raw one-shot memory writes remain available for local experiments but are not the production governance path. The release gate is:

```bash
pnpm release:check
```

See [AgentBase Doctrine](docs/agentbase_doctrine.md), [Build Your First Agent](docs/build_your_first_agent.md), [Reference Patterns](docs/reference_patterns.md), [Studio Quick Demo](docs/studio_quick_demo.md), [Tool Authoring Guide](docs/tool_authoring_guide.md), [Release Notes](docs/release_notes_v0.1.md), [Release Process](docs/release_process.md), and [Contributing](CONTRIBUTING.md) for the runtime contract behind custom providers, tools, products, and governance surfaces.
