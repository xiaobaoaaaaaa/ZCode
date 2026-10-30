# conversation-continuation

`resolveInterruptedContinuation` 是无副作用的快照投影：只有权威中断状态、停止完成、可立即发送或选择保留队列的路由才返回候选。身份取 session、log epoch 和最近 turn，计数、revision 或后台状态变化不改变它。暂停 Goal 只复用已授权的 resumeGoal。

Composer 决定草稿与连接等 UI 门禁，并复用既有 submit 路径。成功点击的 key 只抑制本轮重复点击，失败可重试；此局部展示状态不拥有执行、队列、恢复或持久化。详见 docs/chat/continue-interrupted-session.md。

`ContinueButton` 仅展示本地化标签、可用状态和等待反馈，复用共享 Button 与提示组件；点击回调由 Composer 提供，组件不持有业务状态。
