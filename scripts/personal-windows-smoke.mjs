import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertPreviewHost, verifyPreviewFiles } from "./personal-windows-preview.mjs";

export function parseDevToolsEndpoint(stderr) {
  const match =
    /^DevTools listening on (ws:\/\/127\.0\.0\.1:([0-9]+)\/devtools\/browser\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\r?$/m.exec(
      stderr,
    );
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return undefined;
  return match[1];
}

export function createDevToolsEndpointReader() {
  let tail = "";
  let endpoint;
  return (chunk = "") => {
    if (!endpoint) {
      const text = tail + chunk;
      const newline = text.lastIndexOf("\n");
      if (newline >= 0) endpoint = parseDevToolsEndpoint(text.slice(0, newline + 1));
      tail = text.slice(newline + 1).slice(-16384);
    }
    return endpoint;
  };
}

// 旧检查会把启动 logo 当成就绪；只观察真实登录按钮，不点击或绕过认证。
export function visibleLoginReady() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.visibility === "visible" &&
      style.display !== "none" &&
      Number(style.opacity) > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const button = document.querySelector('[data-testid="login-use-api-key-button"]');
  const blocker = document.querySelector('[data-testid="root-startup-loading"]');
  return (
    document.readyState === "complete" &&
    !visible(blocker) &&
    visible(button) &&
    !button.disabled &&
    button.getAttribute("aria-disabled") !== "true"
  );
}

export function smokeEnvironment(env, temporaryHome) {
  // 不把 Actions token/仓库凭据传给预览程序；使用产品已有路径覆盖，不改 HOME。
  const clean = Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      /^(path|systemroot|windir|comspec|systemdrive|temp|tmp|pathext|processor_architecture|number_of_processors)$/i.test(
        key,
      ),
    ),
  );
  return {
    ...clean,
    DO_NOT_TRACK: "1",
    ZCODE_ENV: "production",
    ZCODE_DESKTOP_HOME_DIR: temporaryHome,
    ZCODE_DATA_BASE_DIR: temporaryHome,
    ZCODE_DESKTOP_USER_DATA_DIR: join(temporaryHome, "electron"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(temporaryHome, "session"),
    ZCODE_DESKTOP_APPLICATION_NAME: "ZCode Personal Smoke",
  };
}

export async function smokePreview() {
  assertPreviewHost();
  const root = resolve(import.meta.dirname, "..");
  const output = resolve(root, "packages/desktop/dist-personal-preview");
  const unpacked = resolve(output, "win-unpacked");
  await verifyPreviewFiles(unpacked);
  const temporaryHome = await mkdtemp(join(tmpdir(), "zcode-personal-smoke-"));
  const evidence = resolve(output, "smoke-evidence");
  await mkdir(evidence, { recursive: true });
  await mkdir(join(temporaryHome, "electron"), { recursive: true });
  await mkdir(join(temporaryHome, "session"), { recursive: true });
  const env = smokeEnvironment(process.env, temporaryHome);
  const executable = resolve(unpacked, "ZCode Personal.exe");
  let child;
  let browser;
  let logs = "";
  let page;
  const rendererErrors = [];
  try {
    const probe =
      "const assert=require('node:assert/strict');assert.equal(process.versions.electron,'41.0.3');const {DatabaseSync}=require('node:sqlite');new DatabaseSync(':memory:').close();require('./resources/app.asar/node_modules/node-pty');console.log(JSON.stringify(process.versions));";
    const native = spawnSync(executable, ["-e", probe], {
      cwd: unpacked,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 30000,
    });
    await writeFile(
      resolve(evidence, "native-runtime.log"),
      `${native.stdout ?? ""}\n${native.stderr ?? ""}`,
    );
    if (native.error || native.status !== 0)
      throw new Error(
        `Packaged native runtime probe failed: ${native.error?.message ?? native.status}`,
      );
    child = spawn(
      executable,
      ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"],
      { cwd: unpacked, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let spawnError;
    child.on("error", (error) => {
      spawnError = error;
    });
    const readEndpoint = createDevToolsEndpointReader();
    child.stderr.on("data", (data) => readEndpoint(data.toString()));
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        logs = (logs + data.toString()).slice(-256 * 1024);
      });
    const deadline = Date.now() + 90000;
    let endpoint;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null)
        throw new Error(`Preview exited before renderer: ${spawnError?.message ?? child.exitCode}`);
      // Windows 诊断显示 Chromium 已监听，但端口文件不在 app 覆盖后的 userData；
      // 使用本次子进程自己的精确 loopback 公告，后续 renderer 挂载校验保持不变。
      endpoint = readEndpoint();
      if (endpoint) break;
      try {
        const value = (
          await readFile(join(temporaryHome, "electron", "DevToolsActivePort"), "utf8")
        ).split(/\r?\n/)[0];
        if (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535) {
          endpoint = `http://127.0.0.1:${Number(value)}`;
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await delay(500);
    }
    if (!endpoint) throw new Error("No renderer debugging endpoint within 90 seconds");
    await writeFile(resolve(evidence, "endpoint.json"), JSON.stringify({ endpoint }));
    const require = createRequire(resolve(root, "packages/desktop/package.json"));
    const { chromium } = require("playwright-core");
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
    while (Date.now() < deadline) {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find(
          (candidate) =>
            candidate.url().includes("/renderer/") && candidate.url().includes("index.html"),
        );
      if (page) break;
      await delay(500);
    }
    if (!page) throw new Error("Packaged renderer page did not open");
    page.on("pageerror", (error) => rendererErrors.push(error.message.slice(0, 2048)));
    await page.waitForFunction(
      () =>
        document.readyState === "complete" &&
        (document.querySelector("#root")?.childElementCount ?? 0) > 0,
      undefined,
      { timeout: 30000 },
    );
    await page.waitForFunction(visibleLoginReady, undefined, { timeout: 90000 });
    await page.screenshot({ path: resolve(evidence, "renderer.png") });
    await writeFile(
      resolve(evidence, "result.json"),
      JSON.stringify(
        {
          commit: process.env.GITHUB_SHA,
          nativeRuntime: "passed",
          rendererMounted: true,
          visibleUi: "login-entry",
          loginControlVisibleAndEnabled: true,
          signed: false,
          fullNativeAcceptance: false,
          oauthTested: false,
          userDataImported: false,
        },
        null,
        2,
      ),
    );
  } finally {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: resolve(evidence, "renderer.png") }).catch(() => {});
      const state = await page
        .evaluate(() => ({
          readyState: document.readyState,
          visibleText: document.body.innerText.slice(0, 8192),
          testIds: Array.from(document.querySelectorAll("[data-testid]"))
            .slice(0, 100)
            .map((element) => element.getAttribute("data-testid")),
        }))
        .catch((error) => ({ captureError: error.message }));
      await writeFile(
        resolve(evidence, "renderer-state.json"),
        JSON.stringify(
          {
            ...state,
            errors: rendererErrors.slice(-30),
          },
          null,
          2,
        ),
      );
    }
    if (browser) await browser.close().catch(() => {});
    if (child?.pid && child.exitCode === null)
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        timeout: 15000,
        stdio: "ignore",
      });
    await writeFile(resolve(evidence, "startup.log"), logs);
    await rm(temporaryHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await smokePreview();
