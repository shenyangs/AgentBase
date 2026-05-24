# Agent Runtime Platform 产品文档

资料日期：2026-05-20

## 1. 一句话定义

Agent Runtime Platform 是一个本地优先、开发者优先的 agent 基础设施产品。它把每个 agent 项目都会重复开发的 model provider、tool provider、search provider、context management、agent loop、权限、安全沙箱、trace、replay、eval 做成可复用的标准底座。

目标不是再做一个低代码平台，也不是再做一个只服务 coding 的 agent，而是给开发者一个可以直接拿来组装产品级 agent 的 runtime、工具箱和开发环境。

## 2. 产品判断

现在的问题不是“没有 agent 框架”，而是“每个团队都在重新开发同一批底层轮子”：

- 模型调用：OpenAI、Anthropic、Gemini、Ollama、OpenAI-compatible、企业模型网关。
- 标准工具：read、write、edit、list、grep、bash、fetch、browser、git、search。
- 上下文：工作集、摘要、文件引用、长期记忆、token budget、压缩策略。
- 执行循环：tool call、tool result、error recovery、stop condition、human approval。
- 安全：路径边界、shell 权限、敏感信息脱敏、危险命令拦截、工具授权。
- 可观测：每一步为什么调用工具、读了什么、写了什么、花了多少钱、失败在哪里。
- 测试：工具 mock、轨迹 replay、fixture repo、回归 eval。

这个产品的机会在于把这些重复轮子沉淀成一套“agent stdlib + runtime + devtools”。

## 3. 产品定位

### 3.1 我们是什么

我们是：

- 给 agent 开发者用的 runtime platform。
- 给二次开发者用的 agent 标准工具箱。
- 给产品团队用的本地优先 agent 开发环境。
- 给企业平台团队用的可插拔、可观测、可控 agent 执行层。

一句更锋利的定位：

> Build agents without rebuilding the agent runtime.

中文可以说：

> 做 agent，不从 agent loop 和工具协议开始。

### 3.2 我们不是什么

我们不是：

- 不是 Dify 式的低代码工作流平台。
- 不是 LangChain/LangGraph 式的纯框架入口。
- 不是 OpenHands/Claude Code/Codex 的 coding agent 替代品。
- 不是 OpenClaw 式的个人生活助理成品。
- 不是只提供 provider adapter 的薄 SDK。

我们要做的是一个“产品化的 runtime”。开发者可以用 CLI 快速启动，也可以用 SDK 嵌入自己的 agent 产品，还可以用 trace studio 观察和调试运行轨迹。

## 4. 核心用户

### 4.1 独立开发者 / 开源作者

他们想做一个自己的 agent，但不想重复写文件工具、shell 工具、模型 provider、上下文管理和日志。

他们的成功标准：

- 10 分钟内跑起来。
- 1 小时内能接自己的工具。
- 1 天内能发布一个可以演示的 agent。

### 4.2 Agent 产品团队

他们想把 agent 能力嵌入已有产品，比如客服、销售、研究、运营、工程助手。

他们的成功标准：

- provider 可替换。
- 工具权限可控。
- 执行过程可追踪、可 replay、可调试。
- 能把私有 API 包装成工具。

### 4.3 企业 AI 平台团队

他们在内部支持多个业务团队做 agent，希望底层安全、审计、成本、权限和模型路由统一。

他们的成功标准：

- 能接 LiteLLM、OpenAI-compatible gateway 或企业自研网关。
- 能接 MCP server、内部 HTTP API、数据库和搜索。
- 能输出 OpenTelemetry / Langfuse / Phoenix 兼容 trace。
- 能做审计、权限和成本控制。

## 5. 现有产品参照

