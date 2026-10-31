# Codex 订阅验收记录

基线为 `3.17.1-personal.1`。不恢复官方已退役的 App UT；新增账号用例保留为 pending E2E，未宣称已获得人工晋级审核。

| 场景 | 结果与证据 |
| --- | --- |
| CS-01：设备等待/成功、取消后的迟到 exchange、同用户不同 workspace 两账号、手动绑定、并发刷新、无效 refresh token 后重新登录、错账号拒绝、退出清理 | 通过；`packages/desktop/.e2e-artifacts/desktop-e2e-20261031141100067-p90297-52e7a52c2d6fc14f`，服务使用合成账号与注入 transport |
| CS-01：模型发现、额度剩余/重置、credits、网络错误保留旧额度 | 通过；同一账号集成用例；无真实账户额度访问 |
| CS-02：真实设置页设备码、取消、模型同步、额度展示、桌面与 480px 窗口、深浅主题 | 通过；同上，UI 使用无令牌 service contract fixture；截图 `codex-settings.png` / `codex-settings-narrow.png` |
| 请求级鉴权端口、workspace identity、取消、拒绝混用账号类型 | 7 项 Bootstrap 回归通过；`provider-runtime-headers-cancel.test.ts` |
| Responses 动态鉴权、参数映射顺序、SSE 非流式归并、工具流保留、固定源与禁用 endpoint routing；原 API Key 回归 | 4 个 Adapter 测试文件、57 项通过 |
| 旧工具折叠修复在新基线的集成回归 | 通过；`packages/desktop/.e2e-artifacts/desktop-e2e-20261031140930207-p88006-183d416efe79d33e` |
| 文件详情为空的重试恢复、390px/1100px、深浅主题 | `node packages/desktop/scripts/gen-ui-e2e.mjs` 通过 |

执行入口：

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`。
- CLI：`pnpm --dir apps/zcode-cli typecheck`、`pnpm --dir apps/zcode-cli lint`；本机执行时将仓库绝对 `node_modules/.bin` 加入 PATH。
- `pnpm --dir apps/zcode-cli --filter @zcode/adapters exec vitest run tests/codex-subscription.test.ts tests/model.test.ts tests/model-execution.test.ts tests/openai-responses-json-compat.test.ts`。
- `pnpm --dir apps/zcode-cli --filter @zcode/bootstrap exec vitest run tests/provider-runtime-headers-cancel.test.ts`。
- pending 桌面用例为 `packages/desktop/test/e2e/settings/manual-review/pending/codex-subscription.test.ts`；设置 `ZCODE_E2E_MANUAL_REVIEW=1`、`E2E_PROVIDER_REPLAY_FIXTURE_PATH` 为仓库内 common fixture 的绝对路径。Electron 44.7.0 本机使用已下载的同 Chromium build ChromeDriver 152.0.7977.82，通过受支持的 `CHROMEDRIVER_PATH` 指定。

早期 E2E 启动分别被未配置 capture Provider、fixture 相对路径解析和缺失 Chromium 补丁版驱动阻断；未计入通过。修正测试启动参数后运行上述断言。早期 UI fixture 逐方法覆盖 ProxyChannel 无效，已改成替换完整契约并重挂载；获得设备码后未提交真实用户授权，也未读取其他客户端凭据。

未执行真实订阅账号的授权完成与付费模型调用；以上协议/额度证据来自合成响应。真实账户登录、账号可用模型与额度以 OpenAI 服务端返回为准。Windows/macOS/Linux 启动与打包由 Personal release 的五平台流程继续验证。

参考协议：[CC Switch Codex OAuth](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/providers/codex_oauth_auth.rs)、[CC Switch quota](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/services/subscription.rs)、[Codex authentication](https://developers.openai.com/codex/auth/)。本实现复用 ZCode 自有服务/网络/加密/模型执行链，不导入 CC Switch 代码或数据库。

最终静态检查：根类型检查、CLI 类型检查（34 个任务）与架构检查均成功。根 Lint 为 0 errors / 83 warnings；CLI Lint 为 0 errors / 72 warnings，另有 7 项保持原样的上游行数诊断。未把 warnings 写成零，也未运行已退役的 App 全量单测。Personal release 元数据/隔离测试 9 项通过。

功能分支 Push 的 pre-push 门禁成功：51 项架构/工程工具检查通过，架构 0 违规。affected 选中 157/157 工程规格，按仓库合同跳过整套工程测试（并非通过 157 项）；定向 CLI 与桌面 E2E 证据见上表。
