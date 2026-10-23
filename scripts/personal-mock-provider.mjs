import http from "node:http";

/** Test-only Anthropic BYOK endpoint. No proxy, identities or external requests. */
export async function startPersonalMockProvider({ handler = () => ({ text: "MOCK_DONE" }) } = {}) {
  const records = [];
  let nextHandler = handler;
  let sequence = 0;
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || !/^\/(v1\/)?messages(?:\?.*)?$/.test(request.url ?? "")) {
      response.writeHead(404).end();
      return;
    }
    let bytes = 0;
    const chunks = [];
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new Error("Mock request exceeds 2 MiB");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const record = { body, path: request.url, status: 0, cancelled: false };
      records.push(record);
      response.on("close", () => {
        if (!response.writableFinished) record.cancelled = true;
      });
      const reply = await nextHandler({ body, path: request.url });
      if (reply.hold) {
        record.status = 200;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(": waiting for cancellation\n\n");
        return;
      }
      record.status = reply.status ?? 200;
      if (record.status !== 200) {
        response.writeHead(record.status, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: reply.error ?? "SYNTHETIC_PROVIDER_FAILURE",
            },
          }),
        );
        return;
      }
      const content = [
        ...(reply.text ? [{ type: "text", text: reply.text }] : []),
        ...(reply.toolCalls ?? []).map((tool) => ({
          type: "tool_use",
          id: tool.id,
          name: tool.name,
          input: tool.input,
        })),
      ];
      const message = {
        id: `msg_mock_${++sequence}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content,
        stop_reason: reply.toolCalls?.length ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      };
      if (!body.stream) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(message));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type, value) =>
        response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      event("message_start", {
        message: {
          ...message,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      });
      for (const [index, part] of content.entries()) {
        event("content_block_start", {
          index,
          content_block: part.type === "text" ? { type: "text", text: "" } : { ...part, input: {} },
        });
        const value = part.type === "text" ? part.text : JSON.stringify(part.input);
        // Split real wire deltas; clients must assemble text/tool JSON themselves.
        for (let start = 0; start < value.length; start += 17) {
          event("content_block_delta", {
            index,
            delta:
              part.type === "text"
                ? { type: "text_delta", text: value.slice(start, start + 17) }
                : { type: "input_json_delta", partial_json: value.slice(start, start + 17) },
          });
          await new Promise((resolve) => setImmediate(resolve));
        }
        event("content_block_stop", { index });
      }
      event("message_delta", {
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage: { output_tokens: 20 },
      });
      event("message_stop", {});
      response.end();
    } catch {
      if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Invalid synthetic fixture request" } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    records,
    setHandler(fn) {
      nextHandler = fn;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
