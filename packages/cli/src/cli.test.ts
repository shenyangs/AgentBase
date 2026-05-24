import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./index";

describe("cli", () => {
  it("runs init, mock run, and trace commands", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "agentbase-cli-"));
    const output: string[] = [];
    const io = {
      stdout: (message: string) => output.push(message),
      stderr: (message: string) => output.push(message)
    };

    await main(["init", cwd], io);
    await writeFile(path.join(cwd, "README.md"), "# User README\n", "utf8");
    await main(["init", cwd], io);
    await main(["patterns", "list"], io);
    const patternCwd = await mkdtemp(path.join(tmpdir(), "agentbase-pattern-"));
    await main(["patterns", "init", "repo-analyst", patternCwd], io);
    await main(["patterns", "show", "repo-analyst"], io);
    await main(["config", "doctor", "--cwd", patternCwd], io);
    const patternRunCwd = await mkdtemp(path.join(tmpdir(), "agentbase-pattern-run-"));
    await main(["patterns", "run", "repo-analyst", "--target", patternRunCwd, "--json"], io);
    await main(["config", "doctor", "--cwd", cwd], io);
    await main(["memory", "propose", "Prefer reviewed memory promotion", "--cwd", cwd, "--rationale", "cli smoke"], io);
    const proposalId = output.at(-1)?.split("\t")[0] ?? "";
    await main(["memory", "proposals", "--cwd", cwd], io);
    await main(["memory", "review", proposalId, "--approve", "--cwd", cwd, "--reason", "safe"], io);
    await main(["memory", "promote-proposal", proposalId, "--cwd", cwd], io);
    await main(["memory", "search", "reviewed memory", "--cwd", cwd], io);
    await main(["run", "summarize this repo", "--mock", "--cwd", cwd], io);
    await main(["experience", "event", "Repo analysis succeeded", "--run", "run_fixture", "--cwd", cwd], io);
    const experienceEvent = JSON.parse(output.at(-1) ?? "{}") as { id?: string };
    await main(["experience", "atom", "Evidence backed summaries", "--statement", "Summaries should cite inspected files.", "--events", experienceEvent.id ?? "", "--tags", "repo", "--cwd", cwd], io);
    const experienceAtom = JSON.parse(output.at(-1) ?? "{}") as { id?: string };
    await main(["experience", "lesson", "Cite inspected files", "--guidance", "Prefer file-backed claims.", "--atoms", experienceAtom.id ?? "", "--cwd", cwd], io);
    await main(["experience", "list", "lessons", "--cwd", cwd], io);
    await main(["capability", "draft", "run_fixture", "--title", "Repo analyst capability", "--summary", "Analyze repos with trace evidence.", "--tools", "list_files,read_file", "--cwd", cwd], io);
    const capabilityDraft = JSON.parse(output.at(-1) ?? "{}") as { id?: string };
    await main(["capability", "promote", capabilityDraft.id ?? "", "--instructions", "Analyze repositories with evidence.", "--cwd", cwd], io);
    await main(["capability", "list", "--cwd", cwd], io);
    await main(["store", "doctor", "--cwd", cwd], io);
    await main(["approval", "list", "--cwd", cwd], io);
    await main(["trace", "list", "--cwd", cwd], io);

    const joined = output.join("\n");
    expect(joined).toContain("Initialized AgentBase project");
    expect(joined).toContain("repo-analyst");
    expect(joined).toContain('"patternId": "repo-analyst"');
    expect(await readFile(path.join(patternCwd, ".agentbase", "evals", "repo-analyst.yaml"), "utf8")).toContain("repo-analyst-reference");
    expect(await readFile(path.join(patternRunCwd, ".agentbase", "evals", "repo-analyst.yaml"), "utf8")).toContain("repo-analyst-reference");
    expect(joined).toContain('"ok": true');
    expect(joined).toContain("Prefer reviewed memory promotion");
    expect(joined).toContain("Repo analysis succeeded");
    expect(joined).toContain("Repo analyst capability");
    expect(joined).toContain("Mock repo summary");
    expect(joined).toContain("run_");
    expect(await readFile(path.join(cwd, "README.md"), "utf8")).toBe("# User README\n");
  });
});
