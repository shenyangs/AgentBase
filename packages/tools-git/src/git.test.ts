import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { TraceWriter } from "@agentbase/core";
import { createGitTools } from "./index";

const execFileAsync = promisify(execFile);
const trace: TraceWriter = {
  async write(input) {
    return { id: "evt", runId: "run", type: input.type, ts: new Date().toISOString(), data: input.data ?? {} };
  }
};

describe("createGitTools", () => {
  it("reads git status and diff without mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-git-"));
    await execFileAsync("git", ["init"], { cwd: root });
    await writeFile(path.join(root, "README.md"), "hello\n", "utf8");

    const ctx = { runId: "run", workspaceRoot: root, signal: new AbortController().signal, trace, policy: { name: "read-only" as const }, env: {} };
    const tools = createGitTools();

    const status = await tools.find((tool) => tool.name === "git_status")!.execute({}, ctx);
    expect(status.ok).toBe(true);
    expect(JSON.stringify(status.output)).toContain("README.md");

    const diff = await tools.find((tool) => tool.name === "git_diff")!.execute({}, ctx);
    expect(diff.ok).toBe(true);
  });
});
