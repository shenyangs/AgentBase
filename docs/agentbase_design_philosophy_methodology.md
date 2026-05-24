# AgentBase 设计初衷、哲学和方法论

资料日期：2026-05-20

## 1. 文档目的

这份文档回答三个问题：

- 为什么需要 AgentBase。
- AgentBase 相信什么样的 agent runtime 是长期正确的。
- 这个项目用什么方法把这些信念落到工程实现里。

已有的产品文档说明“要做什么”，开发方案说明“怎么分阶段做”。本文更关注设计背后的判断：AgentBase 不是为了再造一个 agent demo，而是为了把产品级 agent 反复需要的运行时能力沉淀成一个可复用、可观察、可扩展、可治理的底座。

一句话：

> AgentBase 的目标是让开发者做 agent 产品，而不是每次都重写 agent runtime。

## 2. 设计初衷

### 2.1 从重复造轮子中抽出标准底座

大多数 agent 项目都会很快遇到同一批底层问题：

- 模型怎么接入、替换和 mock。
- 工具怎么声明 schema、校验输入、执行和返回结果。
- 文件、shell、git、web、search 这些标准工具怎么安全实现。
- 上下文怎么组织，哪些内容应该进入模型，哪些内容只保留引用。
- shell、写文件、网络访问这类高风险能力怎么受控。
- 运行过程如何 trace、replay、eval。
- 失败后如何定位，不靠猜 prompt。
- 能力演进如何经过证据和测试，而不是靠直觉改系统。

如果每个团队都从零写这些模块，最后得到的往往不是差异化产品，而是一批脆弱、不可观察、难测试的私有 agent loop。AgentBase 的设计初衷，就是把这些通用能力做成“agent stdlib + runtime + devtools”。

### 2.2 把 agent loop 从 demo 推到产品级

一个最小 agent loop 并不复杂：用户输入、模型响应、工具调用、工具结果、再问模型。但产品级 agent 的难点通常不在 loop 本身，而在 loop 周围的 harness：

- policy：什么能做，什么不能做。
- context：模型每一步究竟看到了什么。
- trace：每一步为什么发生。
- artifacts：大结果如何保存和重新取用。
- replay：一次运行能否被复盘。
- eval：行为是否能被回归测试保护。
- provider：模型、搜索、工具生态能否被替换。

因此 AgentBase v0.1 聚焦的不是“最多功能”，而是跑通一条最小但完整的产品级闭环：

```txt
CLI -> Runtime -> Context -> ModelProvider -> ToolCall -> ToolExecutor -> Trace -> Replay
```

这个闭环定义了项目的第一性原理：每个模块都必须服务于可运行、可解释、可复用、可演进。

### 2.3 本地优先，开发者优先

AgentBase 首先是开发者工具，不是云平台的附属入口。

本地优先意味着：

- 项目可以在本机初始化和运行。
- trace、artifact、memory、wiki、evolution proposal 第一版都可以落在本地文件。
- 没有真实 API key 时也能通过 mock provider 测试 runtime。
- 开发者可以直接打开生成的 JSONL、JSON、Markdown 和代码理解系统行为。

开发者优先意味着：

- CLI 是第一入口，不只是内部调试脚本。
- SDK 是真实运行时，不是示例代码。
- 标准工具必须能直接用于真实项目，而不是“仅供参考”。
- 每个扩展点都应该有清晰接口：ModelProvider、Tool、ContextManager、TraceStore、ArtifactStore、MemoryStore。

## 3. 设计哲学

### 3.1 Runtime 是产品，不是代码片段

AgentBase 不把 runtime 看作几百行循环代码，而是看作一个产品化执行层。它要承担稳定接口、默认安全、可观测、可测试和可替换的责任。

这也是项目拆成多个 package 的原因：

- `@agentbase/core` 定义核心类型和运行循环。
- `@agentbase/context-default` 负责默认上下文编排。
- `@agentbase/tools-*` 提供标准工具。
- `@agentbase/provider-*` 适配不同模型入口。
- `@agentbase/trace`、`@agentbase/replay`、`@agentbase/evals` 支撑调试和质量闭环。
- `@agentbase/artifacts`、`@agentbase/memory`、`@agentbase/wiki` 管理运行中产生和沉淀的知识。
- `@agentbase/orchestrator`、`@agentbase/evolution` 为多 agent 协作和可控演进预留结构。

