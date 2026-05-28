# Workspace Cockpit

AgentBase now treats a workspace as the durable boundary for agent assets, not only as a `--cwd`.

A workspace collects:

- config and policy
- enabled toolsets
- provider route defaults
- runs and approvals
- memory proposals and promoted memories
- wiki/code-index assets
- experience and capability records
- relay/inbox background tasks

```bash
pnpm agentbase workspace show --cwd ./my-agent
pnpm agentbase workspace doctor --cwd ./my-agent
pnpm agentbase workspace assets --cwd ./my-agent
```

Studio reads the same `/api/workspace` contract to render the Workspace Cockpit. This is the clean-room AgentBase version of the "project space" lesson from long-running agent products: every product agent needs an asset boundary that can be inspected, moved, backed up, and governed.

