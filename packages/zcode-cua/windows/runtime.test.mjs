import { test } from "node:test";
import assert from "node:assert/strict";
import { createWindowsHost, createBrokerRuntime } from "./index.js";
import { connectLease, exchange } from "./transport.js";
import { resultEnvelope } from "./validation.js";
import { preserveFrame, attestFrame } from "./frame.js";

const context = { sessionId: "test-session", runtimeScope: "main", workspaceKey: "test-workspace" };
function fixture() {
  const calls = [];
  const backend = {
    call: async (request) => {
      calls.push(request);
      return { apps: [] };
    },
    dispose: async () => {},
  };
  const host = createWindowsHost({ backend, platform: "win32" });
  return { host, calls };
}
async function connected(host) {
  const transport = await host.start();
  return createBrokerRuntime({
    brokerSocketPath: transport.socketPath,
    env: { ZCODE_CUA_PLUGIN_AUTHORITY: transport.pluginAuthority },
  });
}
test("authenticated runtime executes through the host and closes cleanly", async () => {
  const { host, calls } = fixture();
  const runtime = await connected(host);
  try {
    assert.equal(
      (await runtime.execute({ toolName: "list_apps", arguments: {}, context })).isError,
      undefined,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "list_apps");
  } finally {
    await runtime.dispose();
    await host.stop();
  }
});
test("invalid authority, subagent, unknown fields, invalid coordinates never reach native IO", async () => {
  const { host, calls } = fixture();
  const runtime = await connected(host);
  const bad = createBrokerRuntime({
    brokerSocketPath: host.socketPath,
    env: { ZCODE_CUA_PLUGIN_AUTHORITY: "invalid" },
  });
  try {
    for (const input of [
      { toolName: "list_apps", arguments: {}, context: { ...context, runtimeScope: "subagent" } },
      { toolName: "list_apps", arguments: { command: "injected" }, context },
      {
        toolName: "left_click",
        arguments: { app_ref: { pid: 1 }, target: { type: "coordinate", x: -1, y: 0 } },
        context,
      },
    ])
      assert.equal((await runtime.execute(input)).isError, true);
    assert.equal(
      (await bad.execute({ toolName: "list_apps", arguments: {}, context })).isError,
      true,
    );
    assert.equal(calls.length, 0);
  } finally {
    await bad.dispose();
    await runtime.dispose();
    await host.stop();
  }
});
test("stop is terminal for one owner; another workspace is isolated", async () => {
  const { host, calls } = fixture();
  const runtime = await connected(host);
  try {
    await runtime.execute({ toolName: "stop_computer_control", arguments: {}, context });
    assert.equal(
      (await runtime.execute({ toolName: "list_apps", arguments: {}, context })).isError,
      true,
    );
    assert.equal(
      (
        await runtime.execute({
          toolName: "list_apps",
          arguments: {},
          context: { ...context, workspaceIdentity: "another" },
        })
      ).isError,
      undefined,
    );
    assert.equal(calls.filter((c) => c.method === "list_apps").length, 1);
  } finally {
    await runtime.dispose();
    await host.stop();
  }
});
test("pre-cancelled calls have no side effects and stopped hosts cannot resurrect", async () => {
  const { host, calls } = fixture();
  const runtime = await connected(host);
  const signal = AbortSignal.abort();
  assert.equal(
    (await runtime.execute({ toolName: "list_apps", arguments: {}, context, signal })).isError,
    true,
  );
  assert.equal(calls.length, 0);
  await runtime.dispose();
  await host.stop();
  await assert.rejects(host.start());
});
test("non-Windows fails explicitly without starting a backend", async () => {
  const host = createWindowsHost({ platform: "linux" });
  await assert.rejects(host.start(), /Windows/);
  await host.stop();
});

test(
  "runtime lease loss releases every owned session without a timer",
  { timeout: 10000 },
  async () => {
    let release;
    const released = new Promise((resolve) => {
      release = resolve;
    });
    const host = createWindowsHost({
      platform: "win32",
      backend: {
        call: async (request) => {
          if (request.method === "release") release(request.owner);
          return { apps: [] };
        },
        dispose: async () => {},
      },
    });
    const transport = await host.start();
    const credentials = { clientId: "crashed-runtime", authority: transport.pluginAuthority };
    const lease = await connectLease(transport.socketPath, credentials, () => {});
    await exchange(transport.socketPath, {
      ...credentials,
      context,
      method: "list_apps",
      args: {},
    });
    lease.destroy();
    assert.match(await released, /crashed-runtime/);
    await host.stop();
  },
);

test("exact raster survives model projection; tampered image and extra images fail closed", async () => {
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const result = resultEnvelope({
    image,
    frame_id: "test-frame",
    width: 1,
    height: 1,
    text: "Observed",
  });
  assert.equal(await preserveFrame(result), result);
  const content = result.content.map((b) =>
    b.type === "image"
      ? { type: "image", mediaType: b.mimeType, dataUrl: `data:${b.mimeType};base64,${b.data}` }
      : b,
  );
  assert.equal(attestFrame(content)?.kind, "official_cua_frame_v1");
  assert.equal(
    attestFrame([{ ...content[0], dataUrl: "data:image/png;base64,invalid" }, ...content.slice(1)]),
    undefined,
  );
  assert.equal(
    (await preserveFrame({ ...result, content: [...result.content, result.content[0]] })).isError,
    true,
  );
  const forged = [...result.content];
  forged[1] = {
    type: "text",
    text: result.content[1].text.replace(/"sha256":"[a-f0-9]+"/, '"sha256":"forged"'),
  };
  assert.equal((await preserveFrame({ ...result, content: forged })).isError, true);
});

test("host disposal during startup cannot return a reusable lease", async () => {
  const { host } = fixture();
  const startup = host.start();
  await host.stop();
  await startup;
  await assert.rejects(host.start());
  assert.equal(host.running, false);
});
