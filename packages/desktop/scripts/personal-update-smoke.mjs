import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import { _electron } from "playwright-core";
import { expectedFiles, targets } from "../../../scripts/personal-release.mjs";

const desktopDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopDir, "../..");
const require = createRequire(resolve(desktopDir, "package.json"));
await mkdir(resolve(desktopDir, ".e2e-artifacts"), { recursive: true });
const artifacts = await mkdtemp(resolve(desktopDir, ".e2e-artifacts/personal-update-"));
const bytes = Buffer.alloc(2 * 1024 * 1024, 65);
const checksum = createHash("sha512").update(bytes).digest("base64");
let scenario, version, requests;
function release(value, extra = {}) {
  return {
    tag_name: `v${value}`,
    draft: false,
    prerelease: false,
    name: value,
    body: "Personal update smoke",
    published_at: "2026-11-01T00:00:00Z",
    ...extra,
  };
}
const assistantVersion = "3.18.2-personal.4.assistant.2";
const nextAssistantVersion = "3.18.2-personal.4.assistant.3";
const newerRegularVersion = "3.18.2-personal.5";
const mixedReleases = [
  release(newerRegularVersion),
  release(nextAssistantVersion, { prerelease: true }),
  release("3.18.2-personal.4.assistant.5", { draft: true, prerelease: true }),
  release("3.18.2-personal.4.assistant.4"),
  release("3.18.2-personal.4.assistant.9.extra", { prerelease: true }),
];
const channelCases = {
  "assistant-preview": {
    installed: assistantVersion,
    preview: true,
    candidates: mixedReleases,
    expected: nextAssistantVersion,
  },
  "regular-preview": {
    installed: "3.18.2-personal.4",
    preview: true,
    candidates: mixedReleases.filter((r) => r.tag_name !== "v" + newerRegularVersion),
    expected: null,
  },
  "assistant-stable": {
    installed: assistantVersion,
    preview: false,
    candidates: release(newerRegularVersion),
    expected: newerRegularVersion,
  },
  "assistant-stable-older": {
    installed: assistantVersion,
    preview: false,
    candidates: release("3.18.2-personal.3"),
    expected: null,
  },
  "special-mislabeled-latest": {
    installed: "3.18.2-personal.3",
    preview: false,
    candidates: release(assistantVersion),
    expected: null,
  },
};

