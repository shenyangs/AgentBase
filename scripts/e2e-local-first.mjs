import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const cli = path.join(root, "packages", "cli", "dist", "index.js");
const workspace = await mkdtemp(path.join(tmpdir(), "agentbase-e2e-"));
const receiverPayloads = [];
const receiver = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  receiverPayloads.push(Buffer.concat(chunks).toString("utf8"));
  res.statusCode = 200;
  res.end("ok");
});
await new Promise((resolve) => receiver.listen(0, resolve));
const receiverPort = receiver.address().port;

try {
  await run(["init", workspace]);
  const configFile = path.join(workspace, ".agentbase", "config.json");
  const config = JSON.parse(await readFile(configFile, "utf8"));
  config.exports = {
    destinations: [{ name: "local-observer", type: "generic-http", url: `http://127.0.0.1:${receiverPort}/ingest`, format: "openinference" }]
  };
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await run(["config", "doctor", "--cwd", workspace]);
  const runOutput = await run(["run", "summarize this repo", "--mock", "--cwd", workspace]);
  const runId = runOutput.match(/Run \w+: (run_[A-Za-z0-9_-]+)/)?.[1];
  if (!runId) {
    throw new Error(`Could not parse run id from:\n${runOutput}`);
  }

  await run(["trace", "list", "--cwd", workspace]);
  await run(["trace", "show", runId, "--cwd", workspace]);
  await run(["run", "--resume", runId, "--cwd", workspace]);
  await run(["replay", "run", runId, "--cwd", workspace]);
  await run(["export", "traces", "--format", "openinference", "--run", runId, "--cwd", workspace]);
  await run(["export", "push", "--target", "local-observer", "--run", runId, "--cwd", workspace]);
  if (!receiverPayloads[0]?.includes('"format": "openinference"')) {
    throw new Error("export push did not reach local observer");
  }
  const suiteFile = path.join(workspace, "agentbase.eval.yaml");
  await writeFile(
    suiteFile,
    [
      "id: local-first",
      "cases:",
      "  - id: repo-summary",
      "    input: summarize this repo",
      "    assertions:",
      "      - type: contains",
      "        value: Mock repo summary",
      "      - type: status_is",
      "        value: completed",
      "      - type: max_steps",
      "        value: 10",
      "      - type: event_exists",
      "        value: context.prepared",
      "      - type: event_exists",
      "        value: policy.checked",
      "      - type: event_absent",
      "        value: run.failed",
      "      - type: tool_sequence",
      "        value:",
      "          - list_files",
      "          - read_file",
      "      - type: guardrail_absent",
      "        value: all"
    ].join("\n"),
    "utf8"
  );
  await run(["eval", "run", "--suite", suiteFile, "--run", runId, "--cwd", workspace]);
  await run(["guardrail", "scan", "--run", runId, "--cwd", workspace]);
  const proposal = JSON.parse(await run(["evolve", "propose", runId, "--cwd", workspace]));
  await run(["evolve", "test", proposal.id, "--suite", suiteFile, "--run", runId, "--cwd", workspace]);
  const manualProposalFile = path.join(workspace, ".agentbase", "evolution", "proposals.json");
  const manualProposal = {
    id: "evo_prompt_e2e",
    kind: "prompt",
    title: "Update prompt",
    rationale: "e2e prompt promotion",
    patch: "You are an e2e-promoted agent.",
    status: "tested",
    createdAt: new Date().toISOString()
  };
  await writeFile(manualProposalFile, `${JSON.stringify([manualProposal], null, 2)}\n`, "utf8");
  await run(["evolve", "promote", manualProposal.id, "--cwd", workspace]);
  const promotions = JSON.parse(await readFile(path.join(workspace, ".agentbase", "evolution", "promotions.json"), "utf8"));
  await run(["evolve", "rollback", promotions[0].id, "--cwd", workspace]);
  await run(["memory", "add", "AgentBase e2e memory", "--cwd", workspace]);
  const memoryProposalOutput = await run(["memory", "propose", "AgentBase e2e reviewed memory", "--rationale", "e2e proposal gate", "--cwd", workspace]);
  const memoryProposalId = memoryProposalOutput.split("\t")[0];
  if (!memoryProposalId) {
    throw new Error(`Could not parse memory proposal id from:\n${memoryProposalOutput}`);
  }
  await run(["memory", "review", memoryProposalId, "--approve", "--cwd", workspace]);
  await run(["memory", "promote-proposal", memoryProposalId, "--cwd", workspace]);
  await run(["memory", "search", "e2e", "--cwd", workspace]);
  await run(["wiki", "index", "--cwd", workspace]);
  await run(["wiki", "query", "AgentBase", "--cwd", workspace]);
  await run(["team", "run", "summarize this repo", "--mock", "--cwd", workspace]);
  await run(["store", "doctor", "--cwd", workspace]);
  await run(["store", "compact", "--cwd", workspace]);
  await run(["store", "prune", "--cwd", workspace, "--days", "3650", "--keep-last", "10", "--dry-run"]);
  const backup = path.join(workspace, ".agentbase", "backups", "e2e.sqlite");
  await run(["backup", "create", "--cwd", workspace, "--out", backup]);
  await run(["backup", "restore", backup, "--cwd", workspace]);
  await run(["serve", "--cwd", workspace, "--once"]);
  await run(["studio", "--cwd", workspace, "--once"]);

  console.log(`AgentBase local-first e2e passed (${runId})`);
} finally {
  await new Promise((resolve, reject) => receiver.close((error) => (error ? reject(error) : resolve())));
  await rm(workspace, { recursive: true, force: true });
}

async function run(args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args], {
    cwd: root,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024
  });
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }
  return stdout;
}
