# Android 平板远控验收

目标是 Android APK 中的真实 WebView 工作区，不以登录页或仅修改浏览器 viewport 的截图代替平板验收。
产品实现前先维护本验收合同。数据使用隔离的账号、relay 与 Host fixture，复用实际 Web Root、RPC 与
会话快照，不发模型请求，不连接真实电脑或操作实体手机。

## 场景

| ID     | 设备/操作                                     | 期望                                                                                                      |
| ------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TAB-01 | Pixel Tablet 横屏 1280×800 dp                 | 宽布局：项目/任务侧栏、会话同屏；会话区域利用剩余宽度，无手机单列最大宽度限制                             |
| TAB-02 | 旋转为竖屏 800×1280 dp                        | 宽度仍≥768，保留宽布局；当前项目、任务、输入草稿保留                                                      |
| TAB-03 | 真实自由窗口，WebView 宽度600 dp              | 切为手机抽屉布局；在 Home 点选任务进入 Chat，会话和输入可用，无横向溢出                                   |
| TAB-04 | 宽布局打开文件侧栏                            | 左侧任务、中央会话、右侧文件区域同屏，关闭文件区域恢复会话宽度                                            |
| TAB-05 | 800 dp 竖屏打开文件侧栏，显示真实 Android IME | 输入框和发送入口在可视区域内；键盘收起后尺寸恢复，不改变任务/草稿；仅高度变化不能误收起文件面板           |
| TAB-06 | 横→竖→窄→横→窄                                | 活动任务与草稿保持；先在窄屏进入 Chat，再返回窄屏仍为 Chat；`performance.timeOrigin` 不变，WebView 不重载 |
| TAB-07 | 中英文 × Zai Light/Dark                       | 共享桌面主题、按钮与字级一致；所有操作可达，边界不重叠                                                    |
| TAB-08 | 宽屏点击“新建任务”                            | 新任务草稿显示共享 WorkspaceHeader，右侧面板入口可见，输入区无横向溢出                                    |

宽度改变时原有自动收起策略仍可关闭文件侧栏/左侧栏，这是既有行为；高度变化不触发该策略。
文件面板在手机布局是 modal drawer，验证 Chat 输入前由用户关闭它，不能将被 modal 遮挡的输入框认定为失效。
宽屏选任务本身不改变 mobile.currentPage；因此首次缩窄允许显示 Home，不能仅根据 activeTaskId 断言 Chat。

## 可重复入口

先启动 Vite：

```sh
pnpm --filter @zcode/web exec vite --host 127.0.0.1 --port 5178 --strictPort
```

浏览器四组合：

```sh
pnpm exec tsx packages/web/test/e2e/manual-review/pending/android-tablet-layout.mjs
```

Android 使用独立 AVD `ZCode_Tablet_API_36_1` / `emulator-5556`，2560×1600 px、320 dpi、4 cores、3072 MB RAM。
系统镜像为 Google APIs 36.1 x86_64；KVM 加速，系统 Mesa 软件渲染。在本机有窗口的 emulator UI 启动不稳定，
验收使用 `-no-window` 并保留原生截图：

```sh
LIBGL_ALWAYS_SOFTWARE=1 __GLX_VENDOR_LIBRARY_NAME=mesa \
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
/opt/android-sdk/emulator/emulator -avd ZCode_Tablet_API_36_1 -port 5556 \
  -gpu host -feature -Vulkan -no-audio -no-snapshot -no-window
```

安装已构建的 debug APK 并启动：

```sh
adb -s emulator-5556 install -r packages/android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5556 reverse tcp:5178 tcp:5178
adb -s emulator-5556 shell am start -n io.github.xiaobaoaaaaaa.zcode.debug/com.example.zcode_mobile.MainActivity
ANDROID_TABLET=1 ANDROID_SERIAL=emulator-5556 \
  pnpm exec tsx packages/web/test/e2e/manual-review/pending/android-tablet-layout.mjs
```

脚本通过 Playwright `_android` 的 WebView CDP 入口接入当前 APK，不需要手动 forward 9224。
普通 desktop `connectOverCDP` 会发送 WebView 不支持的 `Browser.setDownloadBehavior`，不能用于本环境。
`omitDriverInstall: true` 不安装驱动；ADB 操作均显式限定5556。旋转使用 `cmd window user-rotation`；
自由窗口使用 `wm set-display-windowing-mode 5` 加 `am task resize`，返回全屏恢复 mode1，不通过 CDP 覆盖视口。

可用 `TABLET_LOCALE=zh-CN TABLET_THEME=zai-light` 重跑一个组合；`TABLET_LAYOUT_BASELINE=1` 收集全部失败后再报错，
不会把断言失败标记为通过。实际页面基于现有 remote-login、device-switch 桥和 taskSnapshot fixture，
通过真实 Web Root、acknowledged relay RPC 和会话快照渲染；fixture 明确返回无运行中的 session lifecycle。

## 证据与边界

- 每个观测记录 `innerWidth/innerHeight/visualViewport`、`performance.timeOrigin`、任务/会话/文件区域边界、
  document 水平溢出；保留页面截图。Android 另保留 `adb exec-out screencap` 原生截图证明系统栏/IME布局。
- 可见性检查排除隐藏祖先与超出视口的保活面板，避免把已收起侧栏的子节点宽度当作可见布局。
- 浏览器证据位于 `.tmp/android-tablet-layout/browser/`，Android 位于 `.tmp/android-tablet-layout/android/`，
  每目录含 `results.json` 和场景截图。基线另保存在 `baseline-browser/`、`baseline-android/`。
- 浏览器场景只证明共享 UI 响应式行为；Android 系统旋转、自由窗口、IME 必须另行通过。
- fixture 未配置真实模型，因此本次没有验证模型切换、实际发送、队列/未读语义；真实双电脑、公网 OAuth 和相机扫码也不在此次布局验收范围。

## 本次状态

基线确认两项缺陷：

1. 800×1280 打开文件面板后，仅将高度改为800也会误收起面板；
   `baseline-browser/zh-CN-zai-light-portrait-files-before-ime.png` 与 `zh-CN-zai-light-height-only.png` 保留前后证据。
2. Android `sw800dp` → `sw600dp` 时 Activity 重建，同进程的 WebView target 改变并返回默认入口；
   `baseline-android/logcat-size-change.txt` 包含 `finishDrawing of relaunch`，`freeform-reloaded-native.png` 为重载后截图。

2026-11-08 最终结果：

- Browser：中英文 × Light/Dark，36/36 观测通过，结果 `browser/results.json`。
- Android Pixel Tablet API36.1：相同四组合，40/40 观测通过，结果 `android/results.json`；
  每个组合从横屏、竖屏、IME、自由窗口往返到新草稿，均只有一个 `documentEpoch`。
- 真实 WebView 可用尺寸为横屏1280×695、竖屏800×1175（扣除原生导航与系统栏）；
  竖屏IME打开后800×831，收起恢复800×1175；自由窗口600×751。
- 800 dp竖屏三栏与真实键盘同屏时，文件侧栏保留，输入框和发送箭头可见；宽屏新草稿Header及右侧面板入口通过。
- Android 壳6项instrumentation由主代理在最终APK执行通过，Android Lint、仓库typecheck/lint/architecture亦由主代理执行通过。
  本脚本 `node --check` 与两个验收文件的 `oxfmt --check` 通过。

完整横屏三栏展示图另存 `android/final-landscape-native.png`（关闭IME）；验收后清理独立AVD的synthetic账号，恢复bundled默认入口。
