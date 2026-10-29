# Agent 调用级选模影响与验收（2026-10-30）

## Feature Summary

- 意图：主智能体在调用子代理时可选择模型；用户已授权实现。
- Capability：subagents / model-selection；层级：validation、commit-effect、draft-default；模式：planning。
- Seeds：AgentInputSchema、agentHandler、createExploreSubagentPort、resolveSubagentSelection。
- 范围外：Settings 控件、父会话换模、工作流调度、历史数据迁移、跨重启 task 发现。

## UI Surface Matrix

| 用户场景 / 入口 | 来源 / 校验 | 提交 / 权威 | 隔离边界 |
| --- | --- | --- | --- |
| 主模型调用 Agent（Desktop/Web/TUI） | ListModels 当前主机目录；model 引用解析 | handler → runner → child ModelFactory | 仅本次 child；父会话、兄弟与 profile 不变 |
| Settings/Markdown 子代理配置 | 原有模型控件与 Host 服务 | 原配置持久化 | 本次不改；调用未指定时仍生效 |
| SendMessage 续跑 | registry 中原调用意图；无覆盖时当前 profile | 既有 child session 与 runtime | 不换 child 身份或创建第二套恢复机制 |
| 动态工作流模型选择 | 共用目录/解析器 | 原 workflow port | 调度与配置不变 |

## Shared And Divergent Behavior

候选、裸名 provider 边界、档位与禁用检查共用 resolveModelReference。
Agent 无参数时优先 profile；工作流无参数时沿用其 session 默认，不能混写提示。
Agent.model 只覆盖执行副本，Settings 保存长期配置，二者不是同一个写入点。

## Feature Relationships

| 等级 | 关系 | 证据 |
| --- | --- | --- |
| must-inspect | tool schema → handler → runner → child runtime | contracts/tools/agent.ts、core/src/tool/handlers/agent.ts、subagent/runner.ts、runtime/methods/subagent.ts |
| must-inspect | ListModels 灰度开关 → Agent 可发现候选 | handlers/index.ts、list-models.ts |
| should-inspect | terminal SendMessage → 本次选模保留 | runner.ts、runtime-task/registry.ts |
| invariant-only | 父 session、兄弟 child、profile、Off-Peak 绑定 | subagent-effective-execution / subagent-profile-fields / subagent-execution-boundaries tests |
| evidence-only | 既有模型引用与 workflow 工具测试 | model-reference / create-workflow-tool / list-models-tool tests |

## State Owners And Commit Sinks

选择意图来自当前 Agent 调用；registry 只保留同一 task 的调用意图以支持现有 SendMessage。
实际 Model 由 child runtime/ModelFactory 创建；持久化复用 child 的 runtime/model_selection。
Host、UI、relay 不新增事实或写入路径。顺序图及 delivery 边界见 CLI 07-subagent.md。

## Must-Preserve Invariants

未知/禁用/歧义模型不启动；无参数兼容；未指定档位不继承原模型档位；profile 不被修改；
执行绑定不可绕过；MCP/工具/权限/工作目录均不由 model 字段改变；Desktop continuous 与 mobile
replayable 仍消费同一事实，身份、lease、命令幂等及 stale-run 规则不变。

## Codegraph Evidence

会话未提供 codegraph 工具。以语义图种子为起点，用源码引用搜索核对上述两层调用路径；
没有声称完成索引图查询。模型执行证据来自真实父子 runtime + 可观测 ModelFactory 测试。

## Graph Drift Candidates / Graph Delta

已确认增加 capability.subagents 的 Agent.model 语义和 spec 引用；保留现有 UI surface，
不把工具调用伪造为 Settings 编辑入口。ListModels 从工作流专属门解除，保留原模块与公开入口。

## Unresolved Questions / Clarification Log

无阻塞问题。用户要求调用时选择；参数沿用现有模型引用格式，省略保留旧行为。
执行绑定拒绝选择、SendMessage 保留原调用选择是本次实现采用的边界，已在 spec 写明。

## Domain Scope / Dimensions / Pruning Decisions

领域：子代理编排、模型配置、恢复；主要维度：有无调用选择、profile 有无模型、前后台、
有效/未知/禁用/歧义/非法档位/目录缺失、执行绑定、有无续跑。
平台无分支因此不全排列 Windows/macOS/Linux；无 UI 控件修改，因此主题与视口不纳入实现测试。
工作流并发和账号变更重映射复用既有实现，不新增本功能策略。无全量状态笛卡尔积。

## Accepted Cases / Matrix Backfill / Planning Handoff

| ID | 前置与动作 | 断言 | 证据 |
| --- | --- | --- | --- |
| SAM01 | profile 配 A，Agent.model 选择 B | child 请求 B；父与 profile 不变；后续未选 child 用 A | subagent-effective-execution、subagent-profile-fields |
| SAM02 | 省略 model，有/无 profile 配置 | profile 或父轮继承兼容 | subagent-effective-execution、subagent-inherited-model-factory |
| SAM03 | 不可用/歧义/错误档位/缺目录，调用 Agent | 有诊断；launch 未调用 | subagent-effective-execution、model-reference |
| SAM04 | 前台/后台选 B；改 profile 后 SendMessage | 同一 child 仍 B，新 child 取新 profile | subagent-profile-fields |
| SAM05 | 关闭动态工作流 | ListModels 保留且 deferred，Agent model schema 可见 | runtime-tool-allowlist、tool-contracts |
| SAM06 | 执行绑定期间显式选模 | 拒绝覆盖；无普通模型请求 | subagent-effective-execution、subagent-execution-boundaries |

E2E handoff：以两个不同模型的受控 provider fixture，从主会话触发前台/后台 Agent.model，
观察 child 模型标签、真实请求和父模型不变，再 SendMessage 续跑。记录为待验证场景，
本次没有 GUI 改动，不新增或转正桌面 E2E；不把 runtime 测试称作 UI E2E。

## 本轮验证记录

- 新增用例先运行：4 项失败、11 项通过；实现前证实调用选择/非法引用及续跑规则缺失。
- 最终 Core 定向回归：23 文件、345 项通过；Bootstrap 调用方：4 文件、25 项通过。
- 根 `pnpm typecheck` 通过；CLI `typecheck` 32/32 任务通过（命令 PATH 显式补根 node_modules/.bin，避免嵌套 workspace 找不到 turbo）。
- 根 Lint 0 error / 96 warning；CLI Lint 0 error / 69 warning，另接纳 13 项原样上游行数诊断。
- architecture:check --changed 零违规；修改代码格式检查及 git diff --check 通过。
- 功能图谱的 Subagent docs/seeds 验证通过；全图有 4 条断链，与 HEAD 完全一致、无新增。
  涉及 desktop-user-data-root 和 customize-capability-settings，留待各自维护，不在本次扩大修改。
- 未运行真实 provider、桌面/手机 GUI E2E；runtime 测试使用受控模型输出。
