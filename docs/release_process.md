# Release Process

AgentBase v0.1 is a source-first public preview. The release process is built
around the local runtime contract rather than npm publishing.

## Local Release Check

Run:

```bash
pnpm release:check
```

This expands to:

```bash
pnpm build
pnpm test
pnpm e2e
pnpm references
pnpm conformance
```

## GitHub CI

The CI workflow runs the same release gate on pushes and pull requests:

```txt
.github/workflows/ci.yml
```

It uses Node 24 and pnpm 11 to match the repository metadata.

## Tagging a Source Release

After `pnpm release:check` passes:

```bash
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

The release workflow runs the release gate again and creates a GitHub release
using [v0.1 Release Notes](release_notes_v0.1.md).

## npm Publishing Status

This repository is not yet claiming npm 1.0 publishing. The root workspace is
private, and the first public release is intended to be cloned and run from
source through:

```bash
pnpm agentbase --help
```

Before npm publishing, each package should get final package metadata,
ownership decisions, README coverage, and package-level publish checks.
