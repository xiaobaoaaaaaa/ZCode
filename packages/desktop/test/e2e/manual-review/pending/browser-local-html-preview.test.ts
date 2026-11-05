import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TID_BROWSER_ADDRESS_INPUT, TID_BROWSER_WEBVIEW } from "@zcode/shared/test-ids";
import { openFirstBrowserTab } from "#e2e/helpers/browser-side-pane";
import { getE2EAppDataPaths } from "#e2e/helpers/desktop-app";
import { startDraftFromProject } from "#e2e/helpers/project-sidebar";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import {
  startElectronWindowRecording,
  type ElectronWindowRecordingSession,
} from "#e2e/helpers/electron-window-recorder";

async function runInGuest(script: string): Promise<unknown> {
  return browser.execute(
    async (testId, code) => {
      const guest = document.querySelector(`[data-testid="${testId}"]`) as
        | (HTMLElement & { executeJavaScript(code: string): Promise<unknown> })
        | null;
      if (!guest) throw new Error("Browser guest is missing");
      return guest.executeJavaScript(code);
    },
    TID_BROWSER_WEBVIEW,
    script,
  );
}

describe("本地 HTML 预览的文件权限边界", () => {
  let ownerHandle: string;
  let directory: string;
  let fileUrl: string;
  let outsideUrl: string;
  let canonicalFileUrl: string;
  let server: Server;
  let httpUrl: string;
  let recording: ElectronWindowRecordingSession | undefined;

  before(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>HTTP control</title><p>HTTP control</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture did not start");
    httpUrl = `http://127.0.0.1:${address.port}/`;
    directory = await mkdtemp(join(tmpdir(), "zcode-html-preview-"));
    const preview = join(directory, "预览 空格");
    const outside = join(directory, "outside");
    await Promise.all([mkdir(preview), mkdir(outside)]);
    fileUrl = pathToFileURL(join(preview, "页面.html")).href;
    outsideUrl = pathToFileURL(join(outside, "secret.txt")).href;
    await Promise.all([
      writeFile(join(outside, "secret.txt"), "SYNTHETIC_OUTSIDE_SECRET"),
      writeFile(join(preview, ".env"), "SYNTHETIC_HIDDEN_SECRET"),
      writeFile(join(preview, "data.json"), '{"ok":true}'),
      writeFile(join(preview, "style.css"), "body { color: rgb(12, 34, 56); }"),
      writeFile(join(preview, "classic.js"), "window.classicLoaded = true;"),
      writeFile(join(preview, "module.js"), "window.moduleLoaded = true;"),
      writeFile(
        join(preview, "image.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
      ),
      writeFile(join(preview, "next.html"), "<title>next</title><p>Next page</p>"),
      writeFile(
        join(preview, "页面.html"),
        `<!doctype html><html><head>
        <title>Local HTML boundary</title><link rel="stylesheet" href="style.css">
        <script src="classic.js"></script><script type="module" src="module.js"></script>
        </head><body><img src="image.svg"><a id="next" href="next.html">Next</a></body></html>`,
      ),
      symlink(outside, join(preview, "linked"), process.platform === "win32" ? "junction" : "dir"),
    ]);
    canonicalFileUrl = pathToFileURL(await realpath(join(preview, "页面.html"))).href;
  });

  after(async () => {
    if (ownerHandle) await browser.switchToWindow(ownerHandle);
    await recording?.stop();
    await rm(directory, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("真实浏览器入口加载相对资源，同时拒绝越界文件并支持刷新和后退", async function () {
    this.timeout(240_000);
    // 采集手工评审证据，也让被遮挡的 Linux 窗口持续出帧；否则动画可停在 opacity=0。
    recording = await startElectronWindowRecording({
      frameIntervalMs: 200,
      outputPath: join(
        process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".e2e-artifacts",
        "browser-local-html-preview.webm",
      ),
    });
    await prepareV4ConversationE2E();
    await startDraftFromProject(getE2EAppDataPaths().workspace);
    ownerHandle = await browser.getWindowHandle();
    const initialHandles = new Set(await browser.getWindowHandles());
    await openFirstBrowserTab();
    const tabId = await $('[data-side-pane-tab-id][data-state="active"]').getAttribute(
      "data-side-pane-tab-id",
    );
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length > initialHandles.size,
    );
    const carrierHandle = (await browser.getWindowHandles()).find(
      (handle) => !initialHandles.has(handle),
    )!;
    // Personal 浏览器 DOM 位于稳定承载 document，不能在主 document 查找而漏跑页面断言。
    await browser.switchToWindow(carrierHandle);
    const input = await $(`[data-testid="${TID_BROWSER_ADDRESS_INPUT}"]`);
    await input.waitForDisplayed({ timeout: 15_000 });
    await input.setValue(fileUrl);
    await input.click();
    await browser.keys("Enter");
    await browser.waitUntil(
      async () => (await runInGuest("document.title")) === "Local HTML boundary",
      { timeout: 30_000, timeoutMsg: "本地 HTML 未加载" },
    );
    expect(await runInGuest("location.protocol")).toBe("zcode-html:");
    expect(await input.getValue()).toBe(canonicalFileUrl);
    await browser.waitUntil(
      async () =>
        Boolean(
          await runInGuest(
            "window.classicLoaded && window.moduleLoaded && document.querySelector('img').naturalWidth === 2",
          ),
        ),
      { timeout: 10_000, timeoutMsg: "相对脚本或图片未加载" },
    );
    expect(await runInGuest("getComputedStyle(document.body).color")).toBe("rgb(12, 34, 56)");
    expect(await runInGuest("fetch('data.json').then(r => r.json())")).toEqual({
      ok: true,
    });

    const guestId = await browser.execute((testId) => {
      const guest = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement & {
        getWebContentsId(): number;
      };
      return guest.getWebContentsId();
    }, TID_BROWSER_WEBVIEW);
    await browser.switchToWindow(ownerHandle);
    await $(`[data-side-pane-tab-id="${tabId}"]`).click({ button: "right" });
    await $(
      '//*[@role="menuitem" and (contains(.,"移至独立窗口") or contains(.,"Move to New Window"))]',
    ).click();
    await browser.switchToWindow(carrierHandle);
    await $("[data-detached-side-pane]").waitForDisplayed();
    await input.setValue(`${fileUrl}#detached`);
    await input.click();
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await runInGuest("location.hash")) === "#detached");
    expect(
      await browser.execute((testId) => {
        const guest = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement & {
          getWebContentsId(): number;
        };
        return guest.getWebContentsId();
      }, TID_BROWSER_WEBVIEW),
    ).toBe(guestId);
    await $(
      '//header//button[contains(.,"收回侧栏") or contains(.,"Move Back to Sidebar")]',
    ).click();
    await browser.waitUntil(async () => !(await $("[data-detached-side-pane]").isExisting()));
    expect(await runInGuest("location.hash")).toBe("#detached");

    await browser.switchToWindow(ownerHandle);
    // CDP 序列化回调没有模块加载上下文；在测试进程解析实际 preload 路径后传入 main。
    const testPreload = fileURLToPath(new URL("../preload/index.cjs", await browser.getUrl()));
    const foreignNavigation = await browser.electron.execute(
      async (electron, targetId, url, preload) => {
        const foreign = new electron.BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            preload,
          },
        });
        try {
          await foreign.loadURL("about:blank");
          return {
            navigation: await foreign.webContents.executeJavaScript(
              `window.zcode.browserViewLoadUrl(${JSON.stringify({ webContentsId: targetId, url })}).then(() => "allowed", error => error.message)`,
            ),
          };
        } catch (error) {
          return { setupError: String(error) };
        } finally {
          foreign.destroy();
        }
      },
      guestId,
      httpUrl,
      testPreload,
    );
    expect(foreignNavigation).toEqual({
      navigation: expect.stringContaining("Browser navigation owner mismatch"),
    });
    await browser.switchToWindow(carrierHandle);
    expect(await runInGuest("location.protocol")).toBe("zcode-html:");

    const results = await runInGuest(`(async () => {
      const forged = new URL(location.href); forged.hostname = '0'.repeat(64);
      const urls = [${JSON.stringify(outsideUrl)}, 'linked/secret.txt', '.env',
        '../outside/secret.txt', '%2e%2e%2foutside%2fsecret.txt', forged.href];
      return Promise.all(urls.map(async url => {
        try { const r = await fetch(url); return r.ok ? await r.text() : null; }
        catch { return null; }
      }));
    })()`);
    expect(results).toEqual([null, null, null, null, null, null]);
    // 等待加载结果后读取，避免 iframe 仍在 about:blank 时产生假通过；拒绝加载可能没有 load 事件。
    await runInGuest(`new Promise(resolve => {
      const frame = document.createElement('iframe'); frame.id = 'outside';
      const timeout = setTimeout(resolve, 2000);
      frame.onload = frame.onerror = () => { clearTimeout(timeout); resolve(); };
      frame.src = ${JSON.stringify(outsideUrl)}; document.body.append(frame);
    })`);
    expect(
      await runInGuest(`(() => {
      try { return document.querySelector('#outside').contentDocument?.body?.textContent?.includes('SYNTHETIC_OUTSIDE_SECRET') ?? false; }
      catch { return false; }
    })()`),
    ).toBe(false);

    const previewUrl = await runInGuest("location.href");
    const previousBoot = await runInGuest("performance.timeOrigin");
    await runInGuest("void location.reload()");
    await browser.waitUntil(
      async () =>
        Boolean(
          await runInGuest(`window.moduleLoaded && performance.timeOrigin !== ${previousBoot}`),
        ),
      {
        timeout: 15_000,
      },
    );
    await runInGuest("document.querySelector('#next').click()");
    await browser.waitUntil(async () => (await runInGuest("document.title")) === "next", {
      timeout: 15_000,
    });
    await runInGuest("history.back()");
    await browser.waitUntil(async () => (await runInGuest("location.href")) === previewUrl, {
      timeout: 15_000,
    });

    const isolation = await browser.electron.execute(async (electron, url) => {
      const control = new electron.BrowserWindow({
        show: false,
        webPreferences: { sandbox: true },
      });
      const denied = new electron.BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          partition: "persist:zcode-embedded-browser",
        },
      });
      try {
        await control.loadURL(url);
        let blocked = false;
        try {
          await denied.loadURL(url);
        } catch {
          blocked = true;
        }
        return {
          defaultLoaded: await control.webContents.executeJavaScript("document.title"),
          blocked,
        };
      } finally {
        control.destroy();
        denied.destroy();
      }
    }, fileUrl);
    expect(isolation).toEqual({
      defaultLoaded: "Local HTML boundary",
      blocked: true,
    });

    // 同一轮 renderer 调用先发本地文件、再发 HTTP，文件校验的异步结果不能覆盖后者。
    await browser.switchToWindow(ownerHandle);
    await browser.execute(
      async (webContentsId, localUrl, remoteUrl) => {
        const platform = (
          window as Window & {
            zcode?: {
              browserViewLoadUrl(payload: { webContentsId: number; url: string }): Promise<void>;
            };
          }
        ).zcode;
        if (!platform) throw new Error("Desktop platform bridge is missing");
        await Promise.allSettled([
          platform.browserViewLoadUrl({ webContentsId, url: localUrl }),
          platform.browserViewLoadUrl({ webContentsId, url: remoteUrl }),
        ]);
      },
      guestId,
      fileUrl,
      httpUrl,
    );
    await browser.switchToWindow(carrierHandle);
    expect(await runInGuest("location.href")).toBe(httpUrl);
    expect(await runInGuest("document.title")).toBe("HTTP control");
  });
});
