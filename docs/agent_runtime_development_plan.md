# Agent Runtime Platform 开发方案

资料日期：2026-05-20

## 1. 工程目标

做一个可运行、可扩展、可观测的 TypeScript agent runtime。第一阶段目标不是功能最多，而是跑通最核心的闭环：

```txt
CLI -> Runtime -> Context -> ModelProvider -> ToolCall -> ToolExecutor -> Trace -> Replay
```

第一版要让 Codex 可以直接按模块实现，并且每个阶段都有测试和验收标准。

## 2. 技术选型

### 2.1 主语言

使用 TypeScript。

原因：

- Vercel AI SDK、MCP TS SDK、前端 trace studio、Node CLI 都天然适合 TS。
- 工具 schema、JSON Schema、Zod 类型、package 发布路径清晰。
- 后续可以补 Python SDK，但不要第一版双线开战。

### 2.2 推荐依赖

核心依赖：

- `ai`：Vercel AI SDK，用作主要模型 provider 抽象。
- `zod`：内部配置和工具输入校验。
- `execa`：shell 执行。
- `commander` 或 `cac`：CLI。
- `tsx`：开发运行。
- `vitest`：测试。
- `tsup`：package 构建。
- `@modelcontextprotocol/sdk`：MCP client/server。
- `@opentelemetry/api`：trace 兼容层。
- `fast-glob`：文件枚举。
- `diff`：edit/diff 展示。
- `nanoid`：run_id、event_id。

可选依赖：

- `better-sqlite3`：本地 trace store。如果想避免 native 依赖，第一版先用 JSONL。
- `@vscode/ripgrep`：内置 rg binary。否则调用系统 `rg`，无 rg 时 fallback 到 JS 搜索。
- `playwright`：浏览器工具基础。也可以先只定义 adapter 接口，后续接 browser-use。
- `express` 或 `hono`：trace studio 本地服务。
- `vite` + `react`：trace studio UI。

### 2.3 Monorepo

建议使用 pnpm workspace：

```txt
agentbase/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    core/
    cli/
    tools-fs/
    tools-shell/
    tools-git/
    tools-web/
    provider-ai-sdk/
    provider-openai-compatible/
    provider-litellm/
    context-default/
    trace/
    evals/
    mcp/
    studio/
  examples/
    repo-analyst/
    test-runner/
    research-agent/
  fixtures/
    small-repo/
  docs/
```

### 2.4 Build vs Reuse

第一版要坚决复用成熟轮子，只把它们编排成一致的 runtime 产品。

| 模块 | 优先复用 | 自己做什么 |
| --- | --- | --- |
| 模型调用 | Vercel AI SDK、OpenAI-compatible API、LiteLLM | 统一内部 `ModelProvider` 接口、usage 归一化、trace 事件 |
| 工具协议 | MCP TS SDK、JSON Schema | 统一 `Tool` 接口、policy、error model、trace |
| 文件搜索 | 系统 `rg` 或 `@vscode/ripgrep` | workspace guard、结果结构化、fallback |
| Shell 执行 | `execa` | 命令风险分级、timeout、output limit、approval |
| Browser | Playwright、browser-use | 先定义 adapter 和权限模型，后续接入 |
| Web search | Exa/Tavily/Brave/Serper 官方 API | 统一 `SearchProvider` 和结果 schema |
| Trace | JSONL、OpenTelemetry API、Langfuse/Phoenix export | 本地 run event schema、replay 数据模型 |
| UI | Vite + React | Trace Studio 的产品体验 |
| Evals | Vitest、fixture workspace、可选 LLM judge | agent run replay、tool mock、报告格式 |
| Coding agent CLI UX | OpenAI Codex、OpenHands、learn-coding-agent | CLI 首次体验、sandbox/approval、会话持久化、项目说明文件、trace/replay 的统一产品化 |

### 2.5 Codex / Coding Agent 参考原则

