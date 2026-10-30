import { nativeSidePaneDrag } from "../../../helpers/native-side-pane-drag.js";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import {
  TID_BROWSER_ADDRESS_INPUT,
  TID_BROWSER_PERMISSION_DENY,
  TID_BROWSER_PERMISSION_PROMPTS,
  TID_SIDE_PANE_TOGGLE,
} from "@zcode/shared/test-ids";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";
import { openFirstBrowserTab, clickCloseButton } from "../../../helpers/browser-side-pane.js";
import { clearAppData } from "../../../helpers/desktop-app.js";

let server: Server;
let url: string;
let requests = 0;
let ownerHandle: string;
let carrierHandle: string;
let guestId: number;
let ownerId: number;
let tabId: string;
const page = `<!doctype html><title>Preserved Browser</title><body style="background:#eef6ff;height:3000px"><h1>Preserved Browser</h1><label>Name <input id="name"></label><canvas id="paint" width="120" height="60"></canvas><script>window.token=Math.random();const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0080';ctx.fillRect(0,0,120,60);</script></body>`;
async function state() {
  return browser.electron.execute(async (electron, id) => {
    const guest = electron.webContents.fromId(id)!;
    return {
      id: guest.id,
      host: guest.hostWebContents?.id,
      ...(await guest.executeJavaScript(
        "({token:window.token,input:document.querySelector('input').value,canvas:document.querySelector('canvas').toDataURL(),scroll:scrollY,history:history.length,url:location.href})",
      )),
    };
  }, guestId);
}
async function floatingCount() {
  return browser.electron.execute(
    (electron, id) => electron.BaseWindow.getAllWindows().filter((win) => win.id !== id).length,
    ownerId,
  );
}
async function detach() {
  await browser.switchToWindow(ownerHandle);
  await $(`[data-side-pane-tab-id="${tabId}"]`).click({ button: "right" });
  await $(
    '//*[@role="menuitem" and (contains(.,"移至独立窗口") or contains(.,"Move to New Window"))]',
  ).click();
  await browser.waitUntil(async () => (await floatingCount()) === 1);
  await browser.switchToWindow(carrierHandle);
  await $("[data-detached-side-pane]").waitForDisplayed();
}

