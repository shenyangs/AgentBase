import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeEventInput, TraceWriter } from "@agentbase/core";
import { resolveWorkspacePath } from "./path-guard";
import { createFsTools } from "./tools";

const trace: TraceWriter = {
  async write(input: RuntimeEventInput) {
    return { id: "evt", runId: "run", type: input.type, ts: new Date().toISOString(), data: input.data ?? {} };
  }
};

describe("tools-fs", () => {
  it("blocks paths outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-fs-"));
    await expect(resolveWorkspacePath(root, "../outside.txt")).rejects.toThrow(/escapes workspace/);
  });

  it("blocks symlink escapes outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-fs-"));
    const outside = await mkdtemp(path.join(tmpdir(), "agentbase-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "do not read", "utf8");
    await symlink(path.join(outside, "secret.txt"), path.join(root, "secret-link.txt"));

    await expect(resolveWorkspacePath(root, "secret-link.txt")).rejects.toThrow(/escapes workspace/);
  });

  it("refuses to write through workspace symlinks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-fs-"));
    const outside = await mkdtemp(path.join(tmpdir(), "agentbase-outside-"));
    const outsideFile = path.join(outside, "secret.txt");
    await writeFile(outsideFile, "original", "utf8");
    await symlink(outsideFile, path.join(root, "secret-link.txt"));
    const writeTool = createFsTools().find((tool) => tool.name === "write_file")!;
    const ctx = { runId: "run", workspaceRoot: root, signal: new AbortController().signal, trace, policy: { name: "workspace-write" as const }, env: {} };

    const result = await writeTool.execute({ path: "secret-link.txt", content: "changed" }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SYMLINK_WRITE_BLOCKED");
    expect(await readFile(outsideFile, "utf8")).toBe("original");
  });

  it("reads, writes, lists, and searches files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-fs-"));
    await writeFile(path.join(root, "README.md"), "hello agentbase", "utf8");
    const tools = createFsTools();
    const ctx = { runId: "run", workspaceRoot: root, signal: new AbortController().signal, trace, policy: { name: "workspace-write" as const }, env: {} };

    const read = await tools.find((tool) => tool.name === "read_file")!.execute({ path: "README.md" }, ctx);
    expect(read.ok).toBe(true);
    expect(JSON.stringify(read.output)).toContain("hello agentbase");

    const write = await tools.find((tool) => tool.name === "write_file")!.execute({ path: "notes.txt", content: "needle" }, ctx);
    expect(write.ok).toBe(true);
    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("needle");

    const list = await tools.find((tool) => tool.name === "list_files")!.execute({ path: "." }, ctx);
    expect(JSON.stringify(list.output)).toContain("README.md");

    const search = await tools.find((tool) => tool.name === "search_files")!.execute({ query: "needle" }, ctx);
    expect(JSON.stringify(search.output)).toContain("notes.txt");
  });
});
