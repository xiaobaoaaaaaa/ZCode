import {
  BaseWindow,
  WebContentsView,
  type BrowserWindow,
  type WebContents,
  type WindowOpenHandlerResponse,
} from "electron";
import type { SidePaneViewLayout } from "@zcode/shared";
import { parseSidePaneViewCommand, sidePaneWindowChannels } from "./contract.js";

interface Carrier {
  owner: BrowserWindow;
  view: WebContentsView;
  host: WebContents;
  floating?: BaseWindow;
  title: string;
  occluded: boolean;
  layout: SidePaneViewLayout;
}
const carriers = new Map<number, Carrier>();

/** 只按 main 创建的映射解析逻辑 owner，不能信任网页传入的窗口 ID。 */
export function resolveSidePaneViewOwner(hostWebContentsId: number): WebContents | undefined {
  const entry = carriers.get(hostWebContentsId);
  return entry && !entry.owner.isDestroyed() ? entry.owner.webContents : undefined;
}

export function resolveSidePaneViewPresentation(ownerWindowId: number, hostWebContentsId: number) {
  const entry = carriers.get(hostWebContentsId);
  if (!entry || entry.owner.id !== ownerWindowId || entry.owner.isDestroyed()) return undefined;
  return { window: entry.floating ?? entry.owner, webContents: entry.host };
}

function layoutCarrier(entry: Carrier): void {
  if (entry.host.isDestroyed()) return;
  const zoom = entry.owner.webContents.getZoomFactor();
  entry.host.setZoomFactor(zoom);
  const { layout, floating } = entry;
  const bounds = floating?.getContentBounds();
  entry.view.setBounds(
    bounds
      ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
      : {
          x: Math.round(layout.x * zoom),
          y: Math.round(layout.y * zoom),
          width: Math.max(1, Math.round(layout.width * zoom)),
          height: Math.max(1, Math.round(layout.height * zoom)),
        },
  );
  entry.view.setVisible(Boolean(floating) || (layout.visible && !entry.occluded));
}

export function createSidePaneViewRegistry(
  owner: BrowserWindow,
  prepareHost: (host: WebContents) => void,
) {
  const entries = new Map<string, Carrier>();
  const requestDock = (key: string) => {
    if (!owner.isDestroyed() && !owner.webContents.isDestroyed())
      owner.webContents.send(sidePaneWindowChannels.closeRequested, key);
  };
  const dock = (entry: Carrier) => {
    const floating = entry.floating;
    if (!floating) return;
    // webview 跨 document 搬移会销毁 guest；这里只搬原生视图，document/guest/CDP 始终不变。
    floating.contentView.removeChildView(entry.view);
    entry.floating = undefined;
    owner.contentView.addChildView(entry.view);
    layoutCarrier(entry);
    floating.close();
  };
  const dispose = (key: string, entry: Carrier) => {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    carriers.delete(entry.host.id);
    const floating = entry.floating;
    entry.floating = undefined;
    if (floating && !floating.isDestroyed()) {
      floating.contentView.removeChildView(entry.view);
      floating.close();
    } else if (!owner.isDestroyed()) owner.contentView.removeChildView(entry.view);
    // BaseWindow 不自动释放 WebContentsView；真正关闭标签时才显式销毁承载 document。
    if (!entry.host.isDestroyed()) entry.host.close();
  };
  owner.webContents.ipc.handle(sidePaneWindowChannels.viewCommand, async (event, raw: unknown) => {
    const command = parseSidePaneViewCommand(raw);
    if (event.sender.id !== owner.webContents.id || !command)
      throw new Error("Invalid side pane view command");
    const entry = entries.get(command.key);
    if (!entry) {
      if (command.action === "dispose") return;
      throw new Error("Side pane view unavailable");
    }
    switch (command.action) {
      case "detach": {
        if (entry.floating) {
          entry.floating.focus();
          return;
        }
        const floating = new BaseWindow({
          title: entry.title,
          width: 1000,
          height: 740,
          minWidth: 360,
          minHeight: 240,
          show: false,
          autoHideMenuBar: true,
        });
        owner.contentView.removeChildView(entry.view);
        floating.contentView.addChildView(entry.view);
        entry.floating = floating;
        floating.on("resize", () => layoutCarrier(entry));
        floating.on("close", (closeEvent) => {
          if (entry.floating !== floating || owner.isDestroyed()) return;
          closeEvent.preventDefault();
          requestDock(command.key);
        });
        layoutCarrier(entry);
        floating.show();
        return;
      }
      case "dock":
        dock(entry);
        return;
      case "layout":
        entry.layout = command.layout;
        layoutCarrier(entry);
        return;
      case "occlude":
        entry.occluded = command.occluded;
        layoutCarrier(entry);
        return;
      case "title":
        entry.title = command.title;
        entry.floating?.setTitle(command.title);
        return;
      case "focus":
        (entry.floating ?? owner).focus();
        entry.host.focus();
        return;
      case "capture":
        return (await entry.host.capturePage()).toDataURL();
      case "dispose":
        dispose(command.key, entry);
        return;
    }
  });
  owner.on("hide", () => {
    for (const [key, entry] of entries) if (entry.floating) requestDock(key);
  });
  owner.once("closed", () => {
    for (const [key, entry] of entries) dispose(key, entry);
  });
  return {
    open(key: string): WindowOpenHandlerResponse {
      if (entries.has(key)) return { action: "deny" };
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            webviewTag: true,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
        createWindow: (options) => {
          // 必须使用 Electron 提供的 options（含预建 webContents），保留同源 opener/WindowProxy。
          const view = new WebContentsView({
            ...options,
            webPreferences: {
              ...options.webPreferences,
              webviewTag: true,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          });
          const entry: Carrier = {
            owner,
            view,
            host: view.webContents,
            title: "",
            occluded: false,
            layout: { x: 0, y: 0, width: 1, height: 1, visible: false },
          };
          entries.set(key, entry);
          const hostId = view.webContents.id;
          carriers.set(hostId, entry);
          view.setBackgroundColor("#00000000");
          owner.contentView.addChildView(view);
          layoutCarrier(entry);
          prepareHost(view.webContents);
          view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          view.webContents.on("will-navigate", (event) => event.preventDefault());
          view.webContents.once("destroyed", () => {
            // destroyed 时 view.webContents getter 已失效；稳定引用用于清理映射与空窗口。
            dispose(key, entry);
          });
          return view.webContents;
        },
      };
    },
  };
}
