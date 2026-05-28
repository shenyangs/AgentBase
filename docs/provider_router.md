# Provider Router

Provider routing turns model choice into an explainable policy decision.

Configuration can keep the existing single `provider` while adding optional route rules:

```json
{
  "providers": {
    "default": "mock",
    "routes": [
      {
        "id": "low-risk-local",
        "provider": "mock",
        "model": "mock/repo-analyst",
        "match": { "risk": "low" },
        "reason": "Use deterministic local provider for low-risk development."
      }
    ],
    "fallbacks": ["mock"]
  }
}
```

CLI:

```bash
pnpm agentbase provider route test "summarize this repo" --cwd ./my-agent
pnpm agentbase provider costs --run <run-id> --cwd ./my-agent
```

The route decision is recorded as `provider.route.checked` / `provider.route.selected`, so Studio and conformance can explain why a provider was selected.

