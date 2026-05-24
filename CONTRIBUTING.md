# Contributing to AgentBase

Thanks for taking a look at AgentBase. The project is early, but the bar is
already higher than a demo: new work should preserve the runtime contract.

## Local Setup

```bash
pnpm install
pnpm build
pnpm test
```

Run the local CLI through the source script:

```bash
pnpm agentbase --help
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
```

## Release Gate

Before proposing a release-level change, run:

```bash
pnpm release:check
```

That expands to:

```bash
pnpm build
pnpm test
pnpm e2e
pnpm references
pnpm conformance
```

## Runtime Contract

Changes should preserve these contracts:

- runs emit append-only trace events,
- tools expose schemas, permissions, risk, and output envelopes,
- dangerous actions pass through policy and approval when required,
- model-visible tool output should use refs and bounded previews,
- context assembly should produce auditable snapshots,
- replay/eval/conformance should catch regressions,
- secrets must be redacted from traces, audit logs, server responses, and UI.

## Adding a Tool

Start with [Tool Authoring Guide](docs/tool_authoring_guide.md). A tool should
ship with schema validation, policy permissions, trace events, bounded output,
artifact refs for large payloads, and tests.

## Adding a Reference Pattern

Reference patterns are executable product shapes, not loose examples. See
[Reference Patterns](docs/reference_patterns.md). Each pattern should include:

- `agent.json`
- `eval.yaml`
- a README
- a fixture
- a manifest entry
- a passing `pnpm references` run

## Pull Request Checklist

- The change has a focused scope.
- Tests cover the affected contract.
- Documentation is updated when user-facing behavior changes.
- `pnpm build` and `pnpm test` pass locally.
- For runtime/platform changes, `pnpm release:check` passes.
