# execution-activity

将连续的已可见过程条目收为轻量折叠外壳。`groupExecutionActivities` 是无副作用的顺序投影，返回原项引用；null 描述符保留为外层边界。首项 key 决定分组身份，后续追加和状态更新不改变它。

`ExecutionActivityGroup` 只管理当前挂载分组的展开状态，不持有执行状态、计时器、快照或服务引用。运行状态和数量来自调用方，正文 children 复用原有组件。中英文、键盘和主题通过共享 UI 组件处理。

V4 renderer 先完成已有的 reasoning 可见性和 Explore/Execute/Changes 分组，再为运行中片段提供描述符。错误、授权、交互和插件 UI 由调用方声明边界。结束后的整轮历史保持原有行为。详见 `docs/ui/execution-activity-collapse.md`。
