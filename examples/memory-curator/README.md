# Memory Curator Reference Pattern

This pattern evaluates whether facts should become durable memory. It prefers scoped, sourced, non-secret, reusable memories and rejects transient tool output.

```bash
pnpm agentbase init /tmp/agentbase-memory-curator
cp -R ../../fixtures/memory-workspace/. /tmp/agentbase-memory-curator/
pnpm agentbase memory add "Project prefers eval-gated changes" --scope project --cwd /tmp/agentbase-memory-curator
pnpm agentbase run "curate project memory" --mock --cwd /tmp/agentbase-memory-curator
```
