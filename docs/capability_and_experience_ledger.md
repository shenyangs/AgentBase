# Capability and Experience Ledger

AgentBase absorbs one important product lesson from long-running agent systems: a successful task should not disappear into a trace file. It should be possible to turn it into reusable experience, and eventually into a reusable capability.

The v0.1 runtime contract now separates three layers:

```text
Run / Trace -> Experience Event -> Experience Atom -> Experience Lesson
Run / Trace -> Capability Draft -> Capability -> Capability Run
```

## Experience Ledger

The experience ledger is a small, auditable store for reusable learning:

- `ExperienceEvent`: something happened, usually backed by a run, tool call, approval, eval, or user feedback.
- `ExperienceAtom`: a compact statement extracted from one or more events.
- `ExperienceLesson`: reviewed guidance that can later feed memory, prompts, eval cases, or reference patterns.

This keeps memory from becoming a dumping ground. Raw events stay raw; atoms are explicit abstractions; lessons are reviewed guidance.

CLI:

```bash
pnpm agentbase experience event "Repo analysis succeeded" --run <run-id> --cwd ./my-agent
pnpm agentbase experience atom "Evidence backed summaries" --statement "Summaries should cite inspected files." --events <event-id> --cwd ./my-agent
pnpm agentbase experience lesson "Cite inspected files" --guidance "Prefer file-backed claims." --atoms <atom-id> --cwd ./my-agent
pnpm agentbase experience list lessons --cwd ./my-agent
```

Default local store:

```text
.agentbase/experience/ledger.json
```

## Capability Assets

A capability is a reusable unit of work derived from a successful task. It is more concrete than a vague memory, and lighter than a full agent product.

- `CapabilityDraft`: a proposal extracted from a run.
- `Capability`: a promoted, reusable instruction/tool recipe.
- `CapabilityRun`: a later use of that capability.

CLI:

```bash
pnpm agentbase capability draft <run-id> --title "Repo analyst" --summary "Analyze repos with trace evidence." --tools list_files,read_file --cwd ./my-agent
pnpm agentbase capability promote <draft-id> --instructions "Analyze repositories with evidence." --cwd ./my-agent
pnpm agentbase capability list --cwd ./my-agent
```

Default local store:

```text
.agentbase/capabilities/capabilities.json
```

## Why This Matters

Trace, replay, and eval make agent behavior understandable. The experience ledger and capability store make that behavior accumulative.

The goal is to create a clear ladder:

```text
observed work -> explicit abstraction -> reviewed guidance -> reusable capability
```

That keeps AgentBase aligned with its core philosophy: agent systems should be local-first, auditable, replayable, and able to improve without hiding changes from the developer.
