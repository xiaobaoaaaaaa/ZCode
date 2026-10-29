import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, _electron as electron } from "playwright-core";
import { targets } from "./personal-release.mjs";

const target = process.argv[2];
const config = targets[target];
assert.ok(config, `unsupported target: ${target}`);
assert.equal(process.platform, config.platform, "smoke test must run on its native OS");
assert.equal(process.arch, config.arch, "smoke test must run on its native architecture");
const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const dist = join(root, "packages/desktop/dist");
const executablePath =
  config.platform === "darwin"
    ? join(dist, config.arch === "arm64" ? "mac-arm64" : "mac", "ZCode.app/Contents/MacOS/ZCode")
    : config.platform === "win32"
      ? join(dist, "win-unpacked/ZCode.exe")
      : join(dist, config.arch === "arm64" ? "linux-arm64-unpacked" : "linux-unpacked", "zcode");
const output = join(root, "dist/personal-release-validation", target);
const home = join(process.env.RUNNER_TEMP || output, `zcode-release-smoke-${target}`);
await mkdir(home, { recursive: true });
await mkdir(output, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
delete env.NODE_OPTIONS;
Object.assign(env, {
  ZCODE_DATA_BASE_DIR: home,
  ZCODE_DESKTOP_HOME_DIR: home,
  ZCODE_DESKTOP_USER_DATA_DIR: join(home, "electron"),
  ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
});
let stdout = "";
let stderr = "";
let app;
let browser;
let child;
let page;
try {
  if (config.platform === "win32") {
    // Windows 正式包关闭 Node Inspector，Playwright Electron.launch 无法接管；保留 fuse，改用 Chromium CDP。
    child = spawn(executablePath, ["--remote-debugging-port=0"], { env, stdio: "pipe" });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const endpoint = await new Promise((resolveEndpoint, reject) => {
      const timeout = setTimeout(() => reject(new Error("Windows CDP startup timed out")), 120_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Windows application exited: ${code}`));
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(stderr);
        if (match) {
          clearTimeout(timeout);
          resolveEndpoint(match[1]);
        }
      });
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 90_000 }));
  } else {
    app = await electron.launch({
      executablePath,
      args: config.platform === "linux" ? ["--no-sandbox"] : [],
      env,
      timeout: 120_000,
    });
    child = app.process();
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    page = await app.firstWindow({ timeout: 90_000 });
  }
  // 初始化遮罩也含 ZCode 文本，必须等待真实登录入口，避免在数据库启动中途误判成功并退出。
  const loginButton = page.getByTestId("login-use-api-key-button");
  await loginButton.waitFor({ state: "visible", timeout: 90_000 });
  assert.ok(await loginButton.isEnabled(), "login entry must be enabled");
  await page.screenshot({ path: join(output, "welcome.png"), timeout: 30_000 });
  let runtime;
  if (config.platform === "win32") {
    const aboutReady = page.context().waitForEvent("page", { timeout: 30_000 });
    await page.evaluate(() => window.zcode.executeDesktopCommand("showAbout"));
    const about = await aboutReady;
    await about.waitForFunction((wanted) => document.body.innerText.includes(wanted), version);
    const text = await about.locator("body").innerText();
    const exe = await readFile(executablePath);
    assert.equal(
      exe.readUInt16LE(exe.readUInt32LE(0x3c) + 4),
      0x8664,
      "Windows executable must be PE x64",
    );
    assert.equal(await page.evaluate(() => navigator.platform), "Win32");
    runtime = {
      version: text.match(/\d+\.\d+\.\d+-personal\.\d+/u)?.[0],
      platform: "win32",
      arch: "x64",
      versionVerification: "about-dialog",
      architectureVerification: "PE-x64",
      homeIsolated: (await readdir(join(home, ".zcode", "v2"))).length > 0,
      userDataIsolated: (await readdir(join(home, "electron"))).length > 0,
    };
    await about.screenshot({ path: join(output, "about.png") });
  } else {
    runtime = await app.evaluate(({ app: electronApp }) => ({
      version: electronApp.getVersion(),
      platform: process.platform,
      arch: process.arch,
      homeIsolated: electronApp.getPath("home") === process.env.ZCODE_DESKTOP_HOME_DIR,
      userDataIsolated: electronApp.getPath("userData") === process.env.ZCODE_DESKTOP_USER_DATA_DIR,
    }));
  }
  assert.equal(runtime.version, version);
  assert.equal(runtime.platform, config.platform);
  assert.equal(runtime.arch, config.arch);
  assert.ok(runtime.homeIsolated && runtime.userDataIsolated);
  await writeFile(
    join(output, "smoke.json"),
    `${JSON.stringify({ ok: true, welcomeReady: true, ...runtime, title: await page.title() }, null, 2)}\n`,
  );
  console.log(`Packaged application startup passed: ${target} ${version}`);
} catch (error) {
  await page?.screenshot({ path: join(output, "failure.png"), timeout: 10_000 }).catch(() => {});
  await writeFile(join(output, "failure.txt"), String(error));
  throw error;
} finally {
  if (app) await app.close();
  if (browser) await browser.close();
  if (config.platform === "win32" && child?.pid && child.exitCode === null) {
    await promisify(execFile)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  }
  await writeFile(join(output, "stdout.log"), stdout);
  await writeFile(join(output, "stderr.log"), stderr);
}
