# Plugin Lifecycle Hooks

AgentBase exposes a lifecycle hook contract so plugins can attach to runtime phases without becoming hidden side effects.

Hook points:

- `BeforeRun`
- `BeforeContext`
- `BeforeModel`
- `BeforeTool`
- `AfterTool`
- `AfterRun`
- `OnApprovalRequired`

Every hook manifest declares permissions, risk, timeout, schema, and whether it is blocking:

```json
{
  "name": "before-tool-audit",
  "version": "0.1.0",
  "hook": "BeforeTool",
  "permissions": ["fs:read"],
  "risk": "low",
  "timeoutMs": 1000,
  "blocking": false,
  "inputSchema": { "type": "object" }
}
```

Hook execution must write `hook.started`, `hook.completed`, or `hook.failed`. High-risk hooks go through policy checks. Non-blocking hook failures should be visible in trace but should not break the main run.

