# AgentBase Doctrine

AgentBase is a runtime platform, not an agent demo. Its purpose is to make the repeated foundation of agent products reusable: execution, policy, context, tools, trace, replay, eval, memory, and governance.

## Position

Most teams building agents are rebuilding the same invisible harness: tool adapters, prompt assembly, path guards, trace logging, approval pauses, retry rules, eval scripts, and debugging UIs. That repeated work is waste. It also makes the ecosystem harder to inspect, compare, and trust.

AgentBase treats the harness as the product surface. The domain agent can be replaced; the runtime contract must stay legible.

## Non-Goals

AgentBase is not:

- a low-code canvas,
- a single coding agent,
- a prompt-template gallery,
- a provider wrapper,
- a cloud SaaS control plane,
- or a black-box learning loop.

It is a local-first runtime substrate that product teams and platform teams can embed, extend, test, and govern.

## Runtime Contract

AgentBase 1.0 is organized around seven contracts.

1. Append-only trace
   Every meaningful state transition is an event. Runs, tool calls, policy decisions, context snapshots, artifacts, approvals, evals, and config changes are recorded as facts rather than overwritten state.

2. Policy-first execution
   Tools declare permissions and risk. The executor checks policy before work starts, emits `policy.checked`, and either executes, rejects, or creates an approval checkpoint.

3. Guardrail-visible evidence
   Prompt injection, secret exfiltration, workspace escape, dangerous actions, and memory poisoning are scanned as explicit findings in CLI, eval, and conformance paths. Guardrails produce audit facts rather than hidden model-side intuition.

4. Tool result ref envelope
   Tools do not dump unbounded output directly into context. Results become artifact-backed envelopes with `summary`, `preview`, `artifacts`, and `metadata`, and the model sees refs plus fresh previews.

5. Context as planning
   Context assembly is not a string concatenation step. It is a budget planner across stable prefix, policy, tools, pinned memory, working set, wiki/code hits, artifact refs, and latest previews.

6. Approval checkpoint
   High-risk actions can pause the run. Approval is durable, auditable, resumable, and visible through CLI/API/Studio.

7. Eval-gated evolution
   Memory, prompt, tool, and policy improvements can be proposed from traces, but production promotion requires explicit review and eval evidence. Durable memory follows the same governance shape: proposal, review, optional eval result, promotion, and auditability.

## Governance Surfaces

The source of truth for local configuration is `.agentbase/config.json`. The `@agentbase/config` package owns loading, validation, redaction, patching, and provider checks so CLI, server, and Studio share one control plane.

Config mutations produce governance events:

- `config.updated`
- `provider.tested`
- `toolset.enabled`
- `toolset.disabled`
- `toolset.configured`
- `policy.updated`
- `guardrail.completed`
- `guardrail.scanned`
- `conformance.completed`

These events are mirrored into the audit log when SQLite is enabled.

## Industry Meaning

If AgentBase succeeds, open-source agent work shifts up a level. Teams stop competing on who can reimplement read/write/bash/grep, approval pauses, and trace viewers. They compete on domain memory, tool quality, workflow design, evaluation depth, and product taste.

That is the point: make the common runtime boring, inspectable, and dependable, so the interesting work can happen above it.