拆包不是为了复杂，而是为了让边界清楚：runtime 负责协调，工具负责能力，provider 负责模型，context 负责输入计划，trace 负责证据。

### 3.2 上下文不是拼接，而是编排

Agent 的质量很大程度取决于模型每一步看到了什么。AgentBase 把 context management 设计成核心模块，而不是工具结果和聊天历史的简单拼接。

默认上下文分为几层：

```txt
Stable Prefix：
  agent instructions
  policy summary
  tool manifest
  pinned rules

Session State：
  current task
  compacted history
  working set
  todo / run summary

Reference Layer：
  file refs
  tool result refs
  artifact refs
  search result refs

Dynamic Suffix：
  current user input
  selected context
  latest concrete tool result preview
  pending approval or error
```

这个设计背后有三个判断：

- 稳定内容应该尽量稳定，方便 prompt cache。
- 新鲜证据应该靠后出现，方便模型当前轮使用。
- 大结果不应该长期塞进 messages，而应该变成 ref、summary 和 preview，需要时再 materialize。

因此工具结果在 AgentBase 中不是普通聊天文本，而是 append-only ref envelope。模型默认看到的是结构化摘要和引用，而不是无限膨胀的原始输出。

### 3.3 证据优先于幻觉，引用优先于粘贴

AgentBase 的运行过程强调证据链：

- 工具调用必须有 schema。
- 输入先校验，再执行。
- policy 决策进入 trace。
- 工具输出被包装成 envelope。
- 大结果保存为 artifact/ref。
- context snapshot 记录包含和排除原因。
- replay 从 trace 中恢复运行事实。

这套设计希望让 agent 的每一步都能被追问：

- 它为什么调用这个工具。
- 它传了什么参数。
- 它拿到了什么结果。
- 它下一步是否真的看到了这个结果。
- 它的最终回答依赖了哪些证据。

对产品级 agent 来说，“回答正确”还不够；必须知道它为什么正确，以及错误时从哪里开始查。

### 3.4 安全是执行模型的一部分

AgentBase 不把安全当作文档里的注意事项，而是放进工具执行路径：

```txt
ToolCall -> schema validation -> policy evaluation -> tool execution -> traced result
```

这意味着：

- 路径访问必须经过 workspace guard。
- shell 命令必须经过风险分级。
- git 工具默认只读。
- 网络工具支持域名 allow/deny。
- policy 可以按 `read-only`、`workspace-write`、`developer`、`trusted` 分层。
- 高风险动作即使未来支持，也应该有 approval 或额外权限流。

安全边界的目标不是让 agent 变得保守到不可用，而是让能力和责任匹配。开发者可以逐步打开权限，但每一次放权都应该是显式、可追踪、可回放的。

### 3.5 可观测是默认能力

没有 trace 的 agent 是黑箱。黑箱可以 demo，但很难产品化。

AgentBase 默认写入运行事件，包括：

- `run.started`
- `context.prepared`
- `model.completed`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `tool.rejected`
- `artifact.created`
- `file.changed`
- `run.completed`
- `run.failed`

trace 的意义不只是日志，而是系统的运行账本。它连接调试、replay、eval、studio 和 evolution。只要 trace 完整，开发者就能从一次失败运行里提取测试、提出改进、验证改进，再决定是否提升到 memory、policy 或工具实现。

### 3.6 协议兼容优先于封闭生态

AgentBase 不靠封闭生态取胜。它的长期价值来自把已有生态编排成统一 runtime：

- 模型侧兼容 OpenAI-compatible、LiteLLM、Ollama、AI SDK 风格 provider。
- 工具侧兼容 JSON Schema 和 MCP。
- trace 侧为 OpenTelemetry、Langfuse、Phoenix 等方向预留。
- 存储侧从 JSONL/JSON 起步，但接口上可以替换成 SQLite、Postgres、向量库或图数据库。