`openai/codex` 和 `learn-coding-agent` 给这类产品一个很重要的提醒：真正难的不是写一个能调用工具的 loop，而是把 loop 外面的 harness 做稳定。

第一版要吸收这些原则：

- CLI 是产品入口，不只是调试入口。`init/run/trace` 必须像成品工具，而不是 example script。
- 项目说明文件是一等输入。支持类似 `AGENTS.md` 的 repo-local instructions，并把它放进稳定前缀。
- sandbox 和 approval 是默认 UX。文件写入、shell、网络、浏览器、git destructive action 都必须经过 policy。
- 会话是可恢复对象。run 不能只在内存里，要以 JSONL/session 文件记录，并支持后续 replay。
- tool result 不是普通聊天文本。大结果要落成 artifact/ref，模型默认只看到 summary/preview，需要时再 materialize。
- context 是有层次的：稳定前缀、压缩会话态、引用层、当前轮动态后缀要分开管理。
- prompt cache 要主动维护。稳定前缀尽量固定，当前轮用户选择和最新工具结果放在后缀，避免每轮都改变前缀。
- 并发工具可以后做，但 event schema 要能表达并发 tool calls，避免后续大改 trace。
- 子 agent 可以后做，但 run state 要能表达 parent/child run。
- 不把 Codex 的 coding-only 边界当成我们的边界。我们参考它的产品化 CLI/runtime，不复制它的场景限制。

## 3. 包职责

### 3.1 `@agentbase/core`

职责：

- 定义核心类型。
- 实现 runtime loop。
- 管理 run state。
- 调用 context manager。
- 调用 model provider。
- 分发 tool calls。
- 接入 policy engine。
- 发出 runtime events。

核心文件：

```txt
packages/core/src/types.ts
packages/core/src/runtime.ts
packages/core/src/agent.ts
packages/core/src/tool-registry.ts
packages/core/src/tool-executor.ts
packages/core/src/policy.ts
packages/core/src/events.ts
packages/core/src/errors.ts
```

### 3.2 `@agentbase/cli`

职责：

- `agentbase init`
- `agentbase run`
- `agentbase tools list`
- `agentbase provider add`
- `agentbase trace list`
- `agentbase trace open`
- `agentbase eval run`

核心文件：

```txt
packages/cli/src/index.ts
packages/cli/src/commands/init.ts
packages/cli/src/commands/run.ts
packages/cli/src/commands/tools.ts
packages/cli/src/commands/provider.ts
packages/cli/src/commands/trace.ts
packages/cli/src/config.ts
```

### 3.3 `@agentbase/tools-fs`

工具：

- `read_file`
- `write_file`
- `edit_file`
- `list_files`
- `glob_files`
- `search_files`

要求：

- 所有路径必须 resolve 到 workspace root 内。
- 读文件有最大字节限制。
- 写文件记录 before/after diff。
- `edit_file` 使用明确 patch 或 replace，不做模糊大段猜测。
- `search_files` 优先 `rg`。

### 3.4 `@agentbase/tools-shell`

工具：

- `run_shell`

要求：

- cwd 固定在 workspace root 或子目录。
- 支持 timeout。
- 支持 max output bytes。
- policy 检查命令。
- trace 记录 command、cwd、exitCode、stdout/stderr 截断摘要。

### 3.5 `@agentbase/tools-git`

工具：

- `git_status`
- `git_diff`
- `git_show`
- `git_log`

要求：

- 只读为主。
- 不提供 reset/checkout/rebase 等危险工具。
- 如果后续加 commit/push，必须单独权限。

### 3.6 `@agentbase/tools-web`

工具：

- `fetch_url`
- `web_search`

要求：

- `fetch_url` 有 allow/deny domain policy。
- `web_search` 通过 SearchProvider，不在工具里绑定具体供应商。
- 结果结构统一：title、url、snippet、publishedAt、source。

### 3.7 `@agentbase/provider-ai-sdk`

职责：

