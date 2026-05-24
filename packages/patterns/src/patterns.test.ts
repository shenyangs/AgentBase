import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeReferencePattern, getReferencePattern, listPatternRunReports, loadReferencePatternCatalog, validateReferencePatternCatalog } from "./index";

describe("reference patterns", () => {
  it("loads and validates the catalog contract", async () => {
    const catalog = await loadReferencePatternCatalog();
    expect(catalog.patterns.map((pattern) => pattern.id)).toEqual(expect.arrayContaining(["repo-analyst", "test-runner", "research-agent", "tool-designer", "memory-curator"]));
    const repoAnalyst = await describeReferencePattern(getReferencePattern(catalog, "repo-analyst"));
    expect(repoAnalyst.agentConfig).toEqual(expect.objectContaining({ name: "repo-analyst" }));
    expect(repoAnalyst.evalSuite).toEqual(expect.objectContaining({ id: "repo-analyst-reference" }));
    expect(await validateReferencePatternCatalog()).toEqual(expect.objectContaining({ ok: true, count: 5 }));
  });

  it("lists recent pattern run reports from a workspace", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "agentbase-patterns-"));
    const reportDir = path.join(workspace, ".agentbase", "pattern-runs");
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      path.join(reportDir, "repo-analyst-run_1.json"),
      JSON.stringify({
        ok: true,
        patternId: "repo-analyst",
        title: "Repo Analyst",
        workspace,
        prompt: "summarize this repo",
        runId: "run_1",
        reportFile: "",
        eval: { createdAt: "2026-05-21T00:00:00.000Z" },
        kept: true
      }),
      "utf8"
    );

    await expect(listPatternRunReports(workspace)).resolves.toEqual([expect.objectContaining({ patternId: "repo-analyst", runId: "run_1" })]);
  });
});
