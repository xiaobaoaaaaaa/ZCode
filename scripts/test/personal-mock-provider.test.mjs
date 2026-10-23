import { test } from "node:test";
import assert from "node:assert/strict";
import { startPersonalMockProvider } from "../personal-mock-provider.mjs";
test("loopback mock streams text/tool JSON and captures actual requested model", async () => {
  const server = await startPersonalMockProvider({
    handler: () => ({
      text: "streamed synthetic text",
      toolCalls: [{ id: "tool1", name: "Read", input: { file_path: "synthetic.txt" } }],
    }),
  });
  try {
    assert.match(server.baseURL, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(server.baseURL + "/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "child-small", stream: true }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /input_json_delta/);
    assert.match(text, /message_stop/);
    assert.equal(server.records[0].body.model, "child-small");
    assert.equal((await fetch(server.baseURL + "/official-login")).status, 404);
  } finally {
    await server.close();
  }
});
test("mock errors and cancellation close only owned sockets", async () => {
  const server = await startPersonalMockProvider({
    handler: () => ({ status: 400, error: "synthetic rejection" }),
  });
  try {
    const request = () => ({
      method: "POST",
      body: JSON.stringify({ model: "main", stream: true }),
    });
    assert.equal((await fetch(server.baseURL + "/v1/messages", request())).status, 400);
    server.setHandler(() => ({ hold: true }));
    const abort = new AbortController();
    const response = await fetch(server.baseURL + "/v1/messages", {
      ...request(),
      signal: abort.signal,
    });
    abort.abort();
    await assert.rejects(response.text());
    for (let n = 0; n < 50 && !server.records.at(-1).cancelled; n++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(server.records.at(-1).cancelled, true);
  } finally {
    await server.close();
  }
});
