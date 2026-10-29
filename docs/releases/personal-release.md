# 个人版桌面发布

个人版从 `personal` 创建 `release/<version>` 分支，版本格式为
`<上游版本>-personal.<序号>`。`main` 继续作为官方基线，不承载发布流程。

## 构建与发布所有者

GitHub Actions 的 `personal-release.yml` 负责原生构建、打包、启动验证与草稿资产上传。
发布者在核对五个平台的任务与草稿资产后公开 Release；构建流程不自行公开草稿。
草稿默认带预发布标记。正式版核验完成后显式取消预发布并设为 Latest：

```sh
gh release edit v<version> --draft=false --prerelease=false --latest
```

版本继续使用个人版序列；是否正式发布由 GitHub Release 标记决定，不能仅根据标签名推断。

| 目标        | Runner           | 资产                        |
| ----------- | ---------------- | --------------------------- |
| Windows x64 | windows-2022     | NSIS EXE                    |
| macOS x64   | macos-15-intel   | DMG、ZIP                    |
| macOS ARM64 | macos-15         | DMG、ZIP                    |
| Linux x64   | ubuntu-22.04     | AppImage、DEB、RPM、Arch 包 |
| Linux ARM64 | ubuntu-22.04-arm | AppImage、DEB、RPM、Arch 包 |

所有目标使用 Node 24.14.0、pnpm 10.33.2 和冻结锁文件，调用官方的运行资源准备、
bootstrap 构建和 bundle 入口。Linux 使用原生 fpm，避免 ARM64 runner 执行 x64 工具。
依赖收集同时包含 glibc 与 musl 可选包，使 Linux 生成的第三方声明覆盖与 macOS/Windows
相同的已登记平台包；实际发行包仍由上游原生依赖裁剪规则选择对应目标。
macOS 使用 ad-hoc 签名，不代表 Developer ID 签名或公证；Windows 不使用 Authenticode。
发布说明必须说明这些实际状态，不声称经过证书认证。

## 资产合同

- 版本、平台与架构必须匹配当前源码与 runner；每个目标必须生成全部约定格式。
- Linux 文件名遵循 electron-builder 的格式别名：x64 的 AppImage/RPM 使用 `x86_64`、
  DEB 使用 `amd64`、Arch 使用 `x64`；ARM64 的 RPM/Arch 使用 `aarch64`，其他格式使用 `arm64`。
- 每个安装包必须通过文件头检查、SHA-256 计算与 500 MiB 的上游体积约束。
- 对解包后的真实应用执行启动检查，记录版本、运行架构与欢迎页面截图。
- 必须等到登录页的 `login-use-api-key-button` 可见且可用，才记录 `welcomeReady`；
  初始化页同样包含 ZCode 文本，不能仅凭正文长度或标题判断启动完成。
- Windows 保持上游禁用 Node Inspector 的 fuse；通过 Chromium 调试连接验证欢迎页和
  关于窗口的实际版本，并检查 PE x64 头与隔离目录的实际写入，不为测试弱化发行包。
- 聚合阶段核对五个目标的 commit、版本、启动结果和全部哈希，缺失或篡改即失败。
- 仅上传约定的 13 个安装包、`SHA256SUMS` 和 `release-manifest.json`；调试日志和截图留在 Actions artifacts。
- 发布标签只在版本完成后使用。已公开的同版本发布不覆盖；后续修改递增个人版序号。
- 包内保留上游第三方声明，重新生成输入清单并运行基础检查。上游清单中已登记的材料缺口必须保留并披露，不能声称严格材料审计通过。

## 验收

本地验证脚本的资产格式、缺失文件、校验篡改和版本校验；执行类型检查、lint 和提交前检查。
更新 `package.json`（包括仅递增版本号）后，先运行 `node scripts/licenses.mjs notices` 重新生成输入哈希，
再运行 `node scripts/licenses.mjs check`；将生成材料与版本一并提交。
CI 五个原生目标全部通过后核对草稿的资产名称、大小和服务器 SHA-256，再公开。
Linux CI 的启动验证在 Xvfb 内进行，使用测试进程的 `--no-sandbox`，不改变发行包配置；
该检查不等价于每一种发行版、安装器交互、模型账号和远程功能的完整验证。