describe("SPW-005a browser page preservation", () => {
  before(async () => {
    server = createServer((request, response) => {
      if (request.url?.startsWith("/page")) requests++;
      response.writeHead(200, { "content-type": "text/html" });
      response.end(page);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture bind failed");
    url = `http://127.0.0.1:${address.port}/page`;
  });
  after(async () => {
    if (ownerHandle) await browser.switchToWindow(ownerHandle);
    await clearAppData();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("keeps guest, form, JS, canvas, scroll, history and pending CDP through moves; routes permissions and releases on close", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E({ skipProvider: true });
    ownerHandle = await browser.getWindowHandle();
    ownerId = await browser.electron.execute(
      (electron) => electron.BrowserWindow.getAllWindows()[0]!.id,
    );
    const before = new Set(await browser.getWindowHandles());
    await $(`[data-testid="${TID_SIDE_PANE_TOGGLE}"]`).click();
    await openFirstBrowserTab();
    tabId = (await $('[data-side-pane-tab-id][data-state="active"]').getAttribute(
      "data-side-pane-tab-id",
    ))!;
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > before.size);
    carrierHandle = (await browser.getWindowHandles()).find((handle) => !before.has(handle))!;
    await browser.switchToWindow(carrierHandle);
    const input = await $(`[data-testid="${TID_BROWSER_ADDRESS_INPUT}"]`);
    await input.waitForDisplayed({ timeout: 15_000 });
    await input.setValue(url);
    await input.click();
    await browser.keys("Enter");
    await browser.waitUntil(
      async () => {
        guestId = await browser.electron.execute(
          (electron, target) =>
            electron.webContents
              .getAllWebContents()
              .find((contents) => contents.getType() === "webview" && contents.getURL() === target)
              ?.id ?? 0,
          url,
        );
        return guestId > 0;
      },
      { timeout: 30_000 },
    );
    await browser.electron.execute(async (electron, id) => {
      const guest = electron.webContents.fromId(id)!;
      await guest.executeJavaScript(
        "document.querySelector('input').value='unsaved page state'; history.pushState({preserved:true},'', '#original'); scrollTo(0,300)",
      );
      if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
      // 启动真实未结算 CDP 命令，再由移动后的同一网页主动完成，不能靠重发模拟成功。
      void guest.debugger
        .sendCommand("Runtime.evaluate", {
          expression:
            "new Promise(resolve => { window.releasePending = () => resolve(window.token); })",
          awaitPromise: true,
          returnByValue: true,
        })
        .then(async (result) => {
          await guest.executeJavaScript(
            `window.pendingResult = ${JSON.stringify(result.result.value)}`,
          );
        });
    }, guestId);
    const original = await state();
    await detach();
    expect(await state()).toEqual(original);
    await browser.electron.execute(
      (electron, id) =>
        electron.webContents.fromId(id)!.executeJavaScript("window.releasePending()"),
      guestId,
    );
    await browser.waitUntil(async () =>
      browser.electron.execute(
        async (electron, id) =>
          await electron.webContents
            .fromId(id)!
            .executeJavaScript("window.pendingResult === window.token"),
        guestId,
      ),
    );
    await browser.saveScreenshot(join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "browser-detached.png"));

    // 权限请求来自 carrier 的 guest，提示仍由原平台 owner 收到并渲染在当前独立窗口。
    await browser.electron.execute(
      (electron, id) =>
        electron.webContents
          .fromId(id)!
          .executeJavaScript(
            "void navigator.mediaDevices.getUserMedia({video:true}).then(stream => stream.getTracks().forEach(track=>track.stop())).catch(error => window.mediaResult=error.name)",
          ),
      guestId,
    );
    await $(`[data-testid="${TID_BROWSER_PERMISSION_PROMPTS}"]`).waitForDisplayed({
      timeout: 15_000,
    });
    await $(`[data-testid="${TID_BROWSER_PERMISSION_DENY}"]`).click();
    await browser.waitUntil(async () =>
      browser.electron.execute(
        async (electron, id) =>
          await electron.webContents
            .fromId(id)!
            .executeJavaScript("window.mediaResult === 'NotAllowedError'"),
        guestId,
      ),
    );
    await $(
      '//header//button[contains(.,"收回侧栏") or contains(.,"Move Back to Sidebar")]',
    ).click();
    await browser.waitUntil(async () => (await floatingCount()) === 0);
    expect(await state()).toEqual(original);
    expect(requests).toBe(1);

    // 主窗口菜单必须盖住原生页面；关闭后恢复同一个 view，不触发页面 reload。
    await browser.switchToWindow(ownerHandle);
    await $(`[data-side-pane-tab-id="${tabId}"]`).click({ button: "right" });
    await browser.waitUntil(async () =>
      browser.execute(() => Boolean(document.querySelector("[data-native-side-pane] > img"))),
    );
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "browser-owner-menu.png"),
    );
    await browser.keys("Escape");
    await detach();
    await browser.electron.execute(
      (electron, id) =>
        electron.BaseWindow.getAllWindows()
          .find((win) => win.id !== id)
          ?.close(),
      ownerId,
    );
    await browser.waitUntil(async () => (await floatingCount()) === 0);
    expect(await state()).toEqual(original);
    expect(requests).toBe(1);
    await browser.switchToWindow(ownerHandle);
    if (process.platform === "linux" && process.env.DISPLAY) {
      const bounds = await browser.electron.execute(
        (electron, id) => electron.BrowserWindow.fromId(id)!.getContentBounds(),
        ownerId,
      );
      const point = await browser.execute((id) => {
        const rect = document
          .querySelector(`[data-side-pane-tab-id="${id}"]`)!
          .getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      }, tabId);
      await nativeSidePaneDrag(
        { x: bounds.x + point.x, y: bounds.y + point.y },
        { x: bounds.x + bounds.width + 70, y: bounds.y + point.y },
      );
      await browser.waitUntil(async () => (await floatingCount()) === 1);
      const childBounds = await browser.electron.execute((electron, id) => {
        const child = electron.BaseWindow.getAllWindows().find((win) => win.id !== id)!;
        child.setBounds({ x: 1000, y: 600, width: 400, height: 350 });
        return child.getContentBounds();
      }, ownerId);
      await browser.switchToWindow(carrierHandle);
      await $("[data-side-pane-window-drag]").waitForDisplayed();
      const source = await browser.execute(() => {
        const rect = document
          .querySelector("[data-side-pane-window-drag]")!
          .getBoundingClientRect();
        return { x: Math.round(rect.x + 25), y: Math.round(rect.y + rect.height / 2) };
      });
      await nativeSidePaneDrag(
        { x: childBounds.x + source.x, y: childBounds.y + source.y },
        { x: bounds.x + point.x, y: bounds.y + point.y },
      );
      await browser.waitUntil(async () => (await floatingCount()) === 0);
      expect(await state()).toEqual(original);
      expect(requests).toBe(1);
      await browser.switchToWindow(ownerHandle);
    }
    await clickCloseButton(tabId);
    await browser.waitUntil(async () =>
      browser.electron.execute((electron, id) => !electron.webContents.fromId(id), guestId),
    );
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1);
  });
});
