import { CODEX_RESPONSES_BASE_URL, type CodexResponsesTransport } from "./contract.js";
export { CODEX_RESPONSES_BASE_URL } from "./contract.js";

export const createCodexResponsesFetch: CodexResponsesTransport =
  (fetch) => async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${CODEX_RESPONSES_BASE_URL}/responses`)
      throw new Error("Invalid Codex subscription endpoint");
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof raw !== "string") throw new Error("Invalid Codex request body");
    const body = JSON.parse(raw) as Record<string, unknown>;
    const streaming = body.stream === true;
    body.store = false;
    body.stream = true;
    body.instructions ??= "";
    body.include = [
      ...new Set([
        ...(Array.isArray(body.include) ? body.include : []),
        "reasoning.encrypted_content",
      ]),
    ];
    // Codex backend 与公共 Responses API 字段不完全相同；通用 token 上限会导致请求直接 400。
    for (const key of [
      "max_output_tokens",
      "max_tokens",
      "temperature",
      "top_p",
      "frequency_penalty",
      "presence_penalty",
      "truncation",
    ])
      delete body[key];
    const response = await fetch(input, { ...init, body: JSON.stringify(body), redirect: "error" });
    // 固定 Codex backend 已被强制 stream=true，但实际 SSE 可能缺少 Content-Type。
    // 不能用 MIME 头决定转换，否则 WebFetch/compact 的非流式 SDK 会把 SSE 当成 JSON。
    if (!response.ok || streaming) return response;
    // compact/连通性探测使用非流式 SDK；backend 只支持 SSE，必须消费终态再返回标准 Responses JSON。
    if (!response.body) throw new Error("Codex response body is missing");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += chunk.value ?? "";
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          const value = JSON.parse(data) as { type?: string; response?: unknown };
          if (value.type === "response.completed" || value.type === "response.incomplete") {
            return new Response(JSON.stringify(value.response), {
              headers: { "content-type": "application/json" },
              status: 200,
            });
          }
          if (value.type === "response.failed" || value.type === "error")
            throw new Error("Codex response failed");
        }
        if (chunk.done) throw new Error("Codex response ended without a terminal event");
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        // 取消后的流会让 cancel() reject，reader 的锁仍必须释放。
        reader.releaseLock();
      }
    }
  };
