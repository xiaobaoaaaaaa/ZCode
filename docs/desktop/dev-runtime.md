# Desktop 开发运行时目录

## 规则与所有者

- macOS 开发启动脚本 `packages/desktop/scripts/dev.mjs` 指定仓库根目录下的
  `.zcode-runtime/desktop-dev` 为 Electron 开发副本目录。
- `prepareDevElectronAppBundle` 通过现有 `runtimeRoot` 参数接收目录，并负责创建、
  校验和复用 `<Electron 版本>-<架构>/ZCode Dev.app`。
- 副本保留现有应用身份与 `zcode` 协议声明；Windows、Linux 和打包版本的启动逻辑不变。
- `.zcode-runtime/` 是可重建的本地产物，必须由 `.gitignore` 忽略。

## 切换与失败边界

启动脚本只使用新目录，不自动迁移或删除旧缓存。新目录不存在时，现有准备函数创建
副本；创建失败时沿用现有错误传播行为，不回退到旧目录。

## 验收

1. 启动脚本传入的目录与 `.gitignore` 中的目录一致。
2. 路径仍按 Electron 版本和架构隔离，准备函数的缓存复用和协议声明逻辑不变。
3. 通过脚本语法检查、类型检查、Lint 和架构检查。

## 开发壳版本

`packages/desktop/package.json` 必须声明合法的 semver 开发壳版本 `0.0.0`。
该私有 workspace 包的版本不代表产品发布版本；产品版本仍以根 `package.json`
和现有 build metadata 为准，打包继续使用已有的产品版本注入流程。

原因：Linux 直接通过 Electron 启动未声明版本的包时，`app.getVersion()` 返回
`0.0`。`electron-updater` 在模块加载阶段就校验版本，早于开发态禁用更新的判断，
因此会抛出 `ERR_UPDATER_INVALID_VERSION` 并阻止主进程启动。

回归验证：使用桌面 manifest 的版本初始化真实 `electron-updater`，确保不会触发
版本异常；实际启动 Linux 开发窗口，确认主界面可以加载。默认开发态不检查更新的
约定保持不变，不为修复启动问题开启自动更新。

## 本地开发数据隔离

`mise run dev` 将以下目录同时设置到 `~/.zcode-dev-home` 下：

- `ZCODE_DATA_BASE_DIR`：业务数据根的父目录。
- `ZCODE_DESKTOP_HOME_DIR`：Electron home 与设置服务使用的 home。
- `ZCODE_DESKTOP_USER_DATA_DIR`：独立 Electron 缓存目录；session 数据由现有逻辑派生。

只设置 `ZCODE_DATA_BASE_DIR` 不足以隔离设置服务，后者会读取显式 desktop home
或系统 HOME。三个入口必须同时配置，不改写进程的系统 HOME，也不复制、迁移或删除
正式版配置。其他开发任务仍使用各自原有配置。

验收时使用任务解析后的环境启动 Electron，确认 home、userData 和设置文件均位于
开发目录，并比较正式版设置文件在启动前后的摘要，确保内容不变。
