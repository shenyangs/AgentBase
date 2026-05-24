import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonExperienceLedger } from "./index";

describe("JsonExperienceLedger", () => {
  it("stores events, atoms, and lessons as reusable experience assets", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentbase-experience-"));
    const ledger = new JsonExperienceLedger({ file: path.join(workspace, "ledger.json") });
    const event = await ledger.addEvent({ runId: "run_1", type: "task", summary: "Repo analysis succeeded." });
    const atom = await ledger.addAtom({ eventIds: [event.id], title: "Use trace evidence", statement: "Repo summaries should cite inspected files.", tags: ["repo"] });
    const lesson = await ledger.addLesson({ atomIds: [atom.id], title: "Evidence-backed summaries", guidance: "Prefer file-backed claims over generic summaries." });

    expect(await ledger.listEvents({ runId: "run_1" })).toHaveLength(1);
    expect(await ledger.listAtoms({ tag: "repo" })).toHaveLength(1);
    expect((await ledger.listLessons({ status: "draft" }))[0]?.id).toBe(lesson.id);
  });
});
