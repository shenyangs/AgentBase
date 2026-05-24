import { createMockModelProvider } from "../packages/core/dist/index.js";
import {
  assertContractReport,
  runContractSuite,
  validateProviderContract,
  validateToolContract,
  validateToolResultEnvelope,
  validateWorkflowResultContract
} from "../packages/contracts/dist/index.js";
import { createCodeIndexTools } from "../packages/code-index/dist/index.js";
import { createMemoryTools, JsonMemoryStore } from "../packages/memory/dist/index.js";
import { createFsTools } from "../packages/tools-fs/dist/index.js";
import { createGitTools } from "../packages/tools-git/dist/index.js";
import { createHttpTools } from "../packages/tools-http/dist/index.js";
import { createShellTool } from "../packages/tools-shell/dist/index.js";
import { createStaticSearchProvider, createWebTools } from "../packages/tools-web/dist/index.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspace = await mkdtemp(path.join(os.tmpdir(), "agentbase-contracts-"));
const memory = new JsonMemoryStore({ file: path.join(workspace, "memory.json") });
const tools = [
  ...createFsTools(),
  createShellTool(),
  ...createGitTools(),
  ...createWebTools({ searchProvider: createStaticSearchProvider([{ title: "AgentBase", url: "https://example.test", snippet: "runtime contract" }]) }),
  ...createHttpTools(),
  ...createCodeIndexTools({ workspaceRoot: workspace }),
  ...createMemoryTools(memory)
];

const reports = [
  validateProviderContract(createMockModelProvider()),
  ...tools.map((tool) => validateToolContract(tool)),
  validateToolResultEnvelope({
    ok: true,
    ref: "artifact://contract/tool-result",
    toolCallId: "call_contract",
    toolName: "read_file",
    summary: "contract envelope",
    preview: "contract envelope",
    artifacts: [],
    metadata: { durationMs: 0, truncated: false, risk: "low" }
  }),
  validateWorkflowResultContract({
    workflow: "contract",
    status: "completed",
    assignments: [{ taskId: "task_contract", agent: "contract-agent", status: "completed", artifactRefs: [] }],
    handoffs: []
  })
];

const suite = runContractSuite(reports);
assertContractReport(suite);
console.log(
  JSON.stringify(
    {
      ok: suite.ok,
      providers: 1,
      tools: tools.length,
      reports: reports.length
    },
    null,
    2
  )
);
