import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSeedManifest, writeSeedAsset } from "./index";

describe("seed assets", () => {
  it("creates and upgrades unchanged managed files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentbase-assets-"));
    const created = await writeSeedAsset({ workspaceRoot: workspace, relativePath: "README.md", content: "v1\n", source: "test" });
    const updated = await writeSeedAsset({ workspaceRoot: workspace, relativePath: "README.md", content: "v2\n", source: "test" });

    expect(created.action).toBe("created");
    expect(updated.action).toBe("updated");
    expect(await readFile(path.join(workspace, "README.md"), "utf8")).toBe("v2\n");
    expect((await readSeedManifest(path.join(workspace, ".agentbase", "seed-manifest.json"))).assets).toHaveLength(1);
  });

  it("preserves user modified files unless force is explicit", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentbase-assets-"));
    await writeSeedAsset({ workspaceRoot: workspace, relativePath: "README.md", content: "seed\n", source: "test" });
    await writeFile(path.join(workspace, "README.md"), "user edit\n", "utf8");

    const preserved = await writeSeedAsset({ workspaceRoot: workspace, relativePath: "README.md", content: "seed v2\n", source: "test" });
    const overwritten = await writeSeedAsset({ workspaceRoot: workspace, relativePath: "README.md", content: "seed v3\n", source: "test", force: true });

    expect(preserved.action).toBe("preserved");
    expect(overwritten.action).toBe("overwritten");
    expect(await readFile(path.join(workspace, "README.md"), "utf8")).toBe("seed v3\n");
  });
});