| 产品 | 它做得好的地方 | 我们复用/借鉴什么 | 我们避开什么 |
| --- | --- | --- | --- |
| Dify | 开源 LLM 应用开发平台，集成 workflow、RAG、agent、model management、observability，并提供大量内置工具 | 学它的 provider 管理、工具生态、从 prototype 到 production 的产品路径 | 不先做低代码画布，不把产品重心放在 no-code app builder |
| LangGraph | 长任务、有状态 agent 编排，支持 durable execution、human-in-the-loop、短期/长期 memory、trace/debug | 借鉴状态持久化、暂停恢复、human approval、graph 思想 | 不把用户第一入口做成低层 graph API |
| Mastra | TypeScript agent 框架，包含 agents、workflows、memory、MCP、evals、observability | 借鉴 TS DX、项目结构、workflow 与 agent 并存、生产化能力 | 避免变成泛 AI app framework，聚焦 runtime/toolbox |
| OpenHands | SDK、CLI、Local GUI、Cloud 的产品层次清楚，围绕 software agent 形成完整体验 | 借鉴 SDK + CLI + GUI 的分层，借鉴 coding agent 的工具组合和本地运行体验 | 不只做 coding agent，不绑定开发任务单一场景 |
| OpenAI Codex | 开源 coding agent CLI，强调终端内运行、本地项目理解、ChatGPT 账号/API key 登录、配置化 sandbox/approval、可和 IDE/云端产品线衔接 | 借鉴 CLI 第一体验、项目说明文件、sandbox/approval UX、会话/配置组织、从本地 CLI 到产品矩阵的层次 | 不把产品限定成 coding agent；不复制 Codex 的模型/账号绑定和具体产品边界 |
| OpenClaw | 本地优先、聊天入口、技能系统、长期运行、主动任务、通信渠道集成 | 借鉴 local-first、skills、heartbeat、个人/团队 assistant 的体验野心 | 第一阶段不做生活助理大而全，不把通讯渠道作为主入口 |
| learn-coding-agent | 对 Claude Code 类 CLI agent 的公开资料做系统拆解，强调 core loop 之外的 production harness：权限、并发工具、压缩、子 agent、持久任务、MCP、会话持久化 | 借鉴“12 层 harness”思路，尤其是 append-only loop、tool_result 注入、context compression、knowledge on demand、session JSONL、权限流 | 不把未验证的逆向细节当事实依赖；不照搬 Claude Code，而是吸收产品结构和工程模式 |
| MCP | 工具和外部数据源标准协议，已有多语言 SDK、server 列表、inspector | 原生支持 MCP client/server，工具协议尽量兼容 MCP | 不自造一套封闭工具生态 |
| Vercel AI SDK | TypeScript 模型调用、tool calling、streaming、provider 抽象成熟 | 优先复用它做 TS 模型调用和 provider layer | 不重复写所有 provider adapter |
| LiteLLM | OpenAI 格式统一调用 100+ LLM provider，支持 proxy、成本、guardrails、load balancing | 企业/团队部署可直接接 LiteLLM，作为 model gateway 选项 | 不在第一版自研模型网关 |
| Langfuse / Phoenix | trace、eval、prompt management、debug、AI observability | trace 数据结构向 OpenTelemetry 兼容，并提供导出适配 | 不第一版做完整 LLMOps 平台 |
| browser-use | 把网站变成 agent 可操作工具，Playwright 生态成熟 | 浏览器工具优先接 browser-use 或 Playwright adapter | 不手写浏览器自动化核心能力 |

参考链接：

- Dify: https://github.com/langgenius/dify
- LangGraph: https://github.com/langchain-ai/langgraph
- Mastra: https://github.com/mastra-ai/mastra
- OpenHands: https://github.com/All-Hands-AI/OpenHands
- OpenAI Codex: https://github.com/openai/codex
- OpenAI Prompt Caching: https://platform.openai.com/docs/guides/prompt-caching
- OpenClaw: https://openclaw.ai/
- learn-coding-agent: https://github.com/sanbuphy/learn-coding-agent
- MCP: https://github.com/modelcontextprotocol
- Vercel AI SDK: https://ai-sdk.dev/docs/introduction
- LiteLLM: https://github.com/BerriAI/litellm
- Langfuse: https://github.com/langfuse/langfuse
- Phoenix: https://github.com/Arize-ai/phoenix
- browser-use: https://github.com/browser-use/browser-use

## 6. 差异化

### 6.1 产品化，而不是纯框架

很多框架的问题是：能力很强，但开发者第一天仍然要自己设计目录、工具协议、上下文、日志、权限、测试。

