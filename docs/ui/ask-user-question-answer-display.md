# AskUserQuestion 已回答记录

## 规则与所有者

CLI/runtime 是已提交答案的唯一所有者。共享 UI 的 `readAskUserQuestionAnswers`
只读取工具结果和既有历史字段，不能维护另一份答案缓存，也不改变提交、模型上下文或协议。

```text
用户提交 → CLI interaction → AskUserQuestion result → 模型读取完整答案
                                  │
                                  └→ tool row / snapshot
                                       ├→ desktop-continuous
                                       └→ web-remote-replayable
                                             ↓
                                共享只读答案解析 → 按题展示
```

- 先读取结构化 `answers`，再兼容旧文本；文本只解析出部分题目时，不能抢先遮蔽完整结构化结果。
- 优先级为工具输出、原始工具输出/内容、已携带答案的输入。显式空对象也是权威结果，不能用其他字段补造答案。
- 保留题干原文作为 key，不 trim 题干；题干内的英文/中文引号、换行和正则特殊字符不能影响匹配。
- 旧工具结果采用 `"题目"="答案"` 文本，题目和答案中的引号未转义。按输入中的完整题干和结果格式边界识别答案，不把每个双引号当作结束符。
- 保留答案中的引号、逗号、换行和路径反斜杠；`selected preview` / `user notes` 注释不混入答案。
- 部分作答只显示实际返回的题目；未回答题保留占位。显式 `answers: {}` 保持“未回答，已自动继续”语义。
- 兼容对象/JSON、content 文本块、rawOutput/output、旧单题 `answered` / `answered_custom` 结果。
- 同一工具结果首次展示、重新挂载和页面重载后的答案一致，不依赖 renderer 草稿。

## 根因与范围

旧解析正则把题干和答案中的第一个英文双引号视为边界，又 trim 题干 key，导致模型已收到的答案
在卡片中匹配失败。此外，文本解析提前返回会遮蔽后面的结构化答案。当前源码可复现四题中的第
1、4 题缺失；用户在另一台设备上的原始记录未取得，不能断言该次报告的具体触发字符。

修复只涉及共享 UI 展示解析，不改 CLI 输出格式、持久化、owner/lease、workspace identity、
continuous / replayable 事件顺序或路由。

## 验收 Q27

- 四题混合：第 1、4 题含英文引号；答案含开头引号、嵌套引号、换行、逗号及反斜杠；四个答案完整显示。
- 题干前后空白、中文引号和正则特殊字符保持精确匹配。
- 文本输出与完整结构化结果同时存在时，以结构化结果为准；空结果不被旧文本覆盖。
- 部分答案、全部空答案、旧单题结果、JSON content 和注释兼容不回归。
- 390px / 1200px、Zai Light / Zai Dark、中英文；展开、重新挂载、刷新后逐题检查实际 DOM。

浏览器候选：`packages/ui/test/browser/manual-review/pending/ask-user-question-answer-display.test.mjs`。
使用真实 `AskQuestionToolCallBlock`，不替换产品解析函数。该场景只证明共享渲染器的结果展示，
不冒充真实设备的提交、网络重连或 CLI 冷恢复 E2E。

验证：旧实现在 `legacy-four` 卡片断言失败，修复后 8/8 浏览器组合通过（每组 15 种语料 × 首次/重新挂载/刷新）。
证据：`packages/desktop/.e2e-artifacts/ask-user-question-answer-display`，含 DOM 与截图。
运行：`node --test packages/ui/test/browser/manual-review/pending/ask-user-question-answer-display.test.mjs`；
默认使用 Playwright 缓存 Chromium，可用 `CHROME_EXECUTABLE_PATH` 指定浏览器。
