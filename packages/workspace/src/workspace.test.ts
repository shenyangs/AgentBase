import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultConfig } from "@agentbase/config";
import { describe, expect, it } from "vitest";
import { createWorkspaceManifest, doctorWorkspace, summarizeWorkspaceAssets } from "./index";

describe("workspace manifest", () => {
  it("summarizes isolated workspace assets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-workspace-"));
    await mkdir(path.join(root, ".agentbase/memory"), { recursive: true });
    await writeFile(path.join(root, ".agentbase/memory/memory.json"), JSON.stringify([{ id: "mem_1", scope: "project", text: "x", createdAt: "now", updatedAt: "now" }]));
    await writeFile(path.join(root, ".agentbase/memory/proposals.json"), JSON.stringify([{ id: "prop_1" }]));
    const config = defaultConfig("workspace-test");

    const assets = await summarizeWorkspaceAssets({ cwd: root, config, recentRuns: [{ runId: "run_1", status: "completed", startedAt: "now" }], pendingApprovals: 1 });
    const manifest = await createWorkspaceManifest({ cwd: root, config, recentRuns: [], pendingApprovals: 1 });
    const checks = await doctorWorkspace({ cwd: root, config });

    expect(assets.memories).toBe(1);
    expect(assets.memoryProposals).toBe(1);
    expect(manifest.assets.pendingApprovals).toBe(1);
    expect(checks.find((check) => check.name === "workspace root")?.ok).toBe(true);
  });
});