我们的第一体验必须是：

```bash
agentbase init
agentbase provider add openai
agentbase run "inspect this repo and summarize risks"
agentbase trace open
```

开发者先看到一个会跑、可观察、可修改的 agent，再进入 SDK 和扩展。

### 6.2 标准工具先做好

大量 agent 项目的核心工具都差不多：

- `read_file`
- `write_file`
- `edit_file`
- `list_files`
- `search_files`
- `run_shell`
- `git_status`
- `git_diff`
- `fetch_url`
- `web_search`
- `browser_open`

这些工具要做成标准实现，而不是 example code。标准实现要包含 schema、权限、错误模型、trace、测试、跨平台处理和安全边界。

### 6.3 Context Orchestrator 是核心模块

很多 agent 失败不是模型不行，而是上下文供应方式混乱。这里不能只做一个“摘要器”，而要做 Context Orchestrator：它决定哪些东西进入模型、以什么顺序进入、保留多久、什么时候只保留引用、什么时候按需重新加载正文。

Context Orchestrator 要把以下内容产品化：

- 当前任务目标。
- 当前 working set。
- 已读文件摘要。
- 重要发现。
- 待办事项。
- 工具调用历史摘要。
- token budget。
- 需要保留的硬上下文。
- 可以压缩的软上下文。
- 用户当前轮选中的上下文。
- 被 pin 住的长期上下文。
- 工具结果 artifact/ref。
- prompt cache 友好的稳定前缀。
- 当前轮动态后缀。

设计原则：

- 交互历史保持 append-only：用户消息、assistant 消息、tool_use、tool_result 不在逻辑上改写，只通过 compaction/materialization 改变“本轮给模型看到什么”。
- 上一轮用户临时选中的内容默认不继续保留；只有用户 pin、agent promote，或被压缩成 summary/working set 后才跨轮保留。
- tool result 默认不全文常驻上下文。每个结果落成 `artifact/ref + summary + preview`，需要时再通过 read/materialize 工具重新取正文。
- 最新一轮的关键具体内容可以作为靠后的 user/context message 注入，让模型优先看到新鲜信息。
- 稳定前缀尽量不变，动态内容靠后，避免破坏 prompt cache。
- 对模型可见的上下文应可解释：trace 里必须能看到本轮为什么包含/排除了某个 context item。

一个合理的上下文层次：

```txt
Stable Prefix：
  system instructions
  tool schemas
  policy summary
  project memory / pinned rules

Session State：
  current task
  compacted history summary
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
  last-turn concrete tool result
  pending approval/error
```

这件事是产品差异化重点：用户可以选择“这一轮把什么放进上下文”，但 runtime 负责把它变成可控、可缓存、可追踪、可压缩的上下文计划，而不是把所有东西永久塞进 messages。

### 6.4 可观测是默认能力

每一次运行默认产生 trace：

- 模型输入输出。
- 工具调用参数和结果。
- 文件读写 diff。
- shell 命令和退出码。
- token 和成本。
- 权限请求。
- 错误和 retry。
- context snapshot。

没有 trace 的 agent 开发体验是黑箱。我们的产品从第一天就要让开发者知道 agent 为什么这么做。

### 6.5 协议兼容优先

我们不靠封闭生态取胜。优先兼容：

- MCP：工具和资源协议。
- OpenAI-compatible API：模型网关。
- OpenTelemetry：trace 事件。
- JSON Schema：工具输入输出。
- SQLite/JSONL：本地 run 数据。

## 7. 产品形态

### 7.1 CLI

第一入口是 CLI：

```bash
agentbase init
agentbase run "analyze this repo"
agentbase tools list
agentbase tools add mcp ./servers/github.ts
agentbase trace list
agentbase trace open <run-id>
agentbase eval run ./evals/repo-summary.yaml
```

CLI 负责：

- 初始化项目。
- 配置 provider。
- 运行 agent。
- 管理工具。
- 查看 trace。
- 运行 replay/eval。

### 7.2 SDK

SDK 是真正的 runtime：

