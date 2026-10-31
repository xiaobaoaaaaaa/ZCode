import { describe, expect, it, vi } from "vitest";
import { createCodexResponsesFetch } from "../src/model/codex-subscription/index.js";
import { AiSdkModelExecution } from "../src/model/model-execution.js";
import { parseProviderConfig, serializeRegistryProviderConfig, type RegistryProviderConfig } from "@zcode/provider";
import { generateText } from "ai";

describe("Codex subscription transport", () => {
  it("normalizes Responses fields while retaining tools, input and cancellation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("stream"));
    const controller = new AbortController();
    await createCodexResponsesFetch(fetch)("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: "Bearer synthetic-test-token" },
      body: JSON.stringify({ model: "gpt-test", input: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", name: "example", parameters: { type: "object" } }],
        max_output_tokens: 100, temperature: 0.7, store: true, stream: false }),
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(init?.signal).toBe(controller.signal);
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "gpt-test",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "example", parameters: { type: "object" } }],
      store: false, stream: true, instructions: "", include: ["reasoning.encrypted_content"] });
  });

  it("rejects custom endpoints before sending subscription credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(createCodexResponsesFetch(fetch)("https://example.test/responses", { body: "{}" })).rejects.toThrow("endpoint");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses ephemeral auth, skips endpoint routing and normalizes after option mapping", async () => {
    const terminal = { id: "response-test", created_at: 1, model: "gpt-test", status: "completed", output: [
      { id: "message-test", type: "message", role: "assistant", content: [{ type: "output_text", text: "done", annotations: [] }] },
    ], usage: { input_tokens: 1, output_tokens: 1 } };
    const transport = vi.fn<typeof globalThis.fetch>(async () => new Response(
      `event: response.completed\r\ndata: ${JSON.stringify({ type: "response.completed", response: terminal })}\r\n\r\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));
    const routing = { resolve: vi.fn(), invalidate: vi.fn() };
    const execution = new AiSdkModelExecution({ env: {}, endpointRoutingPort: routing as never }, { transport });
    const providerConfig = parseProviderConfig({ group: "standard-personal", access: { type: "codex-account", accountId: "account-test" },
      api: { type: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex" } }) as RegistryProviderConfig;
    expect(providerConfig.validateComplete()).toEqual([]);
    expect(serializeRegistryProviderConfig(providerConfig).access).toEqual({ type: "codex-account", accountId: "account-test" });
    const bound = execution.bindModel({ providerId: "codex-test", modelId: "gpt-test", providerConfig, supportsJsonSchemaOutput: false,
      optionSpecs: { reasoningLevel: { map: "{}" }, maxOutputTokens: { map: '{"max_output_tokens": maxOutputTokens}' } } });
    const resolved = bound.resolveRequest({ options: { maxOutputTokens: 500, reasoningLevel: "disabled" },
      requestAuth: { apiKey: "synthetic-ephemeral-token", headers: { "ChatGPT-Account-Id": "test-workspace" } } });
    const result = await generateText({ model: resolved.model, prompt: "hello", providerOptions: resolved.providerOptions as never });
    expect(result.text).toBe("done");
    const [url, init] = transport.mock.calls[0]!;
    expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-ephemeral-token");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("max_output_tokens");
    expect(JSON.parse(String(init?.body))).toMatchObject({ store: false, stream: true });
    expect(routing.resolve).not.toHaveBeenCalled();
    expect(resolved.providerOptions).toMatchObject({ openai: { store: false } });
  });

  it("rejects incomplete non-stream SSE and preserves streaming tool events", async () => {
    const events = 'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call","name":"read"}}\n\n';
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(events, { headers: { "content-type": "text/event-stream" } }));
    const wrapped = createCodexResponsesFetch(fetch);
    const stream = await wrapped("https://chatgpt.com/backend-api/codex/responses", { body: '{"stream":true}' });
    expect(await stream.text()).toBe(events);
    await expect(wrapped("https://chatgpt.com/backend-api/codex/responses", { body: '{"stream":false}' })).rejects.toThrow("terminal event");
  });
});