- 用 Vercel AI SDK 调用模型。
- 转换内部 messages/tool schema 到 AI SDK 格式。
- 转换 tool calls、usage、finishReason。

### 3.8 `@agentbase/provider-openai-compatible`

职责：

- 直接调用 OpenAI-compatible `/chat/completions` 或 `/responses`。
- 支持 baseUrl、apiKey、model。
- 作为最小 provider fallback。

### 3.9 `@agentbase/provider-litellm`

职责：

- 对接 LiteLLM proxy。
- 支持 team/virtual key。
- 读取 usage/cost metadata。

### 3.10 `@agentbase/context-default`

职责：

- 默认 Context Orchestrator。
- 维护 working set。
- 维护 run summary。
- 管理 token budget。
- 对工具结果做摘要和索引。
- 管理 prompt cache 友好的 stable prefix / dynamic suffix。
- 把大 tool result 转成 artifact/ref/summary/preview。
- 支持用户当前轮 selected context 和跨轮 pinned context。
- 支持按需 materialize：需要完整内容时再把 ref 展开给模型。

核心策略：

```txt
Stable Prefix：
  system instructions
  tool schemas
  policy summary
  repo instructions / AGENTS.md
  pinned user rules

Session State：
  current task
  explicit user constraints
  compacted run summary
  todo state
  working set manifest

Reference Layer：
  file refs
  tool result refs
  search result refs
  artifact ids

Dynamic Suffix：
  current user message
  current selected context
  latest concrete tool result preview
  pending approval/error
```

工具结果生命周期：

```txt
raw output -> artifact/ref -> summary/preview -> materialized content only when needed
```

默认规则：

- 最新一轮小结果可以进入 dynamic suffix。
- 大结果、旧结果、一次性结果只保留 summary/ref。
- 用户临时选中的内容只在当前轮生效，除非 pin/promote。
- 被 agent 认为重要的事实进入 working set 或 run summary。
- 每次 `context.prepared` 都要写入 inclusion/exclusion reason，方便 trace studio 解释上下文。

### 3.11 `@agentbase/trace`

职责：

- 定义 trace event schema。
- 提供 JSONL trace store。
- 后续提供 SQLite trace store。
- 提供 replay loader。
- 提供 OpenTelemetry exporter。

事件类型：

```txt
run.started
context.prepared
context.compacted
context.materialized
model.requested
model.completed
tool.requested
tool.approved
tool.rejected
tool.started
tool.completed
tool.failed
artifact.created
file.changed
run.completed
run.failed
```

### 3.12 `@agentbase/evals`

职责：

- 定义 eval case。
- 支持 fixture workspace。
- 支持 mock provider。
- 支持 LLM judge adapter，但第一版可选。
- 输出 json/html report。

### 3.13 `@agentbase/mcp`

职责：

- 把 MCP server 暴露的 tools/resources 接进 ToolRegistry。
- 把 AgentBase tools 暴露成 MCP server。
- 提供 MCP inspector 友好的 manifest。

### 3.14 `@agentbase/studio`

职责：

- 本地 trace viewer。
- 第一版只读。

页面：

- Run list。
- Run timeline。
- Messages。
- Tool calls。
- Context snapshots。
- Diffs。
- Cost/usage。

## 4. 核心类型草案

### 4.1 Runtime

```ts
export type RuntimeConfig = {
  workspaceRoot: string;
  model: ModelProvider;
  tools: Tool[];
  context: ContextManager;
  policy: Policy;
  trace: TraceStore;
  limits?: RuntimeLimits;
};

export type RuntimeLimits = {
  maxSteps: number;
  maxToolErrors: number;
  maxRunMs: number;
  maxCostUsd?: number;
};
```

### 4.2 Agent

```ts
export type Agent = {
  name: string;
  instructions: string;
  defaultTools?: string[];
  metadata?: Record<string, unknown>;
};
```

### 4.3 Message

```ts
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };
```

