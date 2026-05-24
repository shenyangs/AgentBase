# Repo Analyst Reference Pattern

This pattern demonstrates the default AgentBase loop: inspect files, keep tool results behind refs, build a grounded repository summary, and leave a replayable trace.

```bash
pnpm agentbase init /tmp/agentbase-repo-analyst
cp -R ../../fixtures/small-repo/. /tmp/agentbase-repo-analyst/
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-repo-analyst
pnpm agentbase eval run --suite ./examples/repo-analyst/eval.yaml --run <run-id> --cwd /tmp/agentbase-repo-analyst
```
