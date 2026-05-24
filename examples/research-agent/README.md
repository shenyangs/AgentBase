# Research Agent Reference Pattern

This pattern keeps retrieved material as untrusted evidence and separates source notes from final synthesis.

```bash
pnpm agentbase init /tmp/agentbase-research
cp -R ../../fixtures/research-corpus/. /tmp/agentbase-research/
pnpm agentbase tools enable @agentbase/tools-web --cwd /tmp/agentbase-research
pnpm agentbase run "research the local corpus" --mock --cwd /tmp/agentbase-research
```
