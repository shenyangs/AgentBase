# AgentBase v0.1 Release Notes

AgentBase v0.1 is the first public preview of the local runtime. It is meant to
be cloned, built, inspected, and extended by teams that want an agent runtime
contract instead of another one-off agent demo.

## Positioning

AgentBase is not a low-code canvas, a single coding agent, or a thin model
provider wrapper. It is a reusable local runtime for building agents with:

- append-only traces
- policy-first tool execution
- tool-result ref envelopes
- budget-planned context snapshots
- approval checkpoints
- deterministic replay
- eval-gated evolution
- local governance through CLI, server, and Studio

## What Is Ready

- A working `pnpm agentbase` source CLI after `pnpm build`.
- Five reference patterns that can be initialized and run locally.
- SQLite-backed local platform store with audit, approvals, artifacts, memory,
  wiki, evals, and code index.
- Standard tool packages with policy and trace coverage.
- Replay, eval, guardrail scan, conformance, export, and backup flows.
- Local Studio for inspecting runs, tool calls, context snapshots, artifacts,
  approvals, memory, wiki, evals, settings, conformance, and export push.

See [STATUS.md](../STATUS.md) for the explicit usable / preview /
experimental / planned capability matrix.

## What This Release Is Not

- It is not a hosted SaaS product.
- It is not a multi-tenant cloud control plane.
- It is not a published npm 1.0 package set.
- It does not claim vector retrieval as a built-in 1.0 capability.
- It does not claim policy checks or approvals are a strong sandbox.

## Quick Verification

```bash
pnpm install
pnpm build
pnpm test

pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase trace list --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

The release gate for maintainers is:

```bash
pnpm release:check
```

That expands to build, unit/integration tests, local-first E2E, reference
patterns, and conformance.

## Recommended First Issue Areas

- Improve first-agent creation UX.
- Add more reference patterns and fixtures.
- Harden provider-specific integration tests.
- Add optional vector retrieval as a 1.x plugin.
- Prepare npm package publishing metadata.
