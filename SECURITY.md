# Security Policy

AgentBase is local-first software. It can read files, run tools, open browser
sessions, query databases, and call provider endpoints when configured to do
so. Treat workspace configuration as sensitive.

## Supported Version

The current public preview line is `0.1.x`.

## Reporting a Vulnerability

Until a dedicated security contact is published, please open a private report
or contact the maintainers through the project host. Do not include real
secrets, tokens, or private workspace data in public issues.

## Security Expectations

- Raw API keys and database connection strings should not be committed.
- Config files should store env var names such as `apiKeyEnv`, not raw values.
- Tool outputs must be bounded and should use artifact refs for large content.
- High-risk shell, git, browser, database, network, and MCP actions should be
  policy checked and auditable.
- Untrusted external content should enter context as evidence, not as higher
  priority instructions.

Policy checks, approvals, redaction, trace/audit facts, and workspace path guards
are governance controls. They are not a strong sandbox. Shell policy is
pattern-based; stronger isolation needs containers, dedicated OS users, network
restrictions, or OS/platform sandboxing.

## Local Hardening Tips

- Start with mock provider runs.
- Use `read-only` policy until a workflow needs writes.
- Run `pnpm agentbase guardrail scan --run <run-id> --cwd <workspace>` after
  testing workflows that touch external content.
- Use `pnpm agentbase store doctor --cwd <workspace>` before relying on a
  workspace for longer-lived experiments.
