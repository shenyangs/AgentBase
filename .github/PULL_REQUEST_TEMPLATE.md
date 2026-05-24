## Summary

Describe the change and why it belongs in AgentBase.

## Contract Impact

Check any affected areas:

- [ ] Runtime trace/events
- [ ] Tool schema/output envelope
- [ ] Policy/approval/guardrails
- [ ] Context snapshots
- [ ] Replay/eval/conformance
- [ ] Studio/server/CLI behavior
- [ ] Docs only

## Verification

```bash
pnpm build
pnpm test
```

For platform changes:

```bash
pnpm release:check
```
