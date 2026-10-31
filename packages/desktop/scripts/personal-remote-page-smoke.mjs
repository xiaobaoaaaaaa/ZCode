import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 编译真实二维码入口，并请求本地版本网关；不依赖外网、不读取真实配对凭据。
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../../shared/src/web-remote-control.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { buildWebRemoteControlExternalQrUrl, parseWebRemoteControlExternalQrParams } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const pages = new Set(["3.17.1", "3.16.2", "3.17.1-beta.1"]);
const gateway = createServer((request, response) => {
  const url = new URL(request.url, "http://fixture.invalid");
  const exists = pages.has(url.searchParams.get("app_version"));
  response.writeHead(exists ? 200 : 404, { "Content-Type": "text/html" });
  response.end(exists ? "<!doctype html><title>Remote control</title>" : "Not Found");
});
gateway.listen(0, "127.0.0.1");
await once(gateway, "listening");
try {
  for (const [appVersion, pageVersion] of [
    ["3.17.1-personal.3", "3.17.1"],
    ["3.16.2-personal.5", "3.16.2"],
    ["3.17.1-personal.3+build.7", "3.17.1"],
    ["3.17.1", "3.17.1"],
    ["3.17.1-beta.1", "3.17.1-beta.1"],
  ]) {
    const url = new URL(
      buildWebRemoteControlExternalQrUrl({
        baseUrl: `http://127.0.0.1:${gateway.address().port}/remote/v4?hash=old&t=old&custom=keep`,
        deviceSid: "fixture-device",
        deviceMid: "fixture-machine",
        deviceName: "Fixture Device",
        appVersion,
      }),
    );
    assert.equal(url.pathname, "/remote/v4");
    assert.equal(url.searchParams.get("app_version"), pageVersion);
    assert.equal(url.searchParams.get("custom"), "keep");
    assert.equal(url.searchParams.has("hash"), false);
    assert.equal(url.searchParams.has("t"), false);
    assert.deepEqual(parseWebRemoteControlExternalQrParams(url.searchParams), {
      deviceSid: "fixture-device",
      deviceMid: "fixture-machine",
      deviceName: "Fixture Device",
      appVersion: pageVersion,
    });
    const response = await fetch(url);
    assert.equal(response.status, 200, `${appVersion} must select an available upstream page`);
    assert.match(await response.text(), /Remote control/);
  }
  for (const version of [
    "3.17.1-personal.beta",
    "3.17.1-rc.1",
    "custom",
    "3.17.1-personal.3-extra",
  ]) {
    const url = new URL(
      buildWebRemoteControlExternalQrUrl({
        baseUrl: "https://example.test/custom-remote",
        appVersion: version,
      }),
    );
    assert.equal(url.origin, "https://example.test");
    assert.equal(url.pathname, "/custom-remote");
    assert.equal(url.searchParams.get("app_version"), version);
  }
  console.log("Personal remote page smoke: 9 version routes passed");
} finally {
  gateway.closeAllConnections();
  await new Promise((resolve, reject) =>
    gateway.close((error) => (error ? reject(error) : resolve())),
  );
}