第一版用简单本地存储，不代表长期只能本地文件；关键是接口边界先稳定。

### 3.7 演进必须被测试约束

Agent 系统很容易陷入“这次看起来更聪明”的错觉。AgentBase 把 evolution 设计成有门槛的过程：

```txt
trace -> proposal -> eval gate -> promoted change
```

一次运行暴露的问题可以生成 evolution proposal，但 proposal 不应该直接变成系统行为。它至少要经过 eval 或人工审核，留下可审计记录。这样 memory、policy、prompt、tool 的变化才不会变成不可解释的自我漂移。

## 4. 方法论

### 4.1 先跑通最小有用闭环

项目采用“最小完整闭环优先”的方法，而不是横向铺满功能。

第一阶段只要证明：

- CLI 能初始化和运行。
- runtime 能驱动模型和工具。
- mock provider 能支持无 key 测试。
- context manager 能生成可解释上下文。
- tool executor 能做校验、policy 和 trace。
- trace 能被列出、展示和 replay。

这条链路跑通后，后续加 browser、MCP、Studio、SQLite、eval report、多 agent 才有稳定地基。

### 4.2 接口先行，默认实现保持朴素

AgentBase 的核心接口比默认实现更重要。

默认实现可以很简单：

- trace 用 JSONL。
- artifact 用文件。
- memory 用 JSON。
- search provider 可以是 static 或 HTTP。
- eval 可以先做断言式检查。
- context token estimate 可以先粗略估算。

但接口必须表达未来形态：

- `TraceStore` 能换后端。
- `ArtifactStore` 能 materialize。
- `ContextManager` 能 observe 和 compact。
- `ModelProvider` 能替换模型。
- `Tool` 有 schema、risk、permissions、execute。
- `Policy` 能从简单名字扩展成细粒度规则。

这是一种有意的工程策略：实现先简单，边界先认真。

### 4.3 标准工具按生产路径实现

标准工具不是 demo helper。每个工具都应该经过同一条生产路径：

```txt
declare schema
-> validate input
-> check workspace/policy boundary
-> execute with timeout/output limits when needed
-> normalize result
-> emit trace
-> wrap as artifact/ref envelope
```

文件工具体现路径边界和 diff 记录；shell 工具体现风险分级和输出限制；git 工具体现只读优先；web 工具体现 provider 抽象和域名策略。这些工具越稳定，开发者写自定义工具时越容易照着同一套模式扩展。

### 4.4 Context Orchestrator 按“预算”和“证据”工作

上下文编排不应该只问“能不能放进去”，还要问：

- 这个内容对当前任务是否必要。
- 它是稳定规则、会话状态、引用，还是最新证据。
- 它应该全文进入模型，还是只保留 summary/ref。
- 它会不会破坏 prompt cache 的稳定前缀。
- trace 里能不能解释为什么包含或排除它。

因此 AgentBase 的 context snapshot 记录每个 context item 的 included 状态、reason 和 preview。未来 Trace Studio 可以直接用这些数据解释“模型这一轮到底看到了什么”。

### 4.5 运行事实先落盘，再谈调优

Agent 调优如果没有运行事实，很容易变成凭感觉改 prompt。AgentBase 的方法是先落 trace，再基于 trace 做判断：

```txt
run
-> inspect trace
-> replay
-> write eval
-> adjust prompt/context/tool/policy
-> rerun
-> compare
```

这让调优变成工程流程，而不是神秘经验。

### 4.6 产品入口和 SDK 入口并重

AgentBase 既要能被人使用，也要能被人嵌入。

CLI 解决第一体验：

```bash
agentbase init
agentbase run "summarize this repo" --mock
agentbase trace list
agentbase replay run <run-id>
```

SDK 解决产品集成：

```ts
const runtime = createRuntime({
  workspaceRoot,
  model,
  tools,
  context,
  policy,
  trace
});
```

两条入口必须共享同一个 runtime，而不是各自长出不同逻辑。这样 CLI demo 中验证过的能力，才能成为开发者产品里的真实能力。

### 4.7 先本地可解释，再云端可规模化

