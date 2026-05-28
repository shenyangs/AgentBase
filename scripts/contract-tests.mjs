import { createMockModelProvider } from "../packages/core/dist/index.js";
import {
  assertContractReport,
  runContractSuite,
  validateContextSnapshotContract,
  validateLifecycleHookManifestContract,
  validateLocalRuntimeSecurityContract,
  validateProviderRouteDecisionContract,
  validateProviderContract,
  validateRelayMailboxContract,
  validateSpecialistManifestContract,
  validateToolContract,
  validateToolResultEnvelope,
  validateWorkspaceManifestContract,
  validateWorkflowResultContract
} from "../packages/contracts/dist/index.js";
import { createCodeIndexTools } from "../packages/code-index/dist/index.js";
import { createDefaultContextManager } from "../packages/context-default/dist/index.js";
import { createMemoryTools, JsonMemoryStore } from "../packages/memory/dist/index.js";
import { defaultAgentSpecs } from "../packages/orchestrator/dist/index.js";
import { routeProvider } from "../packages/provider-router/dist/index.js";
import { JsonRelayMailbox } from "../packages/relay/dist/index.js";
import { createLocalRuntimeSecurity } from "../packages/server/dist/index.js";
import { defaultConfig } from "../packages/config/dist/index.js";
import { createWorkspaceManifest } from "../packages/workspace/dist/index.js";
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
const relayMailbox = new JsonRelayMailbox({ file: path.join(workspace, "relay.json") });
const context = createDefaultContextManager();
const workspaceManifest = await createWorkspaceManifest({ cwd: workspace, config: defaultConfig("contract-workspace"), recentRuns: [], pendingApprovals: 0 });
const preparedContext = await context.prepare({
  agent: { name: "contract-agent", instructions: "Exercise context contract." },
  input: "Summarize the runtime contract.",
  state: {
    runId: "run_contract",
    input: "Summarize the runtime contract.",
    messages: [{ role: "user", content: "Summarize the runtime contract." }],
    steps: 0,
    toolErrors: 0,
    artifacts: [],
    startedAt: new Date().toISOString(),
    metadata: {}
  },
  tools: [],
  policy: { name: "read-only" }
});
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
  ...defaultAgentSpecs().map((agent) => validateSpecialistManifestContract(agent.specialist, `specialist:${agent.name}`)),
  validateContextSnapshotContract(preparedContext.snapshot),
  validateWorkspaceManifestContract(workspaceManifest),
  validateProviderRouteDecisionContract(
    routeProvider({
      task: "summarize this repo",
      defaultProvider: "mock",
      defaultModel: "mock/repo-analyst",
      routes: [{ id: "mock-low-risk", provider: "mock", model: "mock/repo-analyst", match: { risk: "low" }, reason: "contract route" }],
      fallbacks: ["mock"]
    })
  ),
  validateLifecycleHookManifestContract({
    name: "contract-before-tool",
    version: "0.1.0",
    hook: "BeforeTool",
    permissions: ["fs:read"],
    risk: "low",
    timeoutMs: 1000,
    inputSchema: { type: "object" }
  }),
  await validateRelayMailboxContract(relayMailbox),
  validateLocalRuntimeSecurityContract(createLocalRuntimeSecurity({ tokenBytes: 16 })),
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
      specialists: defaultAgentSpecs().length,
      reports: reports.length
    },
    null,
    2
  )
);
