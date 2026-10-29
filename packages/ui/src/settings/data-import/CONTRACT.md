# data-import-ui

`DataImportControl` 通过 usePlatform 获取 Desktop 本机导入能力；不读取业务 Repo。未注入能力时不渲染。选择目录是 UI 草稿，导入结果来自 Main；结果准备好后通过现有 RelaunchApp 命令冷重启。操作中禁用重复提交，失败保留选择供重试。

副本位置、保留原数据、关闭来源应用、重新登录与自动任务暂停提示在提交前可见。共享 Button/Input 与 intl 保证主题、键盘和中英文表现。
