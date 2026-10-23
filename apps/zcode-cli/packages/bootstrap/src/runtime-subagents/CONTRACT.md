# CLI subagent configuration

纯解析模块，独立 CLI loader 注入文本和禁用状态；Host ready 快照直接使用，不重复解析。解析保留来源、namespace 与诊断，fallback 只提供空的动态配置，不能读取磁盘或恢复旧模板。

初始化和每轮读取时序继续由 bootstrap owner 负责；本模块不拥有缓存、子会话或副作用。

用户 state 中的 mainAgentModelPolicy 随 ready 快照传递；默认缺席，Markdown 不授予模型权限。主智能体建议仅在 runtime 的实时目录与允许列表共同认可后执行；此模块不解析建议。
