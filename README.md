# AgentBase

**把 agent 从 demo 变成可治理、可回放、可评测的本地运行时。**

AgentBase lets you build product-grade agents with trace, policy, replay, eval,
and local governance without rebuilding the runtime harness.

## What Is AgentBase?

AgentBase 是一个 local-first、TypeScript-first 的 agent runtime platform。它
不是“又一个会调工具的 bot”，而是把产品级 agent 反复需要的公共底座抽出来：
运行循环、上下文编排、工具权限、trace/replay/eval、memory/wiki、approval、
Studio 治理面。

它的核心链路很朴素：

```txt
CLI / Studio / Server
        |
     Runtime -> Context -> ModelProvider
        |            |
 ToolExecutor -> Tool Packages -> Trace / Artifacts / Store
```

## Why Not Another Agent Demo?

开源社区不缺 agent demo。真正难复用的是 runtime contract：

- 工具调用要有统一 schema、权限和输出 envelope。
- 运行事实要能解释，失败后能 trace、replay、diff。
- prompt、context、tool、memory 改动要能被 eval 约束。
- 高风险动作要先 policy check，再 approval/resume。
- 本地数据要能沉淀成 memory、wiki、audit、artifact，而不是散落在日志里。

AgentBase 的判断是：未来 agent 产品的竞争，不应该浪费在重复写 runtime
harness 上，而应该回到产品判断、领域工具、上下文质量、工作流和记忆治理。

## 5-Minute Quickstart

要求：

- Node.js 24+
- pnpm 11+

```bash
pnpm install
pnpm build
pnpm agentbase --help
```

跑通一个 mock repo agent：

```bash
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase provider set mock --model mock/repo-analyst --cwd /tmp/agentbase-demo
pnpm agentbase run "analyze this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase trace list --cwd /tmp/agentbase-demo
pnpm agentbase trace show <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

跑一个 reference pattern：

```bash
pnpm agentbase patterns list
pnpm agentbase patterns init repo-analyst /tmp/agentbase-pattern
pnpm agentbase patterns run repo-analyst --target /tmp/agentbase-pattern-run
```

完整发布检查：

```bash
pnpm release:check
```

`pnpm release:check` 会跑 build、contract tests、test、e2e、reference
patterns 和 conformance。

## Current Status

这是 **v0.1 public preview / Local Runtime Preview**。

当前发布形态是源码优先：仓库可以 clone、安装、构建、运行、查看 trace、打开
Studio、跑 reference patterns 和 conformance；根包仍是 `"private": true`，npm
1.0 发布还不是当前承诺。

稳定性边界见 [STATUS.md](STATUS.md)。简版如下：

- `Usable`: core runtime, filesystem/git tools, trace, replay, eval, guardrails,
  context planner, reference patterns.
- `Preview`: CLI, SQLite store, local server, Studio, memory/wiki, orchestration,
  relay, capability/experience ledger.
- `Experimental`: shell, HTTP/web/browser/database/MCP tools, provider adapters.
- `Planned`: vector retrieval, hosted control plane, npm 1.0 packages.

当前检索路线是 lexical/FTS-first；本地向量检索会作为 1.x 插件继续推进。

## Security Model

AgentBase 当前提供的是本地策略门禁、approval、trace/audit、redaction 和
workspace path guard。它们是治理控制，不是强沙箱。

尤其要注意：

- shell policy 是基于规则和模式的 guardrail，不等于进程隔离；
- browser、HTTP、database、MCP 工具可能访问外部或用户控制的系统；
- 外部内容必须作为 untrusted evidence 进入 context，不能覆盖 system、
  developer 或 policy 指令；
- 强隔离需要容器、独立 OS 用户、网络限制或平台 sandbox。

## What You Can Build

你可以把 AgentBase 当作一个本地开源 agent 平台底座，用来：

- 搭一个 repo analyst、test runner、research agent、tool designer、memory curator。
- 为自己的产品接入文件、shell、git、HTTP、browser、database、MCP、code index 工具。
- 给 agent 每次运行留下 append-only trace，方便解释行为和排查失败。
- 用 context snapshot 观察模型到底看到了什么证据、记忆、工具结果和最新 preview。
- 用 replay/eval/guardrail/conformance 给 prompt、tool 和 context 改动建立回归证据。
- 用 local Studio 查看 run timeline、tool calls、artifacts、approvals、memory、wiki、eval 和 settings。
- 在本地先做一个可治理的 agent runtime，再按需要二次开发成自己的产品。

源码版 CLI：

```bash
pnpm agentbase --help
```

Contract tests 会验证 tool/provider、tool-result envelope、workflow result、
specialist manifest、context layers、relay mailbox 和 local runtime security。

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
如果你已经知道“我想做 X agent”，直接看 [Agent Recipes](docs/agent_recipes.md)。

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
- **relay control plane**：把 run、team、approval、export、eval 等异步入口统一成 mailbox 状态机。
- **specialist manifest**：让多 agent 角色有 trigger、handoff、freshness、risk 和 result contract。
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
- `@agentbase/relay`：本地 mailbox，把外部入口和异步交付统一成可审计消息。

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
按具体目标拼 agent 的教程见 [Agent Recipes](docs/agent_recipes.md)。

## Studio 快速演示

```bash
pnpm agentbase demo /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

