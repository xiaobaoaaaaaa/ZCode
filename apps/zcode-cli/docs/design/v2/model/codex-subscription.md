# ChatGPT / Codex account execution

产品与所有者合同见 [订阅 spec](../../../../../../docs/codex-subscription/spec.md)。

`codex-account` access 仅携带 accountId。绑定模型在每个 attempt 前通过既有 runtime-headers port 请求 Host 鉴权；没有端口时明确报缺少账号鉴权。协议新增可选 codexAccountId，不能与智谱 accountAccess 同时传递。普通 API-key 请求保持静态鉴权。

Codex 使用原生 Responses streaming，复用 AI SDK 的文本、reasoning、tool call 与取消处理。transport 固定 backend endpoint；强制 store=false、stream=true、instructions 存在，删除 backend 不支持的输出 token 上限、temperature、top_p 等字段。无论 Provider 配置或 endpoint routing 如何变化，都不能将订阅令牌发往其他地址。禁止跟随 redirect。历史 reasoning 需要 encrypted_content，工具结果仍用 Responses input 项。

回归覆盖：请求变换、固定地址、redirect、工具 SSE、取消、原有 API-key Responses 不变。只在没有产生内容的既有 retry 边界重试，不为额度错误新增切换/重放机制。
