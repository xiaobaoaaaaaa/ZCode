import type { BrowserWindow, WebContents } from "electron";
import {
  parseSidePaneWindowKey,
  parseSidePaneWindowRequest,
  parseSidePaneViewRequest,
  sidePaneWindowChannels,
} from "./contract.js";
import { createSidePaneViewRegistry } from "./nativeViews.js";
export { resolveSidePaneViewOwner, resolveSidePaneViewPresentation } from "./nativeViews.js";

/** 安装在工作区窗口；辅助窗口不走 createWindow / spawnHostProcess。 */
export function attachSidePaneWindows(
  owner: BrowserWindow,
  options?: { prepareBrowserHost(host: WebContents): void },
): void {
  const views = options ? createSidePaneViewRegistry(owner, options.prepareBrowserHost) : undefined;
  const windows = new Map<string, { window: BrowserWindow; closing: boolean }>();
  owner.webContents.setWindowOpenHandler((details) => {
    const viewKey = parseSidePaneViewRequest(details.url, details.frameName);
    if (viewKey && views) return views.open(viewKey);
    const key = parseSidePaneWindowRequest(details.url, details.frameName);
    if (!key) return { action: "deny" };
    const existing = windows.get(key);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.focus();
      return { action: "deny" };
    }
    return {
      action: "allow",
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        width: 900,
        height: 700,
        minWidth: 360,
        minHeight: 240,
        frame: true,
        titleBarStyle: "default",
        transparent: false,
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      },
    };
  });
  owner.webContents.on("did-create-window", (window, details) => {
    const key = parseSidePaneWindowRequest(details.url, details.frameName);
    if (!key) return;
    const entry = { window, closing: false };
    windows.set(key, entry);
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
      if (entry.closing || owner.isDestroyed() || owner.webContents.isDestroyed()) return;
      // 原生关闭先回到唯一 UI owner；直接销毁子窗口会连带丢失其中的 DOM/终端。
      event.preventDefault();
      owner.webContents.send(sidePaneWindowChannels.closeRequested, key);
    });
    window.once("closed", () => windows.delete(key));
  });
  owner.webContents.on("ipc-message", (_event, channel, rawKey) => {
    if (channel !== sidePaneWindowChannels.close) return;
    const key = parseSidePaneWindowKey(rawKey);
    const entry = key ? windows.get(key) : undefined;
    if (!entry) return;
    entry.closing = true;
    if (!entry.window.isDestroyed()) entry.window.close();
  });
  owner.on("hide", () => {
    if (owner.webContents.isDestroyed()) return;
    for (const key of windows.keys())
      owner.webContents.send(sidePaneWindowChannels.closeRequested, key);
  });
  owner.once("closed", () => {
    for (const entry of windows.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy();
    }
    windows.clear();
  });
}
