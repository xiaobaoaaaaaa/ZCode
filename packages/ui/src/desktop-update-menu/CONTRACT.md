# desktop-update-menu

按编译身份确定菜单入口资格，并把 Main 的 `UpdateStatePayload` 投影为国际化消息 ID 和插值。

- production / personal 有更新入口，preview 无入口；未打包运行时的检查资格继续由 Main 判断。
- 没有 IO、缓存或状态写入；重复调用返回相同结果。
- 原生菜单动作由 `useDesktopUpdateMenu` 与 `IPlatformService` 发给 Main，本模块不建立第二条命令路径。
- 规格：[Personal 应用更新](../../../../docs/desktop/personal-app-update.md)。
