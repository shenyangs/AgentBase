# Runtime Control Plane and Specialists

AgentBase now has first-version support for four patterns borrowed from long-running local agent products: relay mailbox, specialist manifests, context layers, and local runtime security.

## Relay Mailbox

The relay mailbox is a local message layer for work that enters or leaves the runtime: runs, team workflows, approvals, exports, evals, browser pairing, or external callbacks.

It gives these actions a shared state machine:

```text
queued -> delivered -> acknowledged
queued -> failed
queued -> cancelled
```

CLI:

```bash
pnpm agentbase relay send run '{"prompt":"summarize this repo"}' --run <run-id> --cwd ./my-agent
pnpm agentbase relay list --status queued --cwd ./my-agent
pnpm agentbase relay deliver <message-id> --cwd ./my-agent
pnpm agentbase relay ack <message-id> --cwd ./my-agent
```

Server API:

```text
GET  /api/relay
POST /api/relay
POST /api/relay/:id/deliver
POST /api/relay/:id/ack
POST /api/relay/:id/fail
POST /api/relay/:id/cancel
```

Default local store:

```text
.agentbase/relay/mailbox.json
```

## Specialist Manifest

AgentBase agents can now carry a `specialist` manifest. It describes when an agent should be selected, what handoffs it can receive, whether it needs fresh information, risk flags, and the expected result shape.

Core fields:

```ts
type SpecialistManifest = {
  name: string;
  role: string;
  trigger: {
    keywords?: string[];
    taskTypes?: string[];
    description?: string;
  };
  handoffTo?: string[];
  confidence?: number;
  needsFreshInfo?: boolean;
  riskFlags?: string[];
  result?: {
    format?: string;
    schema?: JsonSchema;
    examples?: string[];
  };
};
```

The orchestrator can use this manifest to choose a specialist when a task does not explicitly name an agent.

## Context Layers

Context snapshots now include `layers` in addition to raw `items`. This gives Studio, server APIs, and downstream tooling a stable way to explain context assembly.

Current layers:

- Stable Prefix
- Memory
- Wiki and Code
- Artifacts
- Working Set
- Dynamic Suffix

This turns context management into a visible planning artifact, not a hidden prompt string.

## Local Runtime Security

`@agentbase/server` exports `createLocalRuntimeSecurity()`. It creates a per-launch token, token hash, injected headers, local bind host, and CORS defaults.

Example:

```ts
const security = createLocalRuntimeSecurity();
const server = await startAgentBaseServer({
  sqliteFile,
  runtimeSecurity: security
});

await fetch(`${server.url}/health`, { headers: security.authHeaders });
```

The first version covers random local port, per-launch token, header injection, and redacted token hash. UDS and richer desktop pairing can build on this without changing the public shape.
