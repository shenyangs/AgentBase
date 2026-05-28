# Always-On Relay And Inbox

AgentBase relay is the local background-task control plane for work that enters or leaves the runtime.

It covers run, team workflow, approval, eval, export, memory curate, capability draft, browser, and external tasks.

State shape:

```text
queued -> running -> waiting_approval
queued/running -> delivered -> acknowledged
queued/running -> failed
queued/running -> cancelled
```

CLI:

```bash
pnpm agentbase relay send memory '{"runId":"run_123"}' --type memory_curate --cwd ./my-agent
pnpm agentbase inbox list --cwd ./my-agent
pnpm agentbase inbox show <task-id> --cwd ./my-agent
pnpm agentbase inbox retry <task-id> --cwd ./my-agent
pnpm agentbase inbox cancel <task-id> --cwd ./my-agent
```

The inbox is intentionally local-first: it is a durable mailbox, not a cloud push system.