### 4.4 Tool

```ts
export type Tool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk?: "low" | "medium" | "high";
  requiredPermissions?: Permission[];
  execute(input: unknown, ctx: ToolExecutionContext): Promise<ToolResult>;
};

export type ToolExecutionContext = {
  runId: string;
  workspaceRoot: string;
  signal: AbortSignal;
  trace: TraceWriter;
  policy: Policy;
  env: Record<string, string | undefined>;
};
```

### 4.5 Event

```ts
export type RuntimeEvent = {
  id: string;
  runId: string;
  type: string;
  ts: string;
  data: Record<string, unknown>;
};
```

## 5. 开发里程碑

### Phase 0：仓库初始化

目标：创建 monorepo 和基础工程。

任务：

- 初始化 pnpm workspace。
- 配置 TypeScript、tsup、vitest。
- 建立 packages 目录。
- 建立 examples 和 fixtures。
- 配置基础 lint/format。

验收：

- `pnpm install` 成功。
- `pnpm build` 成功。
- `pnpm test` 成功，即使只有空测试。

### Phase 1：Core loop + Mock provider

目标：不依赖真实模型，跑通 agent loop。

任务：

- 实现核心类型。
- 实现 `createRuntime`。
- 实现 `ToolRegistry`。
- 实现 `ToolExecutor`。
- 实现 `MockModelProvider`，可以按脚本返回 tool call/final answer。
- 实现 JSONL trace store。
- 添加 fixture test。

验收：

- 测试中 mock model 先调用 `read_file`，再返回 final answer。
- trace 文件包含 run/model/tool 事件。
- maxSteps 能停止循环。

### Phase 2：文件、grep、shell 工具

目标：标准本地工具可用。

任务：

- 实现 fs tools。
- 实现 shell tool。
- 实现 git read-only tools。
- 实现 workspace path guard。
- 实现 command policy guard。
- 写跨平台测试。

验收：

- 不能读取 workspace 外路径。
- `write_file` 产生 diff event。
- `search_files` 优先调用 `rg`，没有时 fallback。
- `run_shell` 支持 timeout 和 output 截断。

### Phase 3：真实 model provider

目标：能调用真实模型。

任务：

- 实现 AI SDK provider。
- 实现 OpenAI-compatible provider。
- 配置 `.agentbase/config.json`。
- CLI 支持 provider add/list。
- 支持 env var 读取。

验收：

- 有 API key 时能真实运行。
- 无 API key 时 example 能用 mock provider。
- usage/token 写入 trace。

### Phase 4：CLI 首版

目标：开发者能用命令行跑起来。

任务：

- `agentbase init` 复制模板。
- `agentbase run <prompt>` 运行默认 agent。
- `agentbase tools list` 显示工具。
- `agentbase trace list` 列出 run。
- `agentbase trace show <run-id>` 在终端显示摘要。

验收：

- 新目录初始化后，能跑 `agentbase run "summarize this repo"`。
- 运行结束后能看到 trace path。
- README 中的 quickstart 可复制执行。

### Phase 5：默认 context manager

目标：上下文不再只是拼 messages，而是形成 Context Orchestrator。

任务：

- 实现 active task。
- 实现 working set。
- 实现 file summary cache。
- 实现 tool result summarization hook。
- 实现 tool result artifact/ref/summary/preview。
- 实现 selected context 当前轮注入。
- 实现 pinned context 跨轮保留。
- 实现 materialize ref 的内部能力。
- 实现 stable prefix / dynamic suffix 组装顺序。
- 实现 token budget 粗略估算。
- 实现 compact。

验收：

- 长工具输出不会全部塞回模型。
- 已读文件能被记录到 working set。
- context.prepared event 里有 snapshot。
- trace 能解释每个 context item 为什么被包含或排除。
- 稳定前缀在没有配置变化时保持一致，动态内容只进入后缀。
- 测试覆盖 context budget 行为。

