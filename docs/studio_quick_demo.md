# Studio Quick Demo

This path shows the governance UI without requiring a real model key.

## 1. Build and Create a Workspace

```bash
pnpm install
pnpm build
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase trace list --cwd /tmp/agentbase-demo
```

Copy the `runId` from `trace list`.

## 2. Generate Governance Data

```bash
pnpm agentbase replay run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase guardrail scan --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase store doctor --cwd /tmp/agentbase-demo
pnpm agentbase backup create --cwd /tmp/agentbase-demo
```

Optional reference-pattern data:

```bash
pnpm agentbase patterns run repo-analyst --target /tmp/agentbase-pattern-run
```

## 3. Start Studio

```bash
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

Open the printed local URL. In source-only builds, the Studio server also has a
plain HTML fallback.

## 4. What to Click

- Runs: inspect the latest run timeline and model/tool events.
- Context: inspect the budget-planned context snapshot.
- Artifacts: inspect typed artifact previews.
- Guardrails: scan the recorded run or custom text.
- Replay Diff: compare two run IDs after you have more than one run.
- Settings: inspect provider, policy, toolsets, exports, database, MCP, browser,
  HTTP, and code-index config.
- Store: run doctor/compact/backup/export-push operations.
- Conformance: read the latest local conformance reports after `pnpm conformance`.

## 5. Release Gate

For a full local confidence check:

```bash
pnpm release:check
```
