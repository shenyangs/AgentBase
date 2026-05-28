# White-Box Memory

AgentBase memory is intentionally visible and reviewable.

The durable path is:

```text
trace/run evidence -> memory curate/propose -> review/eval -> promote -> lineage/usage -> supersede
```

Useful commands:

```bash
pnpm agentbase memory curate --run <run-id> --cwd ./my-agent
pnpm agentbase memory proposals --cwd ./my-agent
pnpm agentbase memory review <proposal-id> --approve --cwd ./my-agent
pnpm agentbase memory promote-proposal <proposal-id> --cwd ./my-agent
pnpm agentbase memory lineage <memory-or-proposal-id> --cwd ./my-agent
pnpm agentbase memory supersede <memory-id> --by <replacement-id> --cwd ./my-agent
```

`memory curate` drafts a proposal from trace evidence. It never writes long-term memory directly. Promotion remains auditable and reversible by marking old lineage as superseded rather than deleting history.

