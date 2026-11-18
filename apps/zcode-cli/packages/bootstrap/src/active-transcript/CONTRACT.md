# Active transcript

`projectActiveSessionMessages(messages, session, rewindEvents)` 把持久化消息账本投影为 active 分支。

- 输入为会话全部持久消息、会话行（取 `revert`）与 `RewindTriggered` 事件；纯函数，不读写存储。
- 连续 rewind 优先使用 runtime 当时保存的 `keptMessageIDs`，避免旧分支复活；没有 `createdMessageId` 的不可用 rewind 事件不裁剪消息。
- 内部 `/rewind conversation` 的成功回执不属于对话内容，投影时移除。

`isTranscriptVisibleMessage(message)` 复用产品投影策略，只保留真实用户输入、可见回复与时间线事件；运行时提醒、环境信息、中断标记等隐藏 user 消息不返回。

`selectSessionTimelineMessages(messages)` 按落盘顺序取辅助对话创建提醒之后的消息，供时间线重建与按消息派生的展示信息使用。没有创建提醒时返回原序列。模型上下文读取完整的 active 分支。

V4 对话恢复与子代理列表从 active 分支中选取本会话的时间线消息。`session/messages`、`session/read` 与独立 CLI 的 `ReadSession` 按各自接口的可见性规则读取 active 分支。