AgentBase 的第一阶段选择本地 JSONL/JSON，并不是因为这些存储最强，而是因为它们最透明、最容易调试、最适合验证接口。

长期可以替换为：

- SQLite 或 Postgres run store。
- 向量和图混合 memory。
- OpenTelemetry exporter。
- 多租户权限和审计系统。
- 云端 Trace Studio。

但这些规模化能力应该建立在已经被本地验证过的 runtime contract 上，而不是反过来让云平台形态决定核心抽象。

## 5. 关键设计取舍

### 5.1 为什么不是低代码 workflow builder

低代码画布适合组织流程，但 AgentBase 的第一问题是运行时底座。过早做画布会把注意力从 tool schema、context、policy、trace、replay 这些基础能力上移开。

AgentBase 可以未来承载 workflow UI，但核心必须先成为可靠 runtime。

### 5.2 为什么不是纯框架

纯框架通常给开发者很多 API，但第一天仍然要自己拼项目结构、工具、trace、权限和测试。AgentBase 的判断是：开发者需要的不只是库，还需要一个能直接运行、能直接观察、能逐步替换的产品化起点。

所以项目同时提供 CLI、SDK、标准工具、默认 context、trace/replay/eval。

### 5.3 为什么工具结果要变成 ref envelope

直接把工具输出塞回 messages 有几个问题：

- 大输出会快速撑爆上下文。
- 旧结果长期占用 token。
- 模型很难区分摘要、原文和引用。
- 后续 replay 和 materialize 不清楚。

ref envelope 把工具结果变成结构化事实：

```json
{
  "ok": true,
  "ref": "tool-result://run_x/call_y",
  "toolName": "read_file",
  "summary": "read_file completed (path=README.md, bytes=1234)",
  "preview": "...",
  "metadata": {}
}
```

模型可以先用 summary/preview 推进任务；需要完整内容时，再通过 `materialize_ref` 拉取。这样上下文更稳，证据链也更清楚。

### 5.4 为什么 trace 和 eval 要早做

Trace 和 eval 不是后期质量工程，而是 agent runtime 的基础设施。

没有 trace，就无法解释行为。
没有 replay，就无法复盘失败。
没有 eval，就无法保护改进。
没有 evolution gate，就无法控制系统自我修改。

因此 AgentBase 从 v0.1 就把 trace、replay、eval、evolution proposal 放进平台结构里，即使第一版实现很轻。

## 6. 项目方法的日常准则

后续开发 AgentBase 时，可以用这些准则校验设计：

- 能用接口表达的能力，不要绑定到单个供应商。
- 能被 trace 记录的行为，不要只留在内存里。
- 能用 ref 表达的大结果，不要长期塞进 messages。
- 能通过 policy 决策的风险，不要只靠 prompt 约束。
- 能用 mock provider 测试的链路，不要强依赖真实模型。
- 能先本地验证的存储，不要一开始做成复杂云服务。
- 能在 CLI 里跑通的体验，再沉淀为 SDK 和 Studio 能力。
- 能用 eval 保护的改动，不要只凭一次成功运行合并。
- 能复用成熟生态的模块，不要为了完整感重复造轮子。
- 能保持边界简单的包，不要过早引入跨模块隐式依赖。

## 7. 最终愿景

AgentBase 想成为 agent 产品的运行时底座：

- 开发者可以快速创建一个可运行 agent。
- 产品团队可以嵌入自己的工具和模型。
- 企业平台团队可以统一权限、审计、成本和观测。
- agent 的每一步都有证据、边界和回放能力。
- 系统可以演进，但演进必须经过 trace 和 eval 的约束。

它追求的不是“让 agent 看起来更聪明”，而是让 agent 能够被真实地构建、运行、理解、调试和改进。

如果说传统 agent demo 的中心是模型调用，那么 AgentBase 的中心是运行时契约：

```txt
clear interfaces
+ safe tools
+ orchestrated context
+ append-only evidence
+ observable execution
+ replayable runs
+ eval-gated evolution
= product-grade agents
```

这就是 AgentBase 的设计哲学：把 agent 的创造性留给模型和产品，把 agent 的可靠性放进 runtime。
