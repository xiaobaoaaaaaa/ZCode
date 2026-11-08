# 待引导消息撤回

## Feature Summary

用户要求尚未进入上下文的引导可撤回，并确认成功后恢复输入框，已有草稿时阻止撤回。
模式 planning；变更层 presentation / validation / commit-effect。复用 `deleteQueueItem`，
不新增协议命令、数据表或 accepted queue。已消费历史编辑、抢占执行、自动重发不在范围内。

## UI Surface Matrix

| 场景/入口 | 共享实现与显示 owner | 门禁/默认 | 提交与权威落点 | 模式/隔离 |
| --- | --- | --- | --- | --- |
| 时间线待引导消息 | ConversationPendingGuideList / Timeline；queue 是 CLI snapshot | queued guide、非只读；操作时禁用；已有草稿提示先处理 | SessionPane.handleEditQueueItem → deleteQueueItem → runtime.removePendingInputById | Desktop/Web/mobile 同组件；只恢复点击端同 session/workspace 的 Composer |
| 普通 queue 撤回编辑 | ConversationQueuePanel，同一 handler | 原规则保留，compact 无入口 | 相同 runtime 与 session_input cancelled | 不改变未来 queue 的 FIFO 或投递模式 |

## Shared And Divergent Behavior

按钮文案为“撤回”，位于等待引导状态旁，手机无需 hover。普通 queue 继续叫编辑。
draft/config/attachments 恢复、ACK 判断、操作锁、身份隔离全部复用原实现。guide 已开始消费后
撤回返回 noop，提示未能恢复；不能凭 UI 旧状态承诺撤回成功。原始流、模型选择和 active turn 不停止。

## Feature Relationships / State Owners And Commit Sinks

| Rank | 路径/语义边 | Owner / sink | 证据 |
| --- | --- | --- | --- |
| must-inspect | pendingGuideProjection → Timeline → 待引导按钮 → queue edit handler | Renderer 只拥有草稿和 pending 操作 | packages/ui/src/v4 |
| must-inspect | deleteQueueItem → input-facade → removePendingInputById | CLI runtime；session_input cancelled + TurnSteerDiscarded | bootstrap queue handler / core steering |
| must-inspect | tool batch → drainPendingInput → persistUserPrompt → history | CLI runtime 消费边界 | core steering |
| invariant-only | owner/lease 路由 → snapshot/delta | Host 路由；Desktop continuous / Web replayable | conversation-protocol-declaration.md |
| evidence-only | 可控 Promise 竞态与 Electron 受控 provider | 测试，不是产品 owner | GW01–GW04 |

## Must-Preserve Invariants

- 撤回操作在任何异步落库前占用已有 per-input reservation，drain 不得消费该目标。
- drain 同步从 active pending 列表取出目标就是消费认领点；之后旧投影不再代表可撤回输入。
  `discardHeldPendingInputById` 不得把当前 active turn 的已取出目标当成 held queue。
  异步读取投影期间 turn 可能结束或切换，应保留读取前的 active turn 身份以拒绝旧投影。
- 等待持久化期间其他输入可能 drain，不能沿用 await 前的数组下标删除另一条。
- 删除成功才恢复草稿；stale/noop/rejected/failed 不恢复。取消状态写库失败释放临时 reservation，保留输入。
- 已有 promotion reservation 继续由原 owner 释放；不抢占其他 owner，不重放请求。
- 队列撤回后的 terminal state 复用 cancelled；重发是新 commandId，不复活旧输入。
- workspaceIdentity?.trim() || workspacePath；ACK 后绑定变化不恢复，其他端仅消费 removal。

```mermaid
sequenceDiagram
  participant UI as 发起端 Composer / 待引导消息
  participant CLI as CLI runtime（唯一 owner）
  participant Store as session_input / events
  participant Loop as 模型循环
  UI->>CLI: deleteQueueItem(id, baseRevision)
  alt 撤回先认领
    CLI->>CLI: 同步占用目标 reservation
    Loop->>CLI: tool batch 完成，尝试 drain
    CLI-->>Loop: 不取出被占用 guide
    CLI->>Store: cancelled + TurnSteerDiscarded
    CLI-->>UI: accepted + removal projection
    UI->>UI: 仅原绑定恢复草稿
  else drain 先取出
    Loop->>CLI: 同步取出 guide，开始提交上下文
    CLI-->>UI: noop（旧投影不可撤回），不恢复
    CLI->>Store: user prompt + TurnSteerDrained
  end
```

## Codegraph Evidence / Graph Drift Candidates / Graph Delta

codegraph 工具不可用，以源码 seed 和 rg 追踪两层：PendingGuideList → Timeline → SessionPane；
deleteQueueItem → input-facade → steering；drain → persistUserPrompt。发现原 remove 在 await
后按旧 index splice、且 active 已取出项可落入 held fallback，属于本次新增入口必须解决的竞态。
图谱 conversation-runtime invariant 已补撤回语义；未发现需要新增状态 owner 的 drift。
图谱引用校验发现 HEAD 已有的两处悬空引用：`persistence.desktop-user-data-root` 与
`capability.mcp-oauth-authorization`；本次未引入新的引用问题。

## Clarification Log / Boundary Decisions / Domain Scope

用户确认恢复 Composer、草稿冲突阻止撤回；未消费是必要条件，消费开始后不承诺回滚。
领域限于 guide、queue 操作和跨端投影；模型/provider 无关，使用代表模型剪枝。
暂不改变正常历史编辑、goal/compact、协议 delivery 或数据库 schema。

## Dimensions / Candidate Combinations / Pruning Decisions

| 状态 × 动作 | 结果 | 分类/理由 |
| --- | --- | --- |
| pending guide × 空 draft × 撤回 | 删除成功后恢复全文 | accepted GW01 |
| pending guide × 非空/上传 draft × 撤回 | 保留两侧，不发命令 | accepted GW02 |
| 撤回/消费交叉、重复撤回、落库失败 | 单一胜者，失败不造成内容丢失或误删除邻项 | accepted GW03 |
| consumed / stale / 切绑定 | 不恢复旧消息 | accepted GW04 |
| guide 回落 queue | 原 queue 编辑入口 | pruned，沿用同一路径 |
| compact/goal/历史消息 | 无新增撤回入口 | pruned，非待引导 |
| 每个 provider、系统、主题的笛卡尔积 | 同 CLI 和共享按钮，代表运行 + 类型检查 | pruned，无 provider/平台分支 |

## Unresolved Questions / Questions For User

无产品阻塞问题。真实手机 replayable 的运行证据独立记录，不以 Desktop 通过替代。

## Accepted Cases / Matrix Backfill / Planning Handoff

GW01–GW04 的 setup/action/assert/evidence 见 conversation case catalog 与 coverage matrix。
E2E 先放 manual-review/pending，受控流冻结当前响应窗口；以权威 queue 消失、草稿恢复和
无额外模型请求为断言，不依赖固定延时猜测生效。CLI 用可控 Promise 暂停写库构造两种竞态。
仅本地回放；未人工审阅前不提升到正式 Docker suite。

## 实施与验证记录

已接入共享待引导列表和原 queue 撤回 handler。CLI 可控竞态在修复前复现重复消费、
旧投影误取消与下标失效；修复后 core 两文件 183 项、bootstrap queue/commands 两文件
112 项通过。根与 CLI typecheck 通过；根 Lint 84 条存量警告，CLI Lint 72 条警告及
7 条已接纳上游行数诊断，均 0 错误；architecture changed 0 违规。Electron 交互证据
见 coverage matrix。真实手机/双端重连、Windows/macOS 未实跑，未发布或安装。
