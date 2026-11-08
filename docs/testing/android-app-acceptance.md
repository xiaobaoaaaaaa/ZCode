# Android App 验收

对应 [Android 产品合同](../mobile-remote-control-android.md)。这些是设备上的 instrumentation/E2E，
不是 App 业务单测；使用模拟器、真实 Activity/WebView 和隔离 HTTP fixture，不使用真实账号凭据。

## 自动化场景（实现前维护）

| 场景            | 层次与证据                                     | 断言                                                                                         |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| AND-07 URL边界  | Android Uri + 实际平台 policy                  | v4/旧合法入口及 deep link 接受，伪装私网 host、错误远控路径、file/javascript、用户名密码拒绝 |
| AND-05 导航重组 | MainActivity + WebView + localhost fixture     | 页面 replaceState 改 URL 后打开/关闭原生链接弹窗不会重新加载或丢失输入                       |
| AND-01 重启保持 | 同 origin WebView localStorage + Activity 重建 | 保留测试存储、不会将登录回调 URL 落盘为启动地址                                              |
| AND-04 电脑入口 | 原生顶部操作                                   | 导航至无 SID 的 v4?devices=1，交由 Web owner 展示列表                                        |
| AND-06 HTTP失败 | fixture /remote/v4?failure=1 返回 HTTP500      | 原生错误与重试可达，重试成功仍保持原存储                                                     |
| AND-08 文件取消 | fixture 的 file input + 系统选择器             | 打开系统文件选择器，取消后回到 App，无崩溃，下一次可再打开                                   |
| AND-10 APK资源  | 实际 Bundle/Activity                           | v4 HTML 和资源随 APK 提供，不截获 API、外部 origin 或目录穿越路径                            |

执行：`ANDROID_SERIAL=emulator-5554 JAVA_HOME=/usr/lib/jvm/java-21-zulu-openjdk-ca
ANDROID_HOME=/opt/android-sdk ./gradlew :app:connectedDebugAndroidTest`（从 `packages/android`）。
测试类可用 `-Pandroid.testInstrumentationRunnerArguments.class=<全名>` 筛选。所有 ADB 命令必须显式
选择 `emulator-5554`，不能自动选择当前连接的实体手机。

## 人工/集成范围

- 中英文、Zai Light/Dark、键盘与状态栏，通过模拟器截图核对。
- 两台真实电脑、公网 relay、真实 OAuth 供应商登录、相机扫码与厂商后台限制仍需独立验收。
- 本地 fixture 不验证登录供应商是否允许嵌入式 WebView，也不证明真实设备路由和远端任务继续执行。
- 设备在线、切换、草稿与导航恢复由 Web 的双设备场景验证；Android 不复制协议事实。

## 本次执行记录

2026-11-08：首次运行发现旧 Espresso 3.5.1 在 Android 36.1 调用已删除的
`InputManager.getInstance`，在测试环境初始化时失败；升级 Espresso 3.7.0 / AndroidX Test JUnit
1.3.0 后进入实际行为验收。此问题与产品连接逻辑无关。

文件选择用真实触摸产生浏览器用户激活，等待 DocumentsUI 确切窗口后注入系统返回键；JS click
会被 WebView 正常阻止，Espresso 返回键不能用于被测 Activity 已暂停的系统选择器。HTTP fixture
按连接并发处理，避免 WebView 空闲预连接阻塞 reload，并单独断言服务端确实返回 HTTP500。

最终完整执行：**6/6 通过、0 失败**，`connectedDebugAndroidTest` 完成于 2026-11-08，
`BUILD SUCCESSFUL in 35s`。本轮重新构建内置 Web 前端，未跳过 `bundleRemoteWeb`。

- APK 入口与脚本可离线读取，桌面二维码的 `REMOTE_FRONTEND_VERSION=3.17.2` 命中内置页，
  其他版本/API/外部 origin/路径穿越不被拦截。
- Android Uri 链接安全边界通过。
- 页面 replaceState 与未提交输入在原生弹窗重组后保留，Activity 重建后同源存储保留。
- 真实触摸打开系统文件选择器、取消、再次打开均通过。
- HTTP500 错误与重试保持存储通过。实测发现 API36.1 会先发 `onReceivedHttpError(main=true,500)`，
  再发 `onPageStarted`；原来的 start 回调清除了错误。修复后错误只由显式导航/重试清除，
  回调顺序不再隐藏错误页。该问题有日志和回归场景，并非增加超时规避。

HTML 报告：`packages/android/app/build/reports/androidTests/connected/debug/index.html`。
XML 报告：`packages/android/app/build/outputs/androidTest-results/connected/debug/TEST-ZCode_API_36_1(AVD) - 16-_app-.xml`。
完整本机执行日志：`/home/xiaobao/.cache/android-setup/android-acceptance.log`（不提交）。

上述结果不扩大为真实账号 OAuth、相机扫码或真实双电脑端到端通过。

### 最终集成检查

- 最终 APK 已安装至 `emulator-5554`，中文启动页显示正常；开启飞行模式后冷启动仍能显示 APK 内置登录界面，随后已恢复网络。
- 实际模拟器截图：`.tmp/android-app-final/dark-offline.png`、`.tmp/android-app-final/dark-online.png`。Web 的中英亮暗四组合截图见 `.tmp/android-device-preferences/`；不把 Web 截图当作全部原生交互验证。
- 最终 `:app:lintDebug` 通过；根 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过，Lint 为 84 条现有 warning、0 error。架构扫描主要覆盖 TS/JS，Android 原生边界另按规格审查与 instrumentation 验证。
- 输出为 `packages/android/app/build/outputs/apk/debug/app-debug.apk`（约 56 MiB）。未执行真实账号 OAuth、真实两台电脑与相机扫码验收；未发布商店或正式签名包。
