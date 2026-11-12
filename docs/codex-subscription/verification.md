# Codex 订阅验收记录

基线为 `3.17.1-personal.1`。不恢复官方已退役的 App UT；新增账号用例保留为 pending E2E，未宣称已获得人工晋级审核。

| 场景                                                                                                                                              | 结果与证据                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CS-01：设备等待/成功、取消后的迟到 exchange、同用户不同 workspace 两账号、手动绑定、并发刷新、无效 refresh token 后重新登录、错账号拒绝、退出清理 | 通过；`packages/desktop/.e2e-artifacts/desktop-e2e-20261031141100067-p90297-52e7a52c2d6fc14f`，服务使用合成账号与注入 transport |
| CS-01：模型发现、额度剩余/重置、credits、网络错误保留旧额度                                                                                       | 通过；同一账号集成用例；无真实账户额度访问                                                                                      |
| CS-02：真实设置页设备码、取消、模型同步、额度展示、桌面与 480px 窗口、深浅主题                                                                    | 通过；同上，UI 使用无令牌 service contract fixture；截图 `codex-settings.png` / `codex-settings-narrow.png`                     |
| 请求级鉴权端口、workspace identity、取消、拒绝混用账号类型                                                                                        | 7 项 Bootstrap 回归通过；`provider-runtime-headers-cancel.test.ts`                                                              |
| Responses 动态鉴权、参数映射顺序、SSE 非流式归并、工具流保留、固定源与禁用 endpoint routing；原 API Key 回归                                      | 4 个 Adapter 测试文件、57 项通过                                                                                                |
| 旧工具折叠修复在新基线的集成回归                                                                                                                  | 通过；`packages/desktop/.e2e-artifacts/desktop-e2e-20261031140930207-p88006-183d416efe79d33e`                                   |
| 文件详情为空的重试恢复、390px/1100px、深浅主题                                                                                                    | `node packages/desktop/scripts/gen-ui-e2e.mjs` 通过                                                                             |