### Phase 6：MCP 集成

目标：兼容现有工具生态。

任务：

- MCP client：加载本地 MCP server tools。
- MCP tool adapter：把 MCP tool 转成 AgentBase Tool。
- MCP server：把 AgentBase tools 暴露给外部 client。
- CLI 支持 `agentbase tools add mcp <command>`。

验收：

- 能加载一个 example MCP server。
- MCP tool call 进入统一 trace。
- AgentBase tools 能被 MCP inspector 看到。

### Phase 7：Trace Studio

目标：可视化调试。

任务：

- 本地 server 读取 trace store。
- React/Vite UI。
- Run list。
- Timeline。
- Tool call detail。
- Diff viewer。
- Context snapshot viewer。

验收：

- `agentbase trace open` 打开浏览器。
- 能查看至少最近 20 个 runs。
- 能看到工具输入输出和 file diff。

### Phase 8：Replay 和 eval

目标：能测试 agent 行为。

任务：

- replay trace loader。
- mock tool result provider。
- eval case yaml。
- eval runner。
- report 输出。

验收：

- 可以 replay 一个历史 run。
- 可以在 fixture repo 上跑 repo-analyst eval。
- eval report 包含 pass/fail、steps、tool errors。

## 6. 推荐第一批 examples

### 6.1 `repo-analyst`

输入：

```txt
Analyze this repository and produce a technical map.
```

工具：

- read_file
- list_files
- search_files
- git_status

输出：

- 项目结构。
- 关键模块。
- 风险点。
- 建议下一步。

### 6.2 `test-runner`

输入：

```txt
Run tests, identify failures, and suggest a fix.
```

工具：

- run_shell
- read_file
- search_files
- git_diff

输出：

- 测试命令。
- 失败摘要。
- 相关文件。
- 修复建议。

### 6.3 `research-agent`

输入：

```txt
Research a technical topic with sources.
```

工具：

- web_search
- fetch_url

输出：

- 结论。
- 来源列表。
- 不确定性。

### 6.4 `tool-designer`

输入：

```txt
Read this API doc and design an agent tool schema.
```

工具：

- read_file
- fetch_url
- write_file

输出：

- Tool schema。
- 输入输出类型。
- 错误模型。
- 权限需求。

## 7. 配置文件设计

项目级配置 `.agentbase/config.json`：

```json
{
  "name": "repo-agent",
  "workspaceRoot": ".",
  "provider": {
    "type": "ai-sdk",
    "model": "openai/<model-name>",
    "apiKeyEnv": "OPENAI_API_KEY"
  },
  "policy": "workspace-write",
  "tools": [
    "@agentbase/tools-fs",
    "@agentbase/tools-shell",
    "@agentbase/tools-git"
  ],
  "trace": {
    "type": "jsonl",
    "dir": ".agentbase/runs"
  },
  "limits": {
    "maxSteps": 30,
    "maxToolErrors": 5,
    "maxRunMs": 600000
  }
}
```

Agent 配置 `.agentbase/agent.json`：

```json
{
  "name": "repo-analyst",
  "instructions": "You are a careful repo analyst. Inspect files before answering. Prefer concise evidence-backed summaries.",
  "defaultTools": [
    "list_files",
    "read_file",
    "search_files",
    "git_status",
    "git_diff"
  ]
}
```

## 8. Trace JSONL 示例

```jsonl
{"id":"evt_1","runId":"run_1","ts":"2026-05-20T12:00:00.000Z","type":"run.started","data":{"agent":"repo-analyst"}}
{"id":"evt_2","runId":"run_1","ts":"2026-05-20T12:00:01.000Z","type":"context.prepared","data":{"messageCount":4,"tokenEstimate":1200}}
{"id":"evt_3","runId":"run_1","ts":"2026-05-20T12:00:02.000Z","type":"model.completed","data":{"finishReason":"tool-calls","usage":{"inputTokens":1200,"outputTokens":80}}}
{"id":"evt_4","runId":"run_1","ts":"2026-05-20T12:00:03.000Z","type":"tool.started","data":{"name":"list_files","input":{"pattern":"**/*"}}}
{"id":"evt_5","runId":"run_1","ts":"2026-05-20T12:00:03.100Z","type":"tool.completed","data":{"name":"list_files","ok":true,"outputPreview":"package.json\nsrc/index.ts"}}
{"id":"evt_6","runId":"run_1","ts":"2026-05-20T12:00:08.000Z","type":"run.completed","data":{"steps":4}}
```

