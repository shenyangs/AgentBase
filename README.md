# AgentBase

**一套可复用的 agent runtime 标准底座。**

AgentBase 是一个 local-first、TypeScript-first 的 agent runtime platform，面向想把 agent 从 demo 做成产品的开发者和团队。它把构建 agent 时反复需要的底层能力沉淀成一套可以复制、测试和二次开发的工程底座：运行循环、上下文编排、工具标准库、权限策略、trace/replay/eval、memory/wiki、multi-agent workflow、Studio 治理面。

它的核心链路很朴素：

```txt
CLI -> Runtime -> Context -> ModelProvider -> ToolCall -> ToolExecutor -> Trace
```

## 为什么做 AgentBase

现在开源社区不缺 agent demo。真正缺的是一套可以长期使用、能解释、能治理、能回放、能评测、能扩展的 runtime contract。

很多团队做 agent 时都会重复踩同一批坑：

- 工具调用没有统一 schema 和权限边界。
- 运行过程不可解释，失败后只能改 prompt 碰运气。
- 文件、shell、git、browser、database、MCP 等工具每个项目都重写一遍。
- 上下文管理靠拼字符串，后续很难做缓存、引用、记忆和压缩。
- 没有 replay/eval，无法判断一次 prompt 或 tool 改动有没有造成回归。
- “自进化”和“记忆”容易变成黑箱自动写配置，无法审计和回滚。

AgentBase 的核心判断是：**未来 agent 产品的竞争，不应该浪费在重复写 runtime harness 上，而应该回到产品判断、领域工具、上下文质量、工作流和记忆治理。**

## 你可以用它做什么

你可以把 AgentBase 当作一个本地开源 agent 平台底座，用来：

- 搭一个 repo analyst、test runner、research agent、tool designer、memory curator。
- 为自己的产品接入安全的文件、shell、git、HTTP、browser、database、MCP、code index 工具。
- 给 agent 每次运行留下 append-only trace，方便解释行为和排查失败。
- 用 context snapshot 观察模型到底看到了什么证据、记忆、工具结果和最新 preview。
- 用 replay/eval/guardrail/conformance 给 prompt、tool 和 context 改动建立回归证据。
- 用 local Studio 查看 run timeline、tool calls、artifacts、approvals、memory、wiki、eval 和 settings。
- 在本地先做一个可治理的 agent runtime，再按需要二次开发成自己的产品。

一句话：

> AgentBase 帮你把 agent runtime 的公共底座搭好，让你把精力放回产品、领域工具和真实用户问题。

## 当前状态

这是 **v0.1 public preview / Local-First 1.0 RC**。

它已经可以从源码 clone、安装、构建、运行、查看 trace、打开 Studio、跑 reference patterns 和 conformance。当前发布形态是源码优先，适合开源社区试用、学习 runtime 模式，并在此基础上做二次开发。

当前检索路线是 lexical/FTS-first；本地向量检索会作为 1.x 插件继续推进。

## 快速开始

要求：

- Node.js 24+
- pnpm 11+

```bash
pnpm install
pnpm build
pnpm test
```

源码版 CLI：

```bash
pnpm agentbase --help
```

5 分钟跑通一个 mock agent：

```bash
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase provider set mock --model mock/repo-analyst --cwd /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase trace list --cwd /tmp/agentbase-demo
pnpm agentbase trace show <run-id> --cwd /tmp/agentbase-demo
```

跑一个 reference pattern：

```bash
pnpm agentbase patterns list
pnpm agentbase patterns init repo-analyst /tmp/agentbase-pattern
pnpm agentbase patterns run repo-analyst --target /tmp/agentbase-pattern-run
```

打开本地治理台：

