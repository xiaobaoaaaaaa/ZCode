# 主智能体选择子智能体模型

## 范围与授权
Settings → Subagents 新增默认关闭的“由主智能体选择”继承策略和显式允许列表。每个 profile 的手动选择继续优先；关闭时沿用默认。仅覆盖普通 Agent 调用；动态工作流保留原模型选择与确认路径。不会改变开发任务的模型。

## 单一事实源与顺序
用户 profile 的 v2/agents-state.json 保存 mainAgentModelPolicy，SubagentsService 在既有 mutex/atomic-write 下写入；Host 缓存发布完整快照，bootstrap 在父 turn 边界刷新。Markdown、网页及工具结果不能授予模型权限。runtime 是最终选择 owner：内部执行绑定 > 手动 profile > 用户允许且实时可用的调用建议 > 用户当前父模型。允许列表为空、建议不在列表、目录不可用或模型过期时仅继承父模型；父模型缺失则失败。不能猜测其他供应商。目录及 registry resolver 每次启动校验；不新增凭据。

## 工具与展示
Agent 增加可选 model（完整 provider/model 规范串）。profile 提示暴露允许列表而非隐藏推理。runtime 在 child 持久化前确定实际模型；spawn 事件和返回结果记录实际模型与简短状态原因，UI 展示事实，不宣称选择更优。继续已存在 child 不接受新调用建议；沿用原有 profile/父模型恢复语义。

## 验证
覆盖默认关闭、空列表、非法建议、目录过期、父模型缺失、手动优先及开启后被用户撤回的授权。验证设置持久化和启动快照；类型检查、lint 与受影响测试，不访问真实 profile。不将 Linux 验证视为 Windows 验收。

## 当前验证证据（2026-10-23）
- Core：subagent-effective-selection、subagent-tool-events、subagent-profile、subagent-explore 共 97 tests 通过；含实际 runtime 的允许模型路由和 spawn 身份验证。选择失败 runner 另 1 文件通过。
- Host/UI：subagentsService、subagentRuntimeConfig、subagentsSection、subagentSidePane 共 97 tests 通过；含临时目录持久化、开启/勾选/撤销交互。没有读写真实用户 profile。
- Bootstrap：runtime-subagents contract 2 tests 与 SubagentSpawned/Stopped projection 1 test 通过，校验模型及原因通过完成状态投影保留。
- contracts build、Core typecheck、受影响 root shared/services/UI 初轮 typecheck 通过。后续全仓并行改动尚需最终 typecheck 收口。
- 受影响 root 文件 lint 0 warnings/errors；全 CLI lint 当前仅共享 product-projection.ts max-lines 超限，待整合提交收口。Architecture check 0 violations（已有 shared 文件使用精确路径 existing-module-edit 例外）。
- 尚未验证真实模型联网、桌面/手机深浅主题视觉回归或 Windows 构建。
