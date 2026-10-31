# execution-activity

将连续的已可见过程条目收为轻量折叠外壳。`groupExecutionActivities` 是无副作用的顺序投影，返回原项引用；null 描述符保留为外层边界。首项 key 决定分组身份，后续追加和状态更新不改变它。

`ExecutionActivityGroup` 只管理当前挂载分组的展开状态，不持有执行状态、计时器、快照或服务引用。运行状态和数量来自调用方，正文 children 复用原有组件。中英文、键盘和主题通过共享 UI 组件处理。

`toolCounts` 是按读取、编辑、终端、浏览器、搜索、网页、脚本、应用、其他分类的次数映射，替代工具总数。
每条工具调用只落入一个类别；组件按固定顺序显示非零类别。聚合器复制并合并计数，不修改输入映射。
类别变化只更新摘要，不作为分组边界或身份的一部分；工具语义的识别归 V4 调用方所有。

V4 renderer 先完成已有的 reasoning 可见性；运行中按原始工具行隔离错误、授权、交互和插件 UI 等边界，再构建 Explore/Execute/Changes 分组并提供描述符，避免一个边界子项带出整组正常工具。结束后的整轮历史保持原有分组行为。详见 `docs/ui/execution-activity-collapse.md`。
