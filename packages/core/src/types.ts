export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
  default?: unknown;
};

export type Permission =
  | "fs:read"
  | "fs:write"
  | "shell:run"
  | "network:fetch"
  | "network:http"
  | "browser:read"
  | "browser:interact"
  | "database:read"
  | "database:write"
  | "mcp:tool"
  | "code:index"
  | "git:read"
  | string;

export type PolicyName = "read-only" | "workspace-write" | "developer" | "trusted";

export type Policy = {
  name: PolicyName;
  shellAllowlist?: string[];
};

export type ToolPolicyDecision = {
  allowed: boolean;
  reason: string;
  requiredApproval?: boolean;
  blockedPermission?: Permission;
};

export type ToolRisk = "low" | "medium" | "high";

export type ArtifactRef = {
  id: string;
  kind: string;
  uri: string;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export type ToolError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ToolResult<Output = unknown> = {
  ok: boolean;
  output?: Output;
  error?: ToolError;
  artifacts?: ArtifactRef[];
  metadata?: Record<string, unknown>;
};

export type ToolResultEnvelope = {
  ok: boolean;
  ref: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  preview: string;
  artifacts: ArtifactRef[];
  metadata: Record<string, unknown>;
  error?: ToolError;
};

export type ToolExecutionContext = {
  runId: string;
  workspaceRoot: string;
  signal: AbortSignal;
  trace: TraceWriter;
  policy: Policy;
  env: Record<string, string | undefined>;
};

export type Tool<Input = unknown, Output = unknown> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk?: ToolRisk;
  requiredPermissions?: Permission[];
  execute(input: Input, ctx: ToolExecutionContext): Promise<ToolResult<Output>>;
};

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type FinishReason = "stop" | "tool-calls" | "length" | "error";

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
};

export type ModelRequest = {
  messages: Message[];
  tools: ToolDefinition[];
  runId: string;
  step: number;
};

export type ModelContext = {
  runId: string;
  signal: AbortSignal;
};

export type ModelResponse = {
  message: Message;
  finishReason: FinishReason;
  usage?: ModelUsage;
  metadata?: Record<string, unknown>;
};

export type ModelProvider = {
  name: string;
  complete(request: ModelRequest, ctx: ModelContext): Promise<ModelResponse>;
};

export type Agent = {
  name: string;
  instructions: string;
  defaultTools?: string[];
  metadata?: Record<string, unknown>;
};

export type RuntimeLimits = {
  maxSteps: number;
  maxToolErrors: number;
  maxRunMs: number;
  maxCostUsd?: number;
  maxToolMs?: number;
  maxToolRetries?: number;
  maxContextTokens?: number;
};

export type RunStatus = "created" | "running" | "waiting_approval" | "paused" | "cancelled" | "completed" | "failed";

export type SessionStatus = "active" | "paused" | "completed" | "failed";

export type RunState = {
  runId: string;
  input: string;
  messages: Message[];
  steps: number;
  toolErrors: number;
  artifacts: ArtifactRef[];
  startedAt: string;
  phase?: "context_prepared" | "model_completed" | "tools_completed" | "waiting_approval";
  metadata: Record<string, unknown>;
};

export type ContextItemSnapshot = {
  id: string;
  type: string;
  included: boolean;
  reason: string;
  preview?: string;
};

export type ContextSnapshot = {
  messageCount: number;
  tokenEstimate: number;
  stablePrefixHash?: string;
  items: ContextItemSnapshot[];
};

export type ContextPrepareInput = {
  agent: Agent;
  input: string;
  state: RunState;
  tools: ToolDefinition[];
  policy: Policy;
  limits: RuntimeLimits;
};

export type PreparedContext = {
  messages: Message[];
  snapshot: ContextSnapshot;
};

export type ContextManager = {
  prepare(input: ContextPrepareInput): Promise<PreparedContext>;
  observe(event: RuntimeEvent): Promise<void>;
  compact?(state: RunState): Promise<RunState>;
};

export type RuntimeEvent = {
  id: string;
  runId: string;
  type: string;
  ts: string;
  data: Record<string, unknown>;
};

export type RuntimeEventInput = {
  type: string;
  data?: Record<string, unknown>;
};

export type TraceWriter = {
  write(event: RuntimeEventInput): Promise<RuntimeEvent>;
};

