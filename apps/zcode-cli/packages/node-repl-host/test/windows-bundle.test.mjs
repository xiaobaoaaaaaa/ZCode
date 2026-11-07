import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createProductCuaHelperHost } from "@zcode/zcode-cua/broker/server";
import {
  preserveOfficialCuaFrameResult,
  attestOfficialCuaFrameContent,
} from "@zcode/zcode-cua/frame-contract";
import { buildNodeReplHostBundle } from "../scripts/build.mjs";

test(
  "packaged MCP Worker reaches authenticated Windows broker and preserves the final frame",
  { skip: process.platform !== "win32", timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-cua-bundle-"));
    const calls = [];
    let frame = 0;
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const host = createProductCuaHelperHost({
      platform: "win32",
      backend: {
        async call(request) {
          calls.push(request);
          return {
            app: { pid: 7, name: "Fixture" },
            window: { window_id: 8 },
            state_id: "state",
            text: "Fixture",
            elements: [],
            ...(request.args.include_screenshot
              ? { image: png, frame_id: `frame-${++frame}`, width: 1, height: 1 }
              : {}),
          };
        },
        async dispose() {},
      },
    });
    const client = new Client({ name: "windows-bundle-test", version: "1.0.0" });
    let runtime;
    let captured;
    try {
      const outfile = join(directory, "server.mjs");
      await buildNodeReplHostBundle({ outfile });
      const bundled = await import(pathToFileURL(outfile).href);
      const transport = await host.start();
      captured = bundled.captureComputerUseRuntimeFromEnvironment({
        ZCODE_CUA_PERMISSION_BROKER_SOCKET: transport.socketPath,
        ZCODE_CUA_PLUGIN_AUTHORITY: transport.pluginAuthority,
      });
      runtime = bundled.createNodeReplMcpRuntime({ cuaRuntime: captured });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await runtime.server.connect(serverTransport);
      await client.connect(clientTransport);
      const sdk = pathToFileURL(
        resolve(import.meta.dirname, "../../zcode-cua-plugin/scripts/computer-use-client.mjs"),
      ).href;
      const code = `const { setupComputerUseRuntime } = await import(${JSON.stringify(sdk)}); await setupComputerUseRuntime({ globals: globalThis }); const app = await agent.computerUse.getApp({pid:7}); await app.getScreenshot(); await app.getScreenshot();`;
      const context = {
        session_id: "bundled-session",
        workspace_key: "bundled-workspace",
        runtime_scope: "main",
      };
      const result = await client.callTool({
        name: "js",
        arguments: { code, title: "验证打包图片链路" },
        _meta: { "com.zcode/request-context": context },
      });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.equal(result.content.filter((block) => block.type === "image").length, 1);
      assert.equal(result.content[0].data, png);
      assert.match(result.content[1].text, /frame-2/);
      assert.equal(await preserveOfficialCuaFrameResult(result), result);
      assert.equal(attestOfficialCuaFrameContent(result.content)?.kind, "official_cua_frame_v1");
      assert.equal(calls.length, 3);
      const blocked = await client.callTool({
        name: "js",
        arguments: { code, title: "验证子会话拒绝" },
        _meta: { "com.zcode/request-context": { ...context, runtime_scope: "subagent" } },
      });
      assert.equal(blocked.isError, true);
      assert.equal(calls.length, 3);
    } finally {
      await client.close();
      runtime?.dispose();
      await captured?.dispose();
      await host.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