```ts
import { createAgent, createRuntime } from "@agentbase/core";
import { fsTools, shellTool, grepTool } from "@agentbase/tools";
import { aiSdkProvider } from "@agentbase/provider-ai-sdk";

const runtime = createRuntime({
  model: aiSdkProvider({ model: "openai/<model-name>" }),
  tools: [fsTools(), shellTool(), grepTool()],
  context: "default",
  policy: "workspace-write",
});

const agent = createAgent({
  name: "repo-analyst",
  instructions: "Inspect repositories and produce concise engineering reports.",
});

await runtime.run(agent, {
  input: "Find risky areas in this repo.",
});
```

### 7.3 Trace Studio

第一版可以是本地 Web UI：

```bash
agentbase trace open
```

功能：

- Run 列表。
- Timeline。
- Messages。
- Tool calls。
- Context snapshots。
- File diffs。
- Cost/token。
- Replay 按钮。

### 7.4 Tool Registry

工具注册表不一定第一版做云市场，但本地 manifest 要先定：

```json
{
  "name": "shell",
  "version": "0.1.0",
  "description": "Run shell commands inside a workspace",
  "permissions": ["shell:run"],
  "entry": "@agentbase/tools-shell",
  "schema": "./tool.schema.json"
}
```

### 7.5 Provider Hub

Provider 不是全部自研。第一版支持：

- AI SDK provider adapter。
- OpenAI-compatible HTTP adapter。
- LiteLLM adapter。
- Ollama adapter。
- Mock model provider，用于测试和 replay。

Search provider 第一版支持：

- 无搜索模式。
- Tavily/Exa/Brave/Serper 任选 1-2 个官方 adapter。
- 自定义 HTTP search adapter。

## 8. MVP

### 8.1 MVP 目标

让一个开发者在 10 分钟内得到一个可运行、可观察、可扩展的本地 agent runtime。

第一条 demo 路径：

```bash
agentbase init repo-agent
cd repo-agent
agentbase provider add openai
agentbase run "inspect this repository and write a short technical map"
agentbase trace open
```

### 8.2 MVP 必须包含

- TypeScript SDK。
- CLI。
- 默认 agent loop。
- 默认 Context Orchestrator：stable prefix / dynamic suffix、tool result ref/summary、selected context、context snapshot。
- 标准文件工具：read、write、edit、list、glob、grep。
- shell 工具：带权限策略和 workspace cwd 限制。
- git 工具：status、diff、show。
- model provider：AI SDK 或 OpenAI-compatible。
- trace：JSONL + SQLite 二选一，建议先 JSONL 后 SQLite。
- replay：能用 mock provider 回放工具轨迹。
- project template：repo analyst agent。
- 单元测试和 CLI smoke test。

### 8.3 MVP 不做

- 不做完整可视化 workflow builder。
- 不做 RAG 知识库平台。
- 不做云端多租户。
- 不做企业 RBAC。
- 不做完整插件市场。
- 不做通讯渠道入口。
- 不做自主长期后台任务，先保留 heartbeat 接口。

## 9. 用户故事

### 9.1 开发者快速做一个 repo agent

作为开发者，我希望运行一条命令创建 repo agent，这个 agent 能读文件、搜索代码、跑测试、输出 trace。

验收：

- 初始化后有可运行 example。
- 没有配置真实 API key 时可以用 mock provider 跑测试。
- 每个 tool call 都能在 trace 中看到。

### 9.2 接入自己的工具

作为开发者，我希望把公司内部 API 包装成一个工具，而不是重写 agent loop。

验收：

- 工具只需要提供 name、description、inputSchema、execute。
- 工具错误能被 runtime 规范化。
- 工具调用能进入 trace。

### 9.3 控制权限

作为开发者，我希望 shell/write/browser 这类高风险工具默认受限。

验收：

- 只能访问 workspace root 内路径。
- 写文件和 shell 默认需要 policy 允许。
- 危险命令进入 approval 或 block。
- trace 记录权限决策。

### 9.4 调试失败运行

作为 agent 开发者，我希望打开 trace，看到 agent 为什么失败，并能 replay。

验收：

