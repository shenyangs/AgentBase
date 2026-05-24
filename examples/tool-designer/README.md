# Tool Designer Reference Pattern

This pattern turns a requested capability into an AgentBase-compatible tool contract: schema, permissions, risk, envelope, trace behavior, and tests.

```bash
pnpm agentbase init /tmp/agentbase-tool-designer
cp -R ../../fixtures/tool-design-request/. /tmp/agentbase-tool-designer/
pnpm agentbase run "design this tool" --mock --cwd /tmp/agentbase-tool-designer
```
