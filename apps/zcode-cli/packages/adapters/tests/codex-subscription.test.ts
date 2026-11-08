import { describe, expect, it, vi } from "vitest";
import { createCodexResponsesFetch } from "../src/model/codex-subscription/index.js";
import { AiSdkModelExecution } from "../src/model/model-execution.js";
import {
  parseProviderConfig,
  serializeRegistryProviderConfig,
  type RegistryProviderConfig,
} from "@zcode/provider";
import { generateText } from "ai";

describe("Codex subscription transport", () => {
  it("normalizes Responses fields while retaining tools, input and cancellation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("stream"));
    const controller = new AbortController();
    await createCodexResponsesFetch(fetch)("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: "Bearer synthetic-test-token" },
      body: JSON.stringify({
        model: "gpt-test",
        input: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", name: "example", parameters: { type: "object" } }],
        max_output_tokens: 100,
        temperature: 0.7,
        store: true,
        stream: true,
      }),
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(init?.signal).toBe(controller.signal);
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-test",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "example", parameters: { type: "object" } }],
      store: false,
      stream: true,
      instructions: "",
      include: ["reasoning.encrypted_content"],
    });
  });

  it("rejects custom endpoints before sending subscription credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      createCodexResponsesFetch(fetch)("https://example.test/responses", { body: "{}" }),
    ).rejects.toThrow("endpoint");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, "text/plain", "Text/Event-Stream", "text/event-stream"])(
    "normalizes non-streaming SDK calls with Content-Type %s after option mapping",
    async (contentType) => {
      const terminal = {
        id: "response-test",
        created_at: 1,
        model: "gpt-test",
        status: "completed",
        output: [
          {
            id: "message-test",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "done", annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      const transport = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(
            new TextEncoder().encode(
              `event: response.completed\r\ndata: ${JSON.stringify({ type: "response.completed", response: terminal })}\r\n\r\n`,
            ),
            { headers: contentType ? { "content-type": contentType } : {} },
          ),
      );
      const routing = { resolve: vi.fn(), invalidate: vi.fn() };
      const execution = new AiSdkModelExecution(
        { env: {}, endpointRoutingPort: routing as never },
        { transport },
      );
      const providerConfig = parseProviderConfig({
        group: "standard-personal",
        access: { type: "codex-account", accountId: "account-test" },
        api: { type: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex" },
      }) as RegistryProviderConfig;
      expect(providerConfig.validateComplete()).toEqual([]);
      expect(serializeRegistryProviderConfig(providerConfig).access).toEqual({
        type: "codex-account",
        accountId: "account-test",
      });
      const bound = execution.bindModel({
        providerId: "codex-test",
        modelId: "gpt-test",
        providerConfig,
        supportsJsonSchemaOutput: false,
        optionSpecs: {
          reasoningLevel: { map: "{}" },
          maxOutputTokens: { map: '{"max_output_tokens": maxOutputTokens}' },
        },
      });
      const resolved = bound.resolveRequest({
        options: { maxOutputTokens: 500, reasoningLevel: "disabled" },
        requestAuth: {
          apiKey: "synthetic-ephemeral-token",
          headers: { "ChatGPT-Account-Id": "test-workspace" },
        },
      });
      const result = await generateText({
        model: resolved.model,
        prompt: "hello",
        providerOptions: resolved.providerOptions as never,
      });
      expect(result.text).toBe("done");
      const [url, init] = transport.mock.calls[0]!;
      expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer synthetic-ephemeral-token",
      );
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("max_output_tokens");
      expect(JSON.parse(String(init?.body))).toMatchObject({ store: false, stream: true });
      expect(routing.resolve).not.toHaveBeenCalled();
      expect(resolved.providerOptions).toMatchObject({ openai: { store: false } });
    },
  );

  it.each(["completed", "incomplete"])(
    "extracts a fragmented %s terminal response without MIME headers",
    async (status) => {
      const terminal = { id: "response-test", status, output: [] };
      const events = `event: response.${status}\r\ndata: ${JSON.stringify({ type: `response.${status}`, response: terminal })}\r\n\r\n`;
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // 每字节切块覆盖 CRLF、JSON token 的网络分片；终态后不关闭，验证主动释放连接。
          for (const byte of new TextEncoder().encode(events))
            controller.enqueue(Uint8Array.of(byte));
        },
        cancel,
      });
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
      const result = await createCodexResponsesFetch(fetch)(
        "https://chatgpt.com/backend-api/codex/responses",
        { body: '{"stream":false}' },
      );
      expect(result.headers.get("content-type")).toBe("application/json");
      expect(await result.json()).toEqual(terminal);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("passes through HTTP errors and headerless streaming calls without consuming their bodies", async () => {
    const failed = new Response('{"error":{"message":"Unauthorized"}}', { status: 401 });
    const streaming = new Response(new ReadableStream());
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(streaming);
    const wrapped = createCodexResponsesFetch(fetch);
    expect(await wrapped("https://chatgpt.com/backend-api/codex/responses", { body: "{}" })).toBe(
      failed,
    );
    expect(
      await wrapped("https://chatgpt.com/backend-api/codex/responses", { body: '{"stream":true}' }),
    ).toBe(streaming);
    expect(failed.bodyUsed).toBe(false);
    expect(streaming.bodyUsed).toBe(false);
    await streaming.body!.cancel();
  });

  it("propagates cancellation while awaiting a non-streaming terminal response without retrying", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled", "AbortError");
    let body: ReadableStream<Uint8Array>;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      body = new ReadableStream<Uint8Array>({
        start(stream) {
          init?.signal?.addEventListener("abort", () => stream.error(init.signal!.reason), {
            once: true,
          });
          stream.enqueue(
            new TextEncoder().encode(
              'event: response.created\ndata: {"type":"response.created"}\n\n',
            ),
          );
          queueMicrotask(() => controller.abort(reason));
        },
      });
      return new Response(body);
    });
    await expect(
      createCodexResponsesFetch(fetch)("https://chatgpt.com/backend-api/codex/responses", {
        body: "{}",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledOnce();
    expect(body!.locked).toBe(false);
  });

  it("rejects incomplete non-stream SSE and preserves streaming tool events", async () => {
    const events =
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call","name":"read"}}\n\n';
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(events, { headers: { "content-type": "text/event-stream" } }),
    );
    const wrapped = createCodexResponsesFetch(fetch);
    const stream = await wrapped("https://chatgpt.com/backend-api/codex/responses", {
      body: '{"stream":true}',
    });
    expect(await stream.text()).toBe(events);
    await expect(
      wrapped("https://chatgpt.com/backend-api/codex/responses", { body: '{"stream":false}' }),
    ).rejects.toThrow("terminal event");
  });
});