const server = createServer((req, res) => {
  requests.push(req.url);
  if (req.url === "/advance") {
    version = "3.17.1-personal.5";
    res.end("ok");
    return;
  }
  if (scenario.name === "http-error") {
    res.writeHead(503);
    res.end("unavailable");
    return;
  }
  if (req.url.startsWith("/api/releases")) {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        channelCases[scenario.name]?.candidates ??
          (req.url.includes("?")
            ? [
                release("99.0.0-personal.1", { draft: true }),
                release("99.0.0"),
                release("3.17.1-personal.4"),
                release("3.17.1-personal.6", { prerelease: true }),
              ]
            : release(scenario.name === "official-only" ? "99.0.0" : version)),
      ),
    );
  } else if (req.url.endsWith("/release-manifest.json")) {
    const manifestVersion = req.url.split("/")[3].slice(1);
    const assets = Object.keys(targets)
      .flatMap((target) => expectedFiles(manifestVersion, target))
      .map((name) => ({
        name: scenario.name === "wrong-name" ? name.replace("ZCode-Personal-", "ZCode-") : name,
        size: bytes.length,
        sha512: scenario.name === "bad-hash" ? "invalid" : checksum,
      }))
      .filter((asset) => scenario.name !== "missing-format" || !asset.name.endsWith(".AppImage"));
    res.end(
      JSON.stringify({
        version: scenario.name === "wrong-version" ? "99.0.0-personal.1" : manifestVersion,
        assets,
      }),
    );
  } else if (req.url.startsWith("/releases/download/")) {
    res.writeHead(200, {
      "Content-Length": bytes.length,
      "Content-Type": "application/octet-stream",
    });
    const payload = scenario.name === "corrupt-download" ? Buffer.alloc(bytes.length, 66) : bytes;
    let offset = 0;
    // 慢速真实 HTTP 流触发 electron-updater progress 和取消，不直接伪造 updater 事件。
    const timer = setInterval(() => {
      res.write(payload.subarray(offset, offset + 65536));
      offset += 65536;
      if (offset >= payload.length) {
        clearInterval(timer);
        res.end();
      }
    }, 40);
    res.on("close", () => clearInterval(timer));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const modes = {
  appimage: ["AppImageUpdater", "linux", ".AppImage"],
  deb: ["DebUpdater", "linux", ".deb"],
  rpm: ["RpmUpdater", "linux", ".rpm"],
  pacman: ["PacmanUpdater", "linux", ".pkg.tar.zst"],
  nsis: ["NsisUpdater", "win32", ".exe"],
  mac: ["AppImageUpdater", "darwin", ".zip"],
};
try {
  for (const [mode, [updater, platform, extension]] of Object.entries(modes)) {
    const entry = resolve(artifacts, `${mode}.cjs`);
    await build({
      entryPoints: [resolve(import.meta.dirname, "personal-update-smoke-fixture.mjs")],
      outfile: entry,
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron", "electron-updater", "semver"],
      define: {
        __ZCODE_PRODUCT_FLAVOR__: '"personal"',
        "process.platform": JSON.stringify(platform),
      },
      alias: { "@zcode/shared": resolve(repoRoot, "packages/shared/src/index.ts") },
      plugins: [
        {
          name: "personal-smoke-boundaries",
          setup(api) {
            api.onLoad({ filter: /manifestUpdateProvider\.ts$/ }, async ({ path }) => ({
              contents: (await readFile(path, "utf8"))
                .replace('"https://github.com/xiaobaoaaaaaa/ZCode"', JSON.stringify(origin))
                .replace(
                  '"https://api.github.com/repos/xiaobaoaaaaaa/ZCode/releases"',
                  JSON.stringify(origin + "/api/releases"),
                ),
              loader: "ts",
            }));
            api.onResolve({ filter: /^electron-updater$/ }, (args) =>
              args.namespace === "smoke-updater"
                ? { path: args.path, external: true }
                : { path: args.path, namespace: "smoke-updater" },
            );
            api.onLoad({ filter: /.*/, namespace: "smoke-updater" }, () => ({
              contents: `const pkg = require('electron-updater'); module.exports = {...pkg, autoUpdater: new pkg.${updater}()};`,
            }));
            api.onResolve({ filter: /^\.\/logger\.js$/ }, (args) =>
              args.importer.endsWith("/autoUpdater.ts")
                ? { path: "logger", namespace: "smoke-logger" }
                : undefined,
            );
            api.onLoad({ filter: /.*/, namespace: "smoke-logger" }, () => ({
              contents:
                "export const logger = {info:console.log, warn:console.warn, error:console.error};",
            }));
          },
        },
      ],
    });
    const names =
      mode === "appimage"
        ? [
            "update",
            "no-update",
            "older",
            "official-only",
            "preview",
            ...Object.keys(channelCases),
            "wrong-version",
            "wrong-name",
            "bad-hash",
            "missing-format",
            "http-error",
            "corrupt-download",
            "cancel",
          ]
        : mode === "mac"
          ? ["update", "assistant-preview"]
          : ["update"];
    for (const name of names) {
      const channelCase = channelCases[name];
      scenario = {
        mode,
        name,
        extension,
        ...(channelCase
          ? {
              channelCheck: {
                installed: channelCase.installed,
                preview: channelCase.preview,
                expected: channelCase.expected,
              },
            }
          : {}),
      };
      requests = [];
      version =
        name === "no-update"
          ? "3.17.1-personal.3"
          : name === "older"
            ? "3.17.1-personal.2"
            : "3.17.1-personal.4";
      if (name === "preview") version = "3.17.1-personal.6";
      const root = resolve(artifacts, `${mode}-${name}`);
      await mkdir(root);
      const env = {
        ...process.env,
        NODE_PATH: resolve(repoRoot, "node_modules"),
        ZCODE_PERSONAL_SMOKE_ROOT: root,
        ZCODE_PERSONAL_SMOKE_ORIGIN: origin,
        ZCODE_PERSONAL_SMOKE_SCENARIO: JSON.stringify(scenario),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.APPIMAGE;
      // 所有文件只在独立 userData/cache 内下载；夹具替换安装执行端，不运行安装包。
      env.XDG_CACHE_HOME = resolve(root, "cache");
      const electron = await _electron.launch({
        executablePath: require("electron"),
        args: [
          "--no-sandbox",
          ...(process.env.DISPLAY ? [] : ["--ozone-platform=headless"]),
          entry,
        ],
        env,
      });
      const child = electron.process();
      let output = "";
      child.stdout?.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        output += chunk;
      });
      const deadline = setTimeout(() => child.kill(), 30000);
      try {
        // 连接完成后才允许夹具执行；完成 Promise 是验收信号，不与 app.exit 争抢调试连接。
        await electron.evaluate(() => globalThis.runPersonalUpdateSmoke());
        const result = JSON.parse(await readFile(resolve(root, "result.json"), "utf8"));
        if (["no-update", "older", "official-only"].includes(name))
          assert.equal(requests.length, 1);
        if (channelCase) {
          assert.equal(
            requests[0],
            channelCase.preview ? "/api/releases?per_page=100" : "/api/releases/latest",
          );
          if (channelCase.expected === null) assert.equal(requests.length, 1);
          else
            assert.ok(
              requests.includes(
                `/releases/download/v${channelCase.expected}/release-manifest.json`,
              ),
            );
        }
        if (mode === "mac")
          assert.ok(!requests.some((url) => url.endsWith(".zip") || url.endsWith(".dmg")));
        await writeFile(resolve(root, "requests.json"), JSON.stringify(requests, null, 2));
        assert.equal(result.scenario.name, name);
        console.log(`PASS ${mode}/${name}`);
      } finally {
        clearTimeout(deadline);
        await writeFile(resolve(root, "runtime.log"), output);
        await electron.close().catch(() => {});
      }
    }
  }
  console.log(`Evidence: ${artifacts}`);
} finally {
  server.closeAllConnections();
  server.close();
}
