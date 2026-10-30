# Side Pane Windows Impact Brief

## Feature Summary

| Field            | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| Developer intent | 侧边标签可移到一个独立原生窗口并收回                                |
| Capability       | side-pane windows；与同窗 full-view 分开                            |
| Change layer     | presentation、validation、commit-effect；浏览器保留同一原生页面实例 |
| Mode             | implementation / verification                                       |

## UI Surface Matrix

| Surface / scenario       | Shared implementation                          | Display / draft owner   | Gate / command                 | Authority / persistence      | Platform / isolation             |
| ------------------------ | ---------------------------------------------- | ----------------------- | ------------------------------ | ---------------------------- | -------------------------------- |
| 标签右键、拖出           | AnimatedSidePanePanel / SidePaneTabTrigger     | 标签控制器显示位置      | Desktop window port            | useAppPanels；显示位置不落盘 | Desktop；原窗口身份              |
| 独立窗口收回、拖回、关闭 | 同一标签内容                                   | 同一 React/服务上下文   | 原窗口收回事务                 | Main 只拥有窗口              | 不创建新 Host                    |
| 终端                     | SidePaneTerminalPane / registry                | xterm、scrollback       | 原 ITerminalService            | 原 Host PTY                  | 不换 workspace key               |
| 子代理                   | SubagentSessionSidePane                        | 只读 child session 投影 | 现有 SessionPane               | 原 CLI/session owner         | 不另开 Agent                     |
| human/agent 浏览器       | UnifiedBrowserView / BrowserUseSidePaneContent | 原 logical tab          | 稳定 native view；原逻辑 owner | BrowserGuestManager          | native view 跨窗移动不重建 guest |
| 手机/Web                 | 共享标签条                                     | 原状态                  | 无窗口 port                    | 原规则                       | 维持单窗口                       |

## Ranked Relationships

- must-inspect：useAppPanels、标签条、浏览器 guest 生命周期、终端 registry、Desktop 窗口生命周期、IPlatformService。
- should-inspect：弹层 portal、主题/语言、full-view、工作区切换、关闭标签与关闭工作区。
- invariant-only：CommandInbox、owner/lease、workspaceIdentity、desktop-continuous / web-remote-replayable、远程连接。
- conditional：插件 sandbox 的独立 DOM 宿主、依赖主窗口坐标的预览/元素选择。

## State Owners / Commit Sinks

见 [spec](../ui/side-pane-windows.md) 的所有者、接口和时序。业务状态不迁移；原生窗口仅为显示资源。

## Must-Preserve Invariants

| Invariant                                | Proof needed                 | Evidence                                   |
| ---------------------------------------- | ---------------------------- | ------------------------------------------ |
| 一个 tab / 一个 PTY / 一个 child session | 实际运行时 ID 和输出连续性   | terminal registry、SubagentSessionSidePane |
| 浏览器先安全释放 CDP 再销毁节点          | main ACK 与旧 guest 关闭顺序 | detachGuestBeforeReplacement               |
| 标签 owner 不随当前任务漂移              | scope 回归                   | workspaceSidePane scope helpers            |
| 新窗口不创建独立 Host                    | 进程与服务检查               | desktopWindowLifecycle                     |

## Codegraph Evidence

本环境没有 codegraph 工具或 CLI。使用有界源码调用点检查，不能声明 codegraph 验证通过。

| Seed                | Query / direct path                                        | Depth | Interpretation                         |
| ------------------- | ---------------------------------------------------------- | ----- | -------------------------------------- |
| SidePaneTabTrigger  | AnimatedSidePanePanel → useAppPanels callbacks             | 2     | 所有标签共享入口                       |
| TerminalSession     | SidePaneTerminalPane → registry / ITerminalService         | 2     | registry 仅在原 renderer 保活          |
| UnifiedBrowserView  | BrowserUseSidePaneContent → platform → BrowserGuestManager | 3     | 跨文档移动必须遵守 guest 生命周期      |
| createBrowserWindow | desktopWindowLifecycle → Host spawn / attach               | 2     | 普通新工作区窗口不可直接复用为辅助窗口 |

## Graph Drift Candidates

| Candidate                                             | Live-code evidence           | Follow-up                      |
| ----------------------------------------------------- | ---------------------------- | ------------------------------ |
| human browser seed 的 app-shell/useAppPanels 路径过期 | 实际为 hooks/useAppPanels.ts | 更新 seed                      |
| side-pane-terminal-tabs 文档说卸载关闭 PTY            | 实际 registry detach 保活    | 已按 registry 当前代码修正文档 |

## Graph Delta

已新增 side-pane-windows capability 及桌面辅助显示 surface，连接标签条、子代理和 delivery 不变量。已确认单标签窗口、拖出/拖回、关闭收回及浏览器保留现场语义。浏览器新增 native carrier、原逻辑 owner 与物理呈现位置解析；同源 portal 从首次挂载开始保持不变。Graph YAML 可解析、节点无重复，新增节点/边及源码 seed 检查通过；全图仍有 4 条基线悬空引用（HEAD 对照相同），没有新悬空边。Codegraph 不可用，不声称完成索引 seed 校验。

## Unresolved Questions

| Question       | Candidates                                     | Owner    |
| -------------- | ---------------------------------------------- | -------- |
| 浏览器页面现场 | 用户已确认保留同一网页实例；原生承载方案已实现 | resolved |

## Planning Handoff

| Item             | Destination                                        | Status                       |
| ---------------- | -------------------------------------------------- | ---------------------------- |
| Spec             | docs/ui/side-pane-windows.md                       | 基础及浏览器保留现场语义完成 |
| Case catalog     | spec 的 SPW-001～007                               | SPW-001～007 accepted        |
| Coverage matrix  | docs/testing/side-pane-tabs-e2e-coverage-matrix.md | 见覆盖矩阵验证记录           |
| Decision backlog | 本文 Unresolved Questions                          | complete                     |
| E2E handoff      | ui-shell/manual-review/pending                     | 候选回放，不自动转正         |
