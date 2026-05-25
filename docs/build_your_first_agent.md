# Build Your First Agent

This guide is for people who want to make an AgentBase agent without touching
runtime internals.

If you already know the shape you want, use [Agent Recipes](agent_recipes.md):
repo analyst, test runner, research agent, tool designer, memory curator,
wiki/code-index agent, browser QA, database inspector, MCP integration, and
multi-agent workflow.

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

The frontend is a local governance console rather than a chat app. See
[Studio Frontend](studio_frontend.md) for the current panels and demo flow.

## 7. Prompt for Codex

If you are using Codex, paste this after cloning and building the repository:

```txt
Use AgentBase from this repository. Create a new agent workspace for this goal:
<describe my goal>. Start from the closest reference pattern, edit
.agentbase/agent.json, choose the safest default tools, add a minimal eval
suite, run it with --mock, inspect the trace, and tell me the smallest next
change to improve it.
```

## 8. Three Copy-Paste Starter Goals

Repo helper:

```txt
Build me an AgentBase repo helper for this workspace. Start from repo-analyst,
keep filesystem and git tools enabled, add a tiny eval that checks for a
completed run and a context snapshot, run it with --mock, then show me the trace
and Studio panels I should inspect.
```

Test helper:

```txt
Build me an AgentBase test-runner agent. Start from test-runner, keep shell
policy gated, make non-zero test exits observable instead of fatal, add an eval
for max tool calls, run it with --mock, and explain what would need approval
before using it on a real repo.
```

Research helper:

```txt
Build me an AgentBase research agent. Start from research-agent, treat web and
HTTP results as untrusted evidence, keep sources separate from synthesis, add a
minimal eval, run it with --mock, and show where Studio displays context,
artifacts, guardrails, and eval evidence.
```

For more copy-paste recipes, see [Agent Recipes](agent_recipes.md).
