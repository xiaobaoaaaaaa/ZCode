# 官方 3.18.2 与 Personal 集成

## 基线与发布授权

- Personal 基线：已发布 `v3.18.1-personal.1`，提交 `9980c1510357f36d9d9cd46f0bbd124ed7929594`。
- 官方目标：`fec975905a2abd4c07e35c40d51fa097a2258ec9`（3.18.2）；仅合入 3.18.1 之后的增量。
- 分支 `release/3.18.2-personal.1`，保留双亲 merge 历史，不改写已发布版本。
- 用户于 2026-11-14 授权合并、提交、推送并正式发布。正式拼写沿用 `personal`。
- 根版本 `3.18.2-personal.1`；Android versionCode 从 5 递增为 6。

## 产品规则与边界

采用上游既有规格和回归用例，不新增另一套凭据或账号状态。Personal 身份、更新通道、
Codex 订阅/SSE、子代理选模、引导撤回和思考阶段引导、继续执行、独立窗口、Android
布局与设备偏好、问答历史答案和本轮性能摘要均保留。

| 增量 | 所有者及接口 | 验收 |
| --- | --- | --- |
| Linux 无 Secret Service 时首次凭据存储 | Main 开启共享 cipher 的文件密钥回退；仅尚未绑定来源且无 v2 密文时允许；独立 CLI/Server 不主动开启 | CLI credential-security 与 linux-fallback 回归 |
| 切换数据目录 | Host 复制后经私有通道请求 Main 登记目标路径系统密钥；成功后才保存新目录 | CLI 凭据迁移回归、system-credential-data-root E2E |
| 国内 Start 权益 | 共享 provider-family 映射与服务层账号解析为唯一事实，设置页复用；不改付费套餐归属 | start-plan-cn-unlinked-login E2E、类型及 Hooks 扫描 |
| Windows 签名检查 | 官方 PowerShell helper 负责路径转义、受限语言兼容与临时结果清理；保留 Personal 更新完整性校验 | powershell-command 工程回归、更新 source security smoke |

规格沿用 `docs/plans/2026-10-29-system-credential-storage.md`、`docs/zcode-login-rework.md`、
`docs/zai-start-plan-provider.md` 和 `docs/desktop/auto-update-service-manifest.md` 的上游更新。
不修改 session/queue、owner/lease、workspaceIdentity 或桌面 continuous / 手机 replayable 语义。

```mermaid
sequenceDiagram
  participant UI as 设置页
  participant Host as Window Host
  participant Main as Desktop Main / cipher owner
  participant OS as 系统凭据库
  UI->>Host: 切换数据目录
  Host->>Host: 复制现有数据
  Host->>Main: 登记目标目录所需密钥
  Main->>OS: 检查并按需登记（不覆盖冲突密钥）
  OS-->>Main: 成功或失败
  Main-->>Host: 受控结果（不返回主密钥）
  Host->>Host: 仅成功后保存新目录
  Host-->>UI: 成功或路径未更改
```

## 验证与发布

运行根 typecheck、lint、架构及推送门禁，检查受影响 UI 的 Hooks 诊断；执行凭据与
PowerShell 定向回归和可用的桌面 E2E。记录环境失败和未覆盖范围，不以 CI 启动冒充
真实账号、跨机远控或各系统安装器交互验证。

五平台桌面与签名 Android 构建沿用 `personal-release.yml`。五平台启动、Android 签名、
聚合门及远端资产名称/大小/SHA-256/源码提交核验成功后公开 Release 并设为 Latest。
macOS ad-hoc、Windows 无 Authenticode 及第三方材料缺口继续如实披露。

## 本次验证记录

待合并后填写实际结果。