## 9. 安全实现细节

### 9.1 路径保护

所有文件工具必须使用：

```ts
const resolved = path.resolve(workspaceRoot, userPath);
if (!resolved.startsWith(path.resolve(workspaceRoot) + path.sep)) {
  throw new PolicyError("Path escapes workspace root");
}
```

注意：

- 允许 workspace root 本身。
- 处理 symlink 时要用 `fs.realpath` 二次校验。
- Windows 路径需要单独测试。

### 9.2 Shell policy

命令风险分级：

```txt
low:
  ls, pwd, cat, rg, git status, git diff, npm test

medium:
  npm install, pnpm install, git show, curl, node script

high:
  rm, mv outside workspace, chmod, chown, sudo, ssh, scp, git push, git reset, curl pipe sh
```

第一版行为：

- `read-only`：block shell。
- `workspace-write`：只允许 allowlist。
- `developer`：medium 自动允许，high 需要 approval。
- 非交互 CLI 遇到 approval 时停止并输出原因。

### 9.3 Secret redaction

trace 写入前做脱敏：

- API key pattern。
- `Authorization` header。
- `.env` 文件内容。
- 常见 token 前缀：`sk-`、`ghp_`、`xoxb-`、`AKIA`。

### 9.4 Prompt injection 基线

第一版不承诺完全防 prompt injection，但要有默认规则：

- 外部网页内容标记为 untrusted。
- untrusted 内容不能改变 system/developer 指令。
- 工具执行前 policy 独立判断，不听模型自报安全。
- trace 标记内容来源。

## 10. 测试策略

### 10.1 单元测试

覆盖：

- Tool schema validation。
- Path guard。
- Shell policy。
- Runtime loop stop condition。
- Context compaction。
- Trace writing。

### 10.2 集成测试

覆盖：

- Mock provider 调工具。
- CLI init + run。
- FS tools 在 fixture repo 上运行。
- Trace list/show。

### 10.3 Replay 测试

覆盖：

- 给定历史 trace，replay 不访问真实网络。
- 工具结果从 trace 注入。
- prompt/context 改动后可比较输出。

### 10.4 E2E 测试

第一版只做本地 smoke：

```bash
pnpm build
pnpm test
node packages/cli/dist/index.js init /tmp/agentbase-smoke
node packages/cli/dist/index.js run "summarize this fixture" --mock --cwd /tmp/agentbase-smoke
```

## 11. Codex 实施顺序

建议让 Codex 按以下顺序连续做，不要一口气做完整平台：

### Step 1

创建 monorepo、core 类型、mock runtime、JSONL trace。

验收命令：

```bash
pnpm install
pnpm build
pnpm test
```

### Step 2

实现 fs tools 和 shell tool，加 path guard/policy tests。

验收命令：

```bash
pnpm --filter "@agentbase/tools-*" test
```

### Step 3

实现 CLI init/run/trace show，接 mock provider，跑 example。

验收命令：

```bash
pnpm --filter @agentbase/cli build
node packages/cli/dist/index.js init /tmp/agentbase-demo
node packages/cli/dist/index.js run "summarize this repo" --mock --cwd /tmp/agentbase-demo
node packages/cli/dist/index.js trace list --cwd /tmp/agentbase-demo
```

### Step 4

接 AI SDK provider 或 OpenAI-compatible provider。

验收：

