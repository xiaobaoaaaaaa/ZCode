# 设置搜索

3.18.0 Personal 采用官方 SettingsSearch、settingsSearchIndex 和设置行定位上下文，原 Personal 全局搜索组件及索引退役。当前契约见 [settings-search](../../packages/ui/src/settings-search/CONTRACT.md)。

Personal 独有设置沿用官方稳定行 ID 注册；搜索仅导航并高亮，不保存配置，也不维护第二份设置状态。运行阶段自动展开位于 Agent 行为。

固定入口包括 Agent 行为的自动展开、常规页的数据目录导入和模型服务页的 ChatGPT / Codex。Codex 搜索命中只选择既有订阅导航节点并聚焦高亮；不登录、不同步账号、不修改模型配置。
