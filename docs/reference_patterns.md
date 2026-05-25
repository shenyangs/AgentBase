# Reference Patterns

AgentBase reference patterns are not demos. They are small, executable templates for common agent product shapes. Each pattern includes an agent spec, eval suite, fixture, required toolsets, and README so downstream teams can copy the runtime contract instead of copying incidental code.

The manifest is [examples/reference-patterns.json](../examples/reference-patterns.json). Runtime code should read it through `@agentbase/patterns` instead of hand-parsing the file; CLI, server, and Studio all use that package as the shared contract.

For task-oriented tutorials that explain how to turn these patterns into real
agents, see [Agent Recipes](agent_recipes.md).

## Patterns

- `repo-analyst`: inspect a repository with file/git/code-index evidence and produce a grounded summary.
- `test-runner`: run tests through policy-gated shell execution and summarize diagnostics.
- `research-agent`: separate untrusted evidence from synthesis and preserve source references.
- `tool-designer`: design tools as schema, permissions, risk, envelope, trace, and tests.
- `memory-curator`: promote memory conservatively through proposal, review, optional eval evidence, scope, source, durability, and secret checks.

## Validation

Reference patterns are validated by:

```bash
pnpm references
pnpm conformance
```

The CLI exposes the same catalog:

```bash
pnpm agentbase patterns list
pnpm agentbase patterns show repo-analyst
pnpm agentbase patterns init repo-analyst /tmp/agentbase-repo-analyst
pnpm agentbase patterns run repo-analyst --target /tmp/agentbase-repo-analyst-run
pnpm agentbase patterns run all --discard --json
pnpm agentbase patterns eval repo-analyst --cwd /tmp/agentbase-repo-analyst --run <run-id>
```

The local server and Studio expose the governance view:

```bash
GET /api/patterns
GET /api/patterns/:id
GET /api/pattern-reports
```

`GET /api/patterns` returns both the catalog and recent pattern run reports from `.agentbase/pattern-runs/*.json`, so a workspace can show which reference patterns have actually passed locally.

The reference check confirms:

- manifest entries are well-shaped,
- each pattern has `agent.json`, `eval.yaml`, `README.md`,
- each fixture directory exists and has a README,
- agent specs include `name`, `instructions`, and `defaultTools`,
- eval suites include `id` and at least one case.
- server and Studio can read the shared catalog and workspace pattern reports.

## Design Rule

Every new high-level agent pattern should be added here before it graduates into product docs. That keeps the platform honest: a claimed pattern must have a fixture, an eval, and a reusable agent contract.
