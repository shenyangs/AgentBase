# Studio Frontend

AgentBase Studio is the local governance frontend for a workspace. It is built
around inspection, approval, replay, eval evidence, and runtime settings. A
developer or product team uses it to see what happened during a run, why the
runtime made a decision, and whether a change is safe enough to keep.

## What Users See

The current Studio layout is a two-pane local web app.

```text
Left sidebar                  Main workspace
--------------------------    ----------------------------------------------
AgentBase Studio              Selected run summary
Search memory/wiki            Events / Model / Tools / Context counters
Runs list                     Tabs:
                              Timeline | Context | Tool Calls | Approvals
                              Memory | Memory Gate | Wiki | Artifacts
                              Evals | Patterns | Replay Diff | Conformance
                              Guardrails | Audit | Store | Settings
```

The first screen is run-centric. A user selects a run in the sidebar, then opens
panels that explain the run from different angles.

## Core Panels

- `Timeline`: append-only runtime events in order, with expandable payloads.
- `Context`: latest context snapshot, now rendered as context layers plus raw
  items. The layer cards show stable prefix, memory, wiki/code, artifacts,
  working set, and dynamic suffix.
- `Tool Calls`: policy checks, started/completed/failed tool events, and bounded
  output previews.
- `Approvals`: pending approval requests with approve/deny actions.
- `Artifacts`: typed artifact list and viewer for text, HTML, tool results, and
  database-shaped records.
- `Memory Gate`: proposal, review, and promotion flow for durable memory.
- `Patterns`: reference pattern catalog and recent pattern run reports.
- `Replay Diff`: read-only comparison between two recorded runs.
- `Conformance`: local contract reports from the release/conformance gate.
- `Guardrails`: run or text scans for prompt injection, secrets, workspace
  escape, dangerous actions, and memory poisoning.
- `Store`: SQLite doctor, compact, backup, retention prune, and export push.
- `Settings`: provider, policy, toolsets, HTTP/browser/database/MCP/code-index,
  and export configuration.

## Current Product Feel

The UI feels like a local observability and governance console:

- dense, work-focused, and built for repeated inspection;
- useful after at least one run exists;
- strongest for debugging, approval, memory review, eval evidence, and trace
  interpretation;
- less polished as a first-run onboarding product.

That is intentional for the v0.1 public preview. AgentBase is proving the
runtime contract first. A future product UI can sit on top of the same server
APIs and stores.

## Best Demo Flow

```bash
pnpm install
pnpm build
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase provider set mock --model mock/repo-analyst --cwd /tmp/agentbase-demo
pnpm agentbase run "analyze this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase guardrail scan --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase store doctor --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

Open the printed local URL. The most useful first clicks are:

1. `Timeline` to see the ordered runtime facts.
2. `Context` to see what the model saw and how context was layered.
3. `Tool Calls` to see policy checks and tool outputs.
4. `Artifacts` to inspect stored tool-result refs.
5. `Guardrails` and `Evals` to see whether the run is safe and testable.

## Current Boundary

Studio is currently a local runtime cockpit. It shows the facts that make an
agent run explainable, governable, and debuggable. A more guided builder,
hosted sharing, or canvas-style product surface can build on top of the same
server APIs later.
