# GitHub-Ready Checklist

Use this before making the repository public.

## Required

- `LICENSE` is present.
- `README.md` has a copy-paste quickstart.
- `CHANGELOG.md` describes the first preview.
- `docs/release_notes_v0.1.md` states what is and is not ready.
- `CONTRIBUTING.md` explains setup and the release gate.
- `SECURITY.md` explains how secrets and high-risk tools should be handled.
- Issue and PR templates exist under `.github/`.
- CI and GitHub release workflows exist under `.github/workflows/`.
- Root `package.json` exposes `pnpm agentbase` and `pnpm release:check`.
- Package metadata includes the MIT license.
- `pnpm release:check` passes.

## Recommended First Release Label

Use:

```txt
v0.1.0 public preview / Local-First 1.0 RC
```

This is honest: the source release is useful and runnable, while npm package
publishing and vector retrieval are still future work.

## Suggested GitHub Description

```txt
Local-first TypeScript agent runtime platform with traces, policy-gated tools,
context snapshots, replay/eval, memory/wiki, Studio, and conformance tests.
```

## Suggested First Release Notes

Point to [v0.1 Release Notes](release_notes_v0.1.md), then include:

```bash
pnpm install
pnpm build
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```
