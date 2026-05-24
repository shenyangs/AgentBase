# Build Your First Agent

This guide is for people who want to make an AgentBase agent without touching
runtime internals.

## 1. Pick the Closest Pattern

```bash
pnpm install
pnpm build
pnpm agentbase patterns list
```

Good defaults:

- Use `repo-analyst` for repository inspection.
- Use `test-runner` for running commands and summarizing failures.
- Use `research-agent` for sourced synthesis.
- Use `tool-designer` for designing tool contracts.
- Use `memory-curator` for durable memory workflows.

## 2. Initialize a Workspace

```bash
pnpm agentbase patterns init repo-analyst /tmp/my-agent
```

This creates:

- `.agentbase/config.json`
- `.agentbase/agent.json`
- `.agentbase/evals/repo-analyst.yaml`
- a pattern README

## 3. Edit the Agent Spec

Open `/tmp/my-agent/.agentbase/agent.json`.

Change:

- `name`
- `instructions`
- `defaultTools`

Start small. A useful first custom agent usually needs filesystem reads, search,
and maybe git status. Add shell, browser, database, HTTP, or MCP tools only when
the task really needs them.

## 4. Run with the Mock Provider

```bash
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/my-agent
pnpm agentbase trace list --cwd /tmp/my-agent
pnpm agentbase trace show <run-id> --cwd /tmp/my-agent
```

The mock provider proves the runtime, tools, context, trace, and eval wiring
before you add a real model key.

## 5. Add a Small Eval

Edit the generated eval file in `.agentbase/evals/`. Keep the first suite tiny:

- expected run status
- required trace events
- forbidden high-risk guardrail findings
- one or two output expectations

Run it:

```bash
pnpm agentbase eval run --suite /tmp/my-agent/.agentbase/evals/repo-analyst.yaml --run <run-id> --cwd /tmp/my-agent
```

## 6. Inspect in Studio

```bash
pnpm agentbase studio --cwd /tmp/my-agent
```

Use Studio to inspect:

- run timeline
- context snapshot
- tool calls
- artifacts
- guardrail scan
- eval report

## 7. Prompt for Codex

If you are using Codex, paste this after cloning and building the repository:

```txt
Use AgentBase from this repository. Create a new agent workspace for this goal:
<describe my goal>. Start from the closest reference pattern, edit
.agentbase/agent.json, choose the safest default tools, add a minimal eval
suite, run it with --mock, inspect the trace, and tell me the smallest next
change to improve it.
```