export type TraceStore = {
  write(event: RuntimeEvent): Promise<void>;
  close?(): Promise<void>;
};

export type RunRecord = {
  runId: string;
  status: RunStatus;
  agent?: string;
  input?: string;
  sessionId?: string;
  startedAt: string;
  completedAt?: string;
  steps?: number;
  metadata?: Record<string, unknown>;
};

export type RunStore = {
  putRun(run: RunRecord): Promise<RunRecord>;
  updateRun(runId: string, patch: Partial<Omit<RunRecord, "runId" | "startedAt">>): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | undefined>;
  listRuns(filter?: { status?: RunRecord["status"]; sessionId?: string; limit?: number }): Promise<RunRecord[]>;
};

export type SessionRecord = {
  id: string;
  name?: string;
  status: SessionStatus;
  activeRunId?: string;
  input?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SessionStore = {
  createSession(session: Omit<SessionRecord, "createdAt" | "updatedAt"> & Partial<Pick<SessionRecord, "createdAt" | "updatedAt">>): Promise<SessionRecord>;
  updateSession(id: string, patch: Partial<Omit<SessionRecord, "id" | "createdAt">>): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | undefined>;
  listSessions(filter?: { status?: SessionRecord["status"]; limit?: number }): Promise<SessionRecord[]>;
};

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type ApprovalRequest = {
  id: string;
  runId: string;
  sessionId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  permissions: Permission[];
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  metadata?: Record<string, unknown>;
};

export type ApprovalDecision = {
  approvalId: string;
  decision: "approved" | "denied";
  decidedBy?: string;
  reason?: string;
  decidedAt?: string;
};

export type ApprovalStore = {
  createApproval(
    request: Omit<ApprovalRequest, "id" | "status" | "requestedAt"> &
      Partial<Pick<ApprovalRequest, "id" | "status" | "requestedAt">>
  ): Promise<ApprovalRequest>;
  getApproval(id: string): Promise<ApprovalRequest | undefined>;
  listApprovals(filter?: { runId?: string; status?: ApprovalStatus; limit?: number }): Promise<ApprovalRequest[]>;
  decideApproval(decision: ApprovalDecision): Promise<ApprovalRequest>;
};

export type AuditRecord = {
  id: string;
  ts: string;
  actor?: string;
  action: string;
  target?: string;
  runId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type AuditStore = {
  writeAudit(record: Omit<AuditRecord, "id" | "ts"> & Partial<Pick<AuditRecord, "id" | "ts">>): Promise<AuditRecord>;
  listAudit(filter?: { action?: string; runId?: string; limit?: number }): Promise<AuditRecord[]>;
};

export type MaterializedRef = {
  ref: string;
  kind: string;
  content: unknown;
  summary?: string;
  preview?: string;
  metadata?: Record<string, unknown>;
};

export type ArtifactRecord = {
  ref: string;
  kind: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  content: unknown;
  summary?: string;
  preview?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ArtifactStore = {
  put(record: Omit<ArtifactRecord, "createdAt"> & { createdAt?: string }): Promise<ArtifactRecord>;
  get(ref: string): Promise<ArtifactRecord | undefined>;
  materialize(ref: string): Promise<MaterializedRef | undefined>;
  list(filter?: { runId?: string; kind?: string; limit?: number }): Promise<ArtifactRecord[]>;
};

export type MemoryScope = "session" | "project" | "user" | "agent" | "procedural" | "episodic" | "semantic" | "tool" | "wiki" | "global";

export type MemoryBlock = {
  id: string;
  scope: MemoryScope;
  text: string;
  kind?: "fact" | "preference" | "procedure" | "episode" | "summary" | "decision";
  tags?: string[];
  score?: number;
  pinned?: boolean;
  promoted?: boolean;
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MemoryProposalStatus = "proposed" | "reviewed" | "tested" | "promoted" | "rejected";

export type MemoryProposal = {
  id: string;
  memory: Omit<MemoryBlock, "id" | "createdAt" | "updatedAt" | "promoted" | "pinned">;
  rationale: string;
  status: MemoryProposalStatus;
  evidence?: Array<{ type: "run" | "trace" | "eval" | "user" | "source" | string; ref?: string; summary: string }>;
  evalResults?: EvalResult[];
  reviewedBy?: string;
  reviewedAt?: string;
  reviewReason?: string;
  promotedMemoryId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type MemoryProposalStore = {
  propose(proposal: Omit<MemoryProposal, "id" | "status" | "createdAt" | "updatedAt"> & Partial<Pick<MemoryProposal, "id" | "status" | "createdAt" | "updatedAt">>): Promise<MemoryProposal>;
  getProposal(id: string): Promise<MemoryProposal | undefined>;
  listProposals(filter?: { status?: MemoryProposalStatus; limit?: number }): Promise<MemoryProposal[]>;
  reviewProposal(id: string, review: { decision: "approved" | "rejected"; reviewedBy?: string; reason?: string }): Promise<MemoryProposal>;
  testProposal(id: string, evalResults: EvalResult[]): Promise<MemoryProposal>;
  promoteProposal(id: string): Promise<{ proposal: MemoryProposal; memory: MemoryBlock }>;
};

export type MemoryStore = {
  add(memory: Omit<MemoryBlock, "id" | "createdAt" | "updatedAt"> & Partial<Pick<MemoryBlock, "id" | "createdAt" | "updatedAt">>): Promise<MemoryBlock>;
  search(query: string, options?: { scopes?: MemoryScope[]; tags?: string[]; limit?: number }): Promise<MemoryBlock[]>;
  list(options?: { scope?: MemoryScope; limit?: number }): Promise<MemoryBlock[]>;
  promote(id: string): Promise<MemoryBlock>;
};

export type ExperienceEvent = {
  id: string;
  runId?: string;
  type: "task" | "tool" | "approval" | "eval" | "feedback" | "decision" | string;
  summary: string;
  refs?: ArtifactRef[];
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ExperienceAtom = {
  id: string;
  eventIds: string[];
  title: string;
  statement: string;
  confidence?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExperienceLesson = {
  id: string;
  atomIds: string[];
  title: string;
  guidance: string;
  appliesTo?: string[];
  evidence?: Array<{ type: "run" | "eval" | "user" | "trace" | string; ref?: string; summary: string }>;
  status: "draft" | "reviewed" | "promoted" | "superseded";
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type ExperienceLedger = {
  addEvent(event: Omit<ExperienceEvent, "id" | "createdAt"> & Partial<Pick<ExperienceEvent, "id" | "createdAt">>): Promise<ExperienceEvent>;
  addAtom(atom: Omit<ExperienceAtom, "id" | "createdAt" | "updatedAt"> & Partial<Pick<ExperienceAtom, "id" | "createdAt" | "updatedAt">>): Promise<ExperienceAtom>;
  addLesson(lesson: Omit<ExperienceLesson, "id" | "status" | "createdAt" | "updatedAt"> & Partial<Pick<ExperienceLesson, "id" | "status" | "createdAt" | "updatedAt">>): Promise<ExperienceLesson>;
  listEvents(filter?: { runId?: string; type?: string; limit?: number }): Promise<ExperienceEvent[]>;
  listAtoms(filter?: { tag?: string; limit?: number }): Promise<ExperienceAtom[]>;
  listLessons(filter?: { status?: ExperienceLesson["status"]; limit?: number }): Promise<ExperienceLesson[]>;
};

export type WikiPageRecord = {
  id: string;
  title: string;
  path: string;
  summary: string;
  links?: string[];
  metadata?: Record<string, unknown>;
  updatedAt: string;
};

export type WikiStore = {
  putPage(page: WikiPageRecord): Promise<WikiPageRecord>;
  query(query: string, options?: { limit?: number }): Promise<WikiPageRecord[]>;
  listPages(options?: { limit?: number }): Promise<WikiPageRecord[]>;
};

export type EvalStore = {
  putEvalResult(result: EvalResult & { suite?: string; createdAt?: string }): Promise<EvalResult & { suite?: string; createdAt: string }>;
  listEvalResults(filter?: { suite?: string; limit?: number }): Promise<Array<EvalResult & { suite?: string; createdAt: string }>>;
};

export type ProviderRegistry = {
  listProviders(): string[];
  getProvider(name: string): ModelProvider | undefined;
  registerProvider(provider: ModelProvider): void;
};

export type ToolsetRegistry = {
  listToolsets(): ToolsetManifest[];
  getToolset(name: string): ToolsetManifest | undefined;
  registerToolset(manifest: ToolsetManifest): void;
};

export type ToolsetManifest = {
  name: string;
  version: string;
  description?: string;
  tools: ToolDefinition[];
  permissions?: Permission[];
  entry?: string;
};

export type AgentSpec = Agent & {
  role?: string;
  handoffDescription?: string;
};

export type TaskSpec = {
  id: string;
  input: string;
  agent?: string;
  dependsOn?: string[];
  metadata?: Record<string, unknown>;
};

export type Handoff = {
  from: string;
  to: string;
  reason: string;
  payload?: Record<string, unknown>;
};

export type WorkflowSpec = {
  name: string;
  agents: AgentSpec[];
  tasks: TaskSpec[];
  mode?: "crew" | "flow";
};

export type WorkflowExecutionResult = {
  workflow: string;
  status: "completed" | "failed" | "waiting_approval" | "cancelled";
  assignments: Array<{ taskId: string; agent: string; status: "completed" | "failed" | "waiting_approval" | "cancelled"; output?: string; runId?: string; approvalId?: string; artifactRefs?: string[] }>;
  handoffs: Handoff[];
  metadata?: Record<string, unknown>;
};

export type WorkflowResumeState = {
  completedTasks?: Record<string, { agent: string; output?: string; runId?: string; artifactRefs?: string[] }>;
  taskRunStates?: Record<string, RunState>;
};

export type WorkflowExecutor = {
  execute(workflow: WorkflowSpec, input?: { runId?: string; sessionId?: string; signal?: AbortSignal; resume?: boolean; resumeState?: WorkflowResumeState; maxParallelTasks?: number }): Promise<WorkflowExecutionResult>;
};

export type CapabilityDraft = {
  id: string;
  title: string;
  summary: string;
  taskRunId?: string;
  suggestedInstructions?: string;
  suggestedTools?: string[];
  evidence?: Array<{ type: "run" | "trace" | "eval" | "user" | string; ref?: string; summary: string }>;
  status: "draft" | "promoted" | "rejected";
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type Capability = {
  id: string;
  title: string;
  summary: string;
  instructions: string;
  defaultTools?: string[];
  sourceDraftId?: string;
  version: number;
  status: "active" | "deprecated";
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type CapabilityRun = {
  id: string;
  capabilityId: string;
  runId?: string;
  input: string;
  status: "completed" | "failed" | "cancelled";
  output?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type CapabilityStore = {
  createDraft(draft: Omit<CapabilityDraft, "id" | "status" | "createdAt" | "updatedAt"> & Partial<Pick<CapabilityDraft, "id" | "status" | "createdAt" | "updatedAt">>): Promise<CapabilityDraft>;
  listDrafts(filter?: { status?: CapabilityDraft["status"]; limit?: number }): Promise<CapabilityDraft[]>;
  getDraft(id: string): Promise<CapabilityDraft | undefined>;
  promoteDraft(id: string, input?: { instructions?: string; defaultTools?: string[]; capabilityId?: string }): Promise<{ draft: CapabilityDraft; capability: Capability }>;
  listCapabilities(filter?: { status?: Capability["status"]; limit?: number }): Promise<Capability[]>;
  getCapability(id: string): Promise<Capability | undefined>;
  recordRun(run: Omit<CapabilityRun, "id" | "createdAt"> & Partial<Pick<CapabilityRun, "id" | "createdAt">>): Promise<CapabilityRun>;
};

export type EvalCase = {
  id: string;
  input: string;
  expected?: string;
  assertions?: Array<{
    type:
      | "contains"
      | "not_contains"
      | "equals"
      | "regex"
      | "max_steps"
      | "max_tool_calls"
      | "max_latency_ms"
      | "max_cost_usd"
      | "status_is"
      | "event_exists"
      | "event_absent"
      | "tool_sequence"
      | "guardrail_absent"
      | "guardrail_present";
    value: string | number | boolean | string[];
  }>;
  metadata?: Record<string, unknown>;
};

export type EvalResult = {
  id: string;
  passed: boolean;
  score: number;
  details: string[];
  runId?: string;
};

export type EvalSuite = {
  id: string;
  name?: string;
  cases: EvalCase[];
  metadata?: Record<string, unknown>;
};

export type EvalReport = {
  suite: string;
  passed: number;
  failed: number;
  score: number;
  results: EvalResult[];
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ReplayRunResult = {
  runId: string;
  sourceRunId?: string;
  status: "completed" | "failed";
  events: RuntimeEvent[];
  diff?: unknown;
  metadata?: Record<string, unknown>;
};

export type GuardrailResult = {
  allowed: boolean;
  reason: string;
  category?: "prompt_injection" | "secret_exfiltration" | "workspace_escape" | "dangerous_action" | "memory_poisoning" | string;
  severity?: "low" | "medium" | "high" | "critical";
  metadata?: Record<string, unknown>;
};

export type EvolutionProposal = {
  id: string;
  kind: "prompt" | "memory" | "tool" | "skill" | "policy" | "wiki";
  title: string;
  rationale: string;
  patch?: string;
  status: "proposed" | "tested" | "promoted" | "rejected";
  evalResults?: EvalResult[];
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type EvolutionPromotion = {
  id: string;
  proposalId: string;
  kind: EvolutionProposal["kind"];
  status: "promoted" | "rolled_back";
  target?: string;
  snapshot?: unknown;
  createdAt: string;
  promotedAt: string;
  rolledBackAt?: string;
  metadata?: Record<string, unknown>;
};

export type EvolutionRollbackResult = {
  promotion: EvolutionPromotion;
  restored: boolean;
  target?: string;
};

export type EvolutionGate = {
  test(proposal: EvolutionProposal, cases: EvalCase[]): Promise<EvolutionProposal>;
  promote(proposal: EvolutionProposal): Promise<EvolutionProposal>;
};

export type HttpToolConfig = {
  allowedDomains?: string[];
  deniedDomains?: string[];
  timeoutMs?: number;
  maxBytes?: number;
};

export type BrowserToolConfig = {
  mode: "managed" | "cdp";
  headless: boolean;
  cdpUrl?: string;
  allowedDomains?: string[];
  deniedDomains?: string[];
};

export type DatabaseConnectionConfig = {
  name: string;
  driver: "sqlite" | "postgres" | "mysql";
  file?: string;
  connectionStringEnv?: string;
  readonly?: boolean;
  maxRows?: number;
  statementTimeoutMs?: number;
};

export type McpServerConfig = {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
};

export type CodeIndexFileRecord = {
  path: string;
  hash: string;
  summary: string;
  language?: string;
  updatedAt: string;
};

export type CodeSymbolRecord = {
  id: string;
  path: string;
  name: string;
  kind: string;
  line: number;
  column?: number;
  signature?: string;
};

export type CodeReferenceRecord = {
  symbolId: string;
  path: string;
  line: number;
  preview: string;
};

export type CodeIndexStore = {
  upsertCodeFile(file: CodeIndexFileRecord): Promise<CodeIndexFileRecord>;
  upsertCodeSymbols(symbols: CodeSymbolRecord[]): Promise<void>;
  upsertCodeReferences(references: CodeReferenceRecord[]): Promise<void>;
  searchCodeSymbols(query: string, options?: { limit?: number }): Promise<CodeSymbolRecord[]>;
  findCodeReferences(symbolId: string, options?: { limit?: number }): Promise<CodeReferenceRecord[]>;
  listCodeFiles(options?: { limit?: number }): Promise<CodeIndexFileRecord[]>;
};

export type RuntimeConfig = {
  workspaceRoot: string;
  model: ModelProvider;
  tools: Tool[];
  context: ContextManager;
  policy: Policy | PolicyName;
  trace: TraceStore;
  artifacts?: ArtifactStore;
  approvals?: ApprovalStore;
  limits?: Partial<RuntimeLimits>;
  env?: Record<string, string | undefined>;
};

export type RunOptions = {
  runId?: string;
  sessionId?: string;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
  resumeState?: RunState;
  signal?: AbortSignal;
};

export type RunResult = {
  runId: string;
  status: RunStatus;
  steps: number;
  finalMessage?: string;
  approvalId?: string;
};

export type Runtime = {
  run(agent: Agent, input: string, options?: RunOptions): Promise<RunResult>;
};

export type StudioServerConfig = {
  traceDir?: string;
  sqliteFile?: string;
  port?: number;
  token?: string;
  corsAllowlist?: string[];
};
