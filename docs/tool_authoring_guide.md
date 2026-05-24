# Tool Authoring Guide

Custom AgentBase tools are part of the runtime contract. A tool is acceptable for production only when it is typed, policy-aware, traceable, bounded, and testable.

## Required Shape

Every tool must provide:

- `name`: stable snake_case identifier.
- `description`: short operational description.
- `inputSchema`: JSON schema for model-provided input.
- `requiredPermissions`: permission strings used by policy.
- `risk`: `low`, `medium`, or `high`.
- `execute(input, context)`: returns a `ToolResult`.

The result should follow the standard envelope:

```ts
{
  ok: true,
  output: {
    summary: "what happened",
    preview: "bounded human/model-readable preview",
    artifacts: [{ ref: "artifact://...", kind: "text" }],
    metadata: {
      durationMs: 42,
      truncated: false
    }
  },
  metadata: {
    durationMs: 42,
    truncated: false,
    risk: "low"
  }
}
```

Large outputs should be written to an artifact store, not returned directly into context.

## Policy Rules

Declare the narrowest permission possible:

- filesystem read/write: `fs:read`, `fs:write`
- shell: `shell:run`
- git mutation: `git:write`
- network: `network:http`
- browser: `browser:read`, `browser:interact`
- database: `database:read`, `database:write`
- MCP: `mcp:tool`
- code index: `code:index`

High-risk tools must be designed to survive rejection or approval pauses. Never perform irreversible work before the executor has checked policy.

## Trace Rules

The runtime emits `tool.started`, `tool.completed`, `tool.failed`, and `tool.rejected`. A tool may emit additional domain-specific trace events through `context.trace`, but those events must not contain secrets or unbounded payloads.

External content should be treated as untrusted evidence. Tool summaries can inform the model, but they must not claim authority over system, developer, or policy instructions.

## Secret Rules

Do not put raw credentials in config, trace, artifacts, or tool output. Configuration should store env var names such as `apiKeyEnv` or `connectionStringEnv`. Tool previews and metadata must redact authorization headers, cookies, API keys, passwords, and bearer tokens.

## Test Rules

Every production toolset should include:

- schema validation tests,
- policy allow/block tests,
- output envelope tests,
- redaction tests,
- timeout or truncation tests for large outputs,
- and at least one fixture-backed integration test.

Reference tools in this repo are expected to pass `pnpm test` and the runtime contract checks in `pnpm conformance`.