- trace 可按 run_id 打开。
- 每一步包含 messages、context snapshot、tool call、tool result。
- replay 能重现同样的工具结果，方便改 prompt 或 context manager。

## 10. 信息架构

### 10.1 核心对象

```txt
Runtime
  Agent
  ModelProvider
  ToolRegistry
  ContextManager
  PolicyEngine
  TraceStore

Run
  RunState
  Messages
  ToolCalls
  Artifacts
  Events
  Costs
```

### 10.2 Tool 接口

```ts
export type Tool<Input = unknown, Output = unknown> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  permissions?: PermissionRequest[];
  execute(input: Input, ctx: ToolExecutionContext): Promise<ToolResult<Output>>;
};

export type ToolResult<Output = unknown> = {
  ok: boolean;
  output?: Output;
  error?: ToolError;
  artifacts?: ArtifactRef[];
  metadata?: Record<string, unknown>;
};
```

### 10.3 ModelProvider 接口

```ts
export type ModelProvider = {
  name: string;
  complete(request: ModelRequest, ctx: ModelContext): Promise<ModelResponse>;
  stream?(request: ModelRequest, ctx: ModelContext): AsyncIterable<ModelEvent>;
};
```

### 10.4 ContextManager 接口

```ts
export type ContextManager = {
  prepare(input: ContextPrepareInput): Promise<PreparedContext>;
  observe(event: RuntimeEvent): Promise<void>;
  compact?(state: RunState): Promise<RunState>;
};
```

## 11. 默认 agent loop

第一版不要追求复杂 plan-and-execute。默认 loop 要稳定、可测试：

```txt
1. 接收 user input
2. context manager 生成 messages
3. model provider 返回 assistant message 或 tool calls
4. policy engine 检查 tool call
5. tool executor 执行工具
6. trace store 写入事件
7. context manager observe 事件
8. 重复直到 final answer、max steps、policy stop 或 error stop
```

默认停止条件：

- 模型返回 final answer。
- 达到 maxSteps。
- 连续工具错误超过阈值。
- policy 要求人工确认但当前运行非交互。
- token/cost budget 触顶。

## 12. 权限模型

默认 policy：

| Policy | 含义 |
| --- | --- |
| `read-only` | 只能读 workspace 和搜索，不能写文件，不能 shell |
| `workspace-write` | 允许 workspace 内写文件，shell 需要 allowlist |
| `developer` | 允许 shell，但危险命令需要确认 |
| `trusted` | 允许所有声明工具权限，仍记录 trace |

高风险行为：

- 删除文件或目录。
- 写 workspace root 外路径。
- 修改 `.env`、密钥文件、SSH/GPG 配置。
- 执行 `rm -rf`、`curl | sh`、`sudo`、磁盘格式化、权限提升。
- 网络请求带疑似密钥。
- 浏览器中提交表单或付款。

## 13. 关键指标

开发者体验指标：

- Time to first run：小于 10 分钟。
- Time to first custom tool：小于 30 分钟。
- Example success rate：大于 90%。
- Trace coverage：100% run event 可追踪。

运行质量指标：

- Tool schema validation failure rate。
- Tool error recovery rate。
- Replay determinism。
- Context overflow rate。
- Cost per run。

产品增长指标：

- npm installs。
- GitHub stars。
- template usage。
- custom tools count。
- community MCP/tool adapters。

## 14. 命名建议

可选：

- AgentBase
- AgentKit
- AgentStdlib
- AgentFoundry
- Toolbase
- AgentRuntime

我建议暂用内部名 `AgentBase`，因为它直观表达“基础底座”，也不会把产品限定为 tool 或 workflow。

## 15. 最小发布包装

首版 README 应该只讲一件事：

> Stop rebuilding the agent runtime.

首屏 demo：

```bash
npm create agentbase@latest
cd my-agent
pnpm agentbase run "inspect this repo"
pnpm agentbase trace open
```

首版 examples：

- `repo-analyst`：读 repo、grep、总结模块。
- `test-runner`：跑测试、读失败、提出修复建议。
- `research-agent`：search + fetch + summarize。
- `tool-designer`：读取一个 API 文档，生成 tool schema 草案。