- 环境变量存在时真实调用。
- 环境变量不存在时提示清楚，不影响 mock 测试。

### Step 5

实现 context-default，避免把长输出完整塞回模型。

验收：

- 长 shell output 被摘要/截断。
- context snapshot 写 trace。

### Step 6

实现 MCP client adapter。

验收：

- 加载 example MCP server。
- MCP tool call 进入统一 trace。

### Step 7

做 trace studio。

验收：

- `trace open` 打开本地 UI。
- 能看 timeline 和 tool details。

## 12. 第一版 README 结构

```txt
# AgentBase

Build agents without rebuilding the agent runtime.

## Quickstart
## What You Get
## Core Concepts
  Runtime
  Agent
  Tools
  Providers
  Context
  Trace
  Policy
## Create a Tool
## Configure a Provider
## Inspect a Trace
## Examples
## Roadmap
```

## 13. 风险与取舍

### 13.1 范围失控

风险：很容易膨胀成 Dify + LangGraph + OpenHands + OpenClaw。

控制方式：

- 第一版只做开发者 runtime。
- 不做低代码画布。
- 不做云多租户。
- 不做通讯渠道。
- 不做 RAG 平台。

### 13.2 和现有框架太像

风险：如果只做 agent loop + provider，就像另一个框架。

控制方式：

- 标准工具质量要高。
- trace/replay 从第一版就是核心。
- CLI 初体验必须产品化。
- context manager 要成为显性卖点。

### 13.3 安全债

风险：agent 工具一旦能写文件和跑 shell，默认危险。

控制方式：

- read-only policy 默认。
- workspace root guard。
- shell allowlist。
- high-risk approval。
- trace redaction。

### 13.4 Provider 维护成本

风险：自研 provider adapter 会拖垮维护。

控制方式：

- TS 默认依赖 Vercel AI SDK。
- 企业场景推荐 LiteLLM/OpenAI-compatible。
- 只维护薄 adapter。

## 14. 后续路线

### v0.1

- SDK core。
- CLI。
- fs/shell/git tools。
- minimal Context Orchestrator。
- mock + OpenAI-compatible provider。
- JSONL trace。
- repo-analyst example。

### v0.2

- AI SDK provider。
- richer Context Orchestrator：selected/pinned context、materialize、compact。
- search/fetch tools。
- replay。
- eval runner。

### v0.3

- MCP client/server。
- trace studio。
- LiteLLM adapter。
- OpenTelemetry exporter。

### v0.4

- browser tool。
- local scheduler/heartbeat。
- tool registry manifest。
- community tool template。

### v1.0

- stable runtime API。
- stable tool API。
- stable trace schema。
- security policy docs。
- production deployment guide。

## 15. 给 Codex 的首个实现提示词

可以直接把下面这段给 Codex：

```txt
请基于 docs/agent_runtime_product_doc.md 和 docs/agent_runtime_development_plan.md，实现 AgentBase v0.1。

范围只做：
1. pnpm TypeScript monorepo
2. packages/core：runtime loop、ToolRegistry、ToolExecutor、Policy、MockModelProvider
3. packages/trace：JSONL TraceStore
4. packages/tools-fs：read_file、write_file、list_files、search_files，带 workspace path guard
5. packages/tools-shell：run_shell，带 timeout、output limit、基础 policy
6. packages/context-default：最小 Context Orchestrator，包含 stable prefix / dynamic suffix、tool result summary/ref、context.prepared snapshot
7. packages/cli：init、run、trace list、trace show
8. examples/repo-analyst
9. fixtures/small-repo
10. vitest 覆盖 core loop、path guard、shell policy、trace writing、context assembly

先不要做：
- Trace Studio
- MCP
- browser tool
- RAG
- cloud
- visual workflow builder
- 多 agent / 子 agent

验收：
- pnpm install
- pnpm build
- pnpm test
- CLI 可以用 mock provider 在 example repo 运行，并生成 trace。
```