```bash
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

完整发布检查：

```bash
pnpm release:check
```

`pnpm release:check` 会跑 build、contract tests、test、e2e、reference patterns 和 conformance。

## 如果你是小白，可以让 Codex 帮你拼一个 agent

clone 并 build 之后，把这段话交给 Codex：

```txt
Use AgentBase from this repository. Create a new agent workspace for this goal:
<describe my goal>. Start from the closest reference pattern, edit
.agentbase/agent.json, choose the safest default tools, add a minimal eval
suite, run it with --mock, inspect the trace, and tell me the smallest next
change to improve it.
```

更详细的手动路径见 [Build Your First Agent](docs/build_your_first_agent.md)。

## 核心工程契约

AgentBase 的核心价值是把这些约束做成能被测试、审计和复用的工程契约：

- **append-only trace**：运行事实不被覆盖，失败后能回看。
- **policy-first execution**：高风险工具先过 policy 和 approval。
- **tool-result ref envelope**：大结果进入 artifact，只把 summary/ref/preview 给模型。
- **context budget planner**：上下文按预算、分层和来源组装，并保留 snapshot。
- **approval checkpoint**：危险动作可以暂停、批准、拒绝、恢复。
- **deterministic replay**：用 recorded events 重放，降低真实网络/DB/browser 对回归排查的干扰。
- **eval-gated evolution**：prompt、memory、policy、skill 改动必须有证据，能回滚。
- **experience to capability**：把成功任务从 trace 沉淀为 event/atom/lesson，再推广成可复用 capability。
- **local-first governance**：SQLite、本地 trace、本地 Studio、本地 server，先把治理闭环放在开发者手里。

## 内置能力

运行时与治理：

- `@agentbase/core`：runtime loop、tool registry、tool executor、policy、approval-aware run state、mock provider。
- `@agentbase/config`：CLI/server/Studio 共用的 config load/validate/patch/redact。
- `@agentbase/stores-sqlite`：runs、sessions、events、artifacts、memory、wiki、evals、code index、approvals、audit。
- `@agentbase/trace`：JSONL trace store、secret redaction、OpenTelemetry-ish、OpenInference/Phoenix-ish、Langfuse-ish export。
- `@agentbase/replay`：trace loader、deterministic replay、model/tool diff。
- `@agentbase/evals`：JSON/YAML eval suite、status/steps/tool/latency/cost/guardrail assertions。
- `@agentbase/guardrails`：prompt injection、secret、workspace escape、dangerous action、memory poisoning 扫描。

上下文、记忆与知识：

- `@agentbase/context-default`：stable prefix、policy、tools、memory、wiki/code hits、artifact refs、latest preview。
- `@agentbase/memory`：durable memory primitives、proposal/review/promotion governance。
- `@agentbase/experience`：event、atom、lesson 经验账本。
- `@agentbase/capabilities`：从 task run 到 capability draft，再到 promoted capability。
- `@agentbase/wiki`：repo wiki indexer，可以把代码、文档和决策沉淀成可查询上下文。
- `@agentbase/code-index`：symbols、references、outline、workspace index。

工具与 provider：

- `@agentbase/tools-fs`：workspace-safe read/write/list/search。
- `@agentbase/tools-shell`：policy-checked shell execution。
- `@agentbase/tools-git`：read-only git status/diff/show/log。
- `@agentbase/tools-web`：fetch/search tools with pluggable SearchProvider。
- `@agentbase/tools-http`：policy-gated HTTP request，带 redaction 和 artifact-backed body。
- `@agentbase/tools-browser`：Playwright managed/CDP browser tools。
- `@agentbase/tools-database`：SQLite/Postgres/MySQL database tools，读写 policy gate。
- `@agentbase/mcp`：MCP manifest、stdio/http tool loading、AgentBase tool adaptation。
- `@agentbase/provider-openai-compatible`、`@agentbase/provider-litellm`、`@agentbase/provider-ai-sdk`、`@agentbase/provider-ollama`。

产品面：

- `@agentbase/cli`：init/run/session/approval/config/tools/provider/memory/wiki/experience/capability/replay/eval/guardrail/evolve/team/studio/serve/export/backup/trace。
- `@agentbase/server`：本地单租户 HTTP API，带 token auth、redaction、audit、settings、runs、approvals、artifacts、evals、export push。
- `@agentbase/studio-ui` + `@agentbase/studio`：本地 React Studio，用于调试、观测和治理。

## Reference Patterns

AgentBase 内置五个已检查的 reference patterns：

- `repo-analyst`：检查仓库，基于 file/git/code-index evidence 生成摘要。
- `test-runner`：通过 policy-gated shell 运行测试并总结失败。
- `research-agent`：把外部材料作为 untrusted evidence，分离来源和综合。
- `tool-designer`：把工具需求转成 schema、permissions、risk、envelope、trace、tests。
- `memory-curator`：只把有来源、可复用、非 secret、scope 清晰的信息推广为长期记忆。

```bash
pnpm references
pnpm agentbase patterns list
pnpm agentbase patterns show test-runner
pnpm agentbase patterns init test-runner /tmp/agentbase-test-runner
pnpm agentbase patterns run test-runner --target /tmp/agentbase-test-runner-run
```

更多见 [Reference Patterns](docs/reference_patterns.md)。

## Studio 快速演示

```bash
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase guardrail scan --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase store doctor --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

打开 Studio 后可以看：

- run timeline
- context snapshot
- tool calls
- artifacts
- guardrail scan
- replay diff
- conformance reports
- settings
- store health / backup / export

完整路径见 [Studio Quick Demo](docs/studio_quick_demo.md)。

## 发布与贡献

本仓库的 release gate：

```bash
pnpm release:check
```

发布文档：

- [Release Notes](docs/release_notes_v0.1.md)
- [Release Process](docs/release_process.md)
- [GitHub-ready Checklist](docs/github_ready_checklist.md)

贡献文档：

- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Tool Authoring Guide](docs/tool_authoring_guide.md)
- [Capability and Experience Ledger](docs/capability_and_experience_ledger.md)
- [AgentBase Doctrine](docs/agentbase_doctrine.md)

---

# AgentBase English Overview

**Build agents without rebuilding the agent runtime.**

AgentBase is a local-first TypeScript runtime platform for product-grade agents. It provides the reusable runtime substrate teams need to build, govern, replay, evaluate, and extend agents: runtime loop, context orchestration, standard tools, policy, trace/replay/eval, memory/wiki, workflow, and Studio.

## Why It Exists

The open-source ecosystem has enough one-off agent demos. What is still missing is a reusable runtime contract: append-only traces, policy-first execution, tool-result refs, budget-planned context, approval checkpoints, deterministic replay, eval-gated evolution, and local governance.

AgentBase exists so teams can stop rebuilding the harness and compete on product judgment, domain tools, memory quality, and workflow design.

## What You Can Build

You can use AgentBase to build:

- repository analysts
- test runners
- research agents
- tool designers
- memory curators
- product-specific agents with safe fs/shell/git/http/browser/database/MCP tools
- local Studio-backed agent governance workflows

## Quickstart

```bash
pnpm install
pnpm build
pnpm test

pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase provider set mock --model mock/repo-analyst --cwd /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase trace list --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

Full release gate:

```bash
pnpm release:check
```

## Release Status

This repository is a **v0.1 public preview / Local-First 1.0 release candidate**. It is ready to clone, build, run, inspect, and extend from source. The first release is source-first; vector retrieval is planned as a later plugin.