也可以手动走完整路径：

```bash
pnpm agentbase init /tmp/agentbase-demo
pnpm agentbase run "summarize this repo" --mock --cwd /tmp/agentbase-demo
pnpm agentbase workspace show --cwd /tmp/agentbase-demo
pnpm agentbase memory curate --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase guardrail scan --run <run-id> --cwd /tmp/agentbase-demo
pnpm agentbase store doctor --cwd /tmp/agentbase-demo
pnpm agentbase studio --cwd /tmp/agentbase-demo
```

打开 Studio 后可以看：

- run timeline
- workspace cockpit
- context snapshot
- tool calls
- white-box memory lineage
- artifacts
- inbox / background tasks
- guardrail scan
- replay diff
- conformance reports
- settings
- store health / backup / export

完整路径见 [Studio Quick Demo](docs/studio_quick_demo.md)。
前端长什么样、每个面板展示什么，见 [Studio Frontend](docs/studio_frontend.md)。

## 和 PilotDeck / OpenClaw / Claude Code 的关系

AgentBase 会认真吸收这些项目已经验证过的产品判断：工作区隔离、白盒记忆、后台任务、工具插件、模型路由和可见的运行治理。我们的落点是 runtime 标准底座：把这些能力沉淀成可复用接口、trace/audit 事件、conformance tests 和 Studio 治理面，让社区可以基于 AgentBase 构建自己的 agent OS、coding agent、研究 agent 或企业内部 agent 平台。

本轮采用 clean-room 吸收：学习产品模式和接口思想，不直接复制不兼容许可证源码。

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
- [Studio Frontend](docs/studio_frontend.md)
- [Agent Recipes](docs/agent_recipes.md)
- [Capability and Experience Ledger](docs/capability_and_experience_ledger.md)
- [Runtime Control Plane and Specialists](docs/runtime_control_plane_and_specialists.md)
- [Workspace Cockpit](docs/workspace_cockpit.md)
- [White-Box Memory](docs/white_box_memory.md)
- [Provider Router](docs/provider_router.md)
- [Always-On Relay](docs/always_on_relay.md)
- [Plugin Lifecycle Hooks](docs/plugin_lifecycle_hooks.md)
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

The release gate covers build, contract tests, unit tests, E2E smoke, reference patterns, and local-first conformance. Contract tests include tools/providers, tool-result envelopes, workflow results, specialist manifests, context layers, relay mailbox behavior, and local runtime security.

## Release Status

This repository is a **v0.1 public preview / Local Runtime Preview**. It is ready to clone, build, run, inspect, and extend from source. The first release is source-first; vector retrieval is planned as a later plugin.