执行入口：

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`。
- CLI：`pnpm --dir apps/zcode-cli typecheck`、`pnpm --dir apps/zcode-cli lint`；本机执行时将仓库绝对 `node_modules/.bin` 加入 PATH。
- `pnpm --dir apps/zcode-cli --filter @zcode/adapters exec vitest run tests/codex-subscription.test.ts tests/model.test.ts tests/model-execution.test.ts tests/openai-responses-json-compat.test.ts`。
- `pnpm --dir apps/zcode-cli --filter @zcode/bootstrap exec vitest run tests/provider-runtime-headers-cancel.test.ts`。
- pending 桌面用例为 `packages/desktop/test/e2e/settings/models/manual-review/pending/codex-subscription.test.ts`；设置 `ZCODE_E2E_MANUAL_REVIEW=1`、`E2E_PROVIDER_REPLAY_FIXTURE_PATH` 为仓库内 common fixture 的绝对路径。Electron 44.7.0 本机使用已下载的同 Chromium build ChromeDriver 152.0.7977.82，通过受支持的 `CHROMEDRIVER_PATH` 指定。

早期 E2E 启动分别被未配置 capture Provider、fixture 相对路径解析和缺失 Chromium 补丁版驱动阻断；未计入通过。修正测试启动参数后运行上述断言。早期 UI fixture 逐方法覆盖 ProxyChannel 无效，已改成替换完整契约并重挂载；获得设备码后未提交真实用户授权，也未读取其他客户端凭据。

未执行真实订阅账号的授权完成与付费模型调用；以上协议/额度证据来自合成响应。真实账户登录、账号可用模型与额度以 OpenAI 服务端返回为准。Windows/macOS/Linux 启动与打包由 Personal release 的五平台流程继续验证。

参考协议：[CC Switch Codex OAuth](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/providers/codex_oauth_auth.rs)、[CC Switch quota](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/services/subscription.rs)、[Codex authentication](https://developers.openai.com/codex/auth/)。本实现复用 ZCode 自有服务/网络/加密/模型执行链，不导入 CC Switch 代码或数据库。

最终静态检查：根类型检查、CLI 类型检查（34 个任务）与架构检查均成功。根 Lint 为 0 errors / 83 warnings；CLI Lint 为 0 errors / 72 warnings，另有 7 项保持原样的上游行数诊断。未把 warnings 写成零，也未运行已退役的 App 全量单测。Personal release 元数据/隔离测试 9 项通过。

功能分支 Push 的 pre-push 门禁成功：51 项架构/工程工具检查通过，架构 0 违规。affected 选中 157/157 工程规格，按仓库合同跳过整套工程测试（并非通过 157 项）；定向 CLI 与桌面 E2E 证据见上表。

发布补充：首轮 Linux 依赖安装遇到 pnpm hoisted 重命名竞争，重跑后安装通过；随后许可证新鲜度检查发现版本更新后的输入清单未生成。已同步根 npm 锁文件版本、重新生成第三方声明与清单，并将发布安装的依赖构建并发降为 1。生成前后的 1173 个生产包版本及材料待核验条目一致；声明变动仅为当前 checkout 换行字节带来的相同 Apache 文本去重及原始文件哈希更新。根类型检查与 Lint 再次通过，9 项发布元数据/隔离测试和 7 项 Linux 包格式测试通过；最终五平台安装包必须从修正后的同一提交重建。

## 2026-11-01 同步与卡片布局回归

旧 CS-01 的供应商 fixture 没有执行真实创建校验，不能作为首次同步成功证据。本轮补充实际 `ProviderConfigService` 的隔离内存存储验收；CS-02 更新为先选择 Codex 导航入口，但未重跑完整 Electron 用例。

- 浏览器/运行时验收：`packages/ui/test/browser/manual-review/pending/codex-subscription.test.mjs`，5/5 通过。首次创建、重复同步、新增模型补齐、用户禁用模型与供应商 logo 保留均执行真实配置服务。
- 四组浏览器场景：1200px 中文浅色、1200px 英文深色、390px 中文深色、390px 英文浅色。覆盖导航选中、详情归位、同步失败文案与重试、重复同步、离开取消授权和返回重读、无横向溢出及无浏览器异常。点击同步通过本地验收端点调用真实 Codex service 和配置服务；账号投影、授权及额度为合成数据。
- 证据目录：`packages/desktop/.e2e-artifacts/codex-subscription-ui/`，含四张截图与检查日志。未调用真实付费模型，未改动用户账号和凭据，未构建或安装发布包。
- 根 `pnpm typecheck`、`pnpm --filter @zcode/desktop typecheck:e2e`、`pnpm architecture:check --changed` 通过；Lint 无错误，83 条已有警告。

复跑：`CHROME_EXECUTABLE_PATH=<本机 Chromium 路径> pnpm exec tsx --test packages/ui/test/browser/manual-review/pending/codex-subscription.test.mjs`；不提供路径时使用本机 Chrome。测试用内存配置仓库，不访问真实账号存储。

## 2026-11-01 卡片信息密度调整

按 BigModel 截图复用 `PlanStatusCardSurface`，账号标题/副标题、额度区隔线与间距一致。额度改为百分比和进度条；workspace 身份、完整重置时间移到可聚焦提示；零 credits 不占行。重新登录/退出移到菜单，新增账号发现的只读模型目录；不伪造已启用状态。同步成功反馈限定当前账号。

验收脚本仍为 `packages/ui/test/browser/manual-review/pending/codex-subscription.test.mjs`，11 项：真实配置服务同步回归、5 组视口/语言/主题、未知额度/重新登录、正数 credits、不限量、空账号登录、多账号反馈隔离。证据保存到 `packages/desktop/.e2e-artifacts/codex-subscription-compact-ui/`。本轮不调用真实账号，不将只读模型目录当作可执行模型配置的证明。

本轮最终结果：11/11 通过；根 typecheck、desktop typecheck:e2e、架构检查均通过；Lint 0 errors / 83 条已有 warnings。完整 Electron 测试未重跑，未打包安装。
