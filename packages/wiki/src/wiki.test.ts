import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RepoWiki } from "./index";

describe("RepoWiki", () => {
  it("indexes and queries repo files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentbase-wiki-"));
    await writeFile(path.join(root, "README.md"), "# Demo\n\nAgent runtime platform.", "utf8");
    const wiki = new RepoWiki({ workspaceRoot: root, dir: path.join(root, ".agentbase/wiki") });
    await wiki.index();
    expect((await wiki.query("runtime"))[0].path).toBe("README.md");
  });
});
