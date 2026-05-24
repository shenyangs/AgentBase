# Changelog

All notable changes to AgentBase will be documented in this file.

## 0.1.0 - Local-First 1.0 RC

This first public preview is a source-distributed release candidate for the
local-first AgentBase runtime platform.

### Added

- Runtime loop with durable trace events, context snapshots, approval-aware
  state, resume checkpoints, and tool execution boundaries.
- Local SQLite platform store for runs, sessions, artifacts, memory, wiki,
  evals, code index, approvals, and audit records.
- Standard toolsets for filesystem, shell, git, web/search, HTTP, browser,
  database, MCP, code index, and artifact materialization.
- Provider adapters for mock, OpenAI-compatible, LiteLLM, AI SDK-like
  functions, and Ollama-compatible endpoints.
- Eval, replay, guardrail scan, export, conformance, and reference-pattern
  gates for product-grade agent iteration.
- Local Studio and server surfaces for run timeline, context snapshots,
  approvals, artifacts, memory, wiki, evals, settings, export push, and
  conformance reports.
- Five reference patterns: repo analyst, test runner, research agent, tool
  designer, and memory curator.

### Release Status

- Supported distribution: clone the repository, install with pnpm, build, and
  run the local CLI through `pnpm agentbase`.
- Not yet claimed as npm 1.0: package publish metadata and registry release
  automation are intentionally left for a later release.
- Post-1.0 plugin direction: vector retrieval.
