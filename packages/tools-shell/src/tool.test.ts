import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeEventInput, TraceWriter } from "@agentbase/core";
import { resolveShellCwd } from "./path-guard";
import { createShellTool } from "./tool";

const trace: TraceWriter = {
  async write(input: RuntimeEventInput) {
    return { id: "evt", runId: "run", type: input.type, ts: new Date().toISOString(), data: input.data ?? {} };
  }
};

function toolContext(workspaceRoot: string) {
  return {
    runId: "run",
    workspaceRoot,
    signal: new AbortController().signal,
    trace,
    policy: { name: "developer" as const },
    env: {}
  };
}

describe("shell tool", () => {
  it("blocks cwd symlink escapes outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-shell-"));
    const outside = await mkdtemp(path.join(tmpdir(), "agentbase-outside-"));
    await symlink(outside, path.join(root, "outside-link"));

    await expect(resolveShellCwd(root, "outside-link")).rejects.toThrow(/escapes workspace/);
  });

  it("returns non-zero exits as observable command output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-shell-"));
    const result = await createShellTool().execute(
      { command: "node -e \"console.error('boom'); process.exit(7)\"", timeoutMs: 1000 },
      toolContext(root)
    );

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(
      expect.objectContaining({
        status: "command_failed",
        exitCode: 7,
        stderr: expect.stringContaining("boom")
      })
    );
  });

  it("returns timeouts as observable command output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-shell-"));
    const result = await createShellTool().execute(
      { command: "node -e \"setTimeout(() => {}, 1000)\"", timeoutMs: 20 },
      toolContext(root)
    );

    expect(result.ok).toBe(true);
    expect(result.output).toEqual(
      expect.objectContaining({
        status: "timed_out",
        exitCode: 1,
        timedOut: true,
        stderr: expect.stringContaining("Command timed out")
      })
    );
  });
});
