import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  SIDE_PANE_VIEW_PREFIX,
  parseSidePaneViewCommand,
  parseSidePaneViewRequest,
  sidePaneWindowChannels,
} from "../src/side-pane-windows/contract.js";
import {
  createSidePaneViewRegistry,
  resolveSidePaneViewOwner,
  resolveSidePaneViewPresentation,
} from "../src/side-pane-windows/nativeViews.js";
import type { BrowserWindow } from "electron";

let nextId = 100;
function contents() {
  return Object.assign(new EventEmitter(), {
    id: nextId++,
    ipc: { handle: vi.fn(), removeHandler: vi.fn() },
    isDestroyed: () => false,
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    getZoomFactor: () => 1.25,
    setZoomFactor: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    capturePage: vi.fn(async () => ({ toDataURL: () => "data:image/png;base64,frame" })),
  });
}
function nativeWindow() {
  const children: unknown[] = [];
  return Object.assign(new EventEmitter(), {
    id: nextId++,
    webContents: contents(),
    contentView: {
      addChildView: vi.fn((view) => children.push(view)),
      removeChildView: vi.fn((view) => children.splice(children.indexOf(view), 1)),
    },
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setTitle: vi.fn(),
    focus: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
  });
}
vi.mock("electron", () => ({
  BaseWindow: vi.fn(function () {
    return nativeWindow();
  }),
  WebContentsView: vi.fn(function () {
    return {
      webContents: contents(),
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBackgroundColor: vi.fn(),
    };
  }),
}));
const key = "019a24da-24b0-7817-97ca-333fe8f00df4";
describe("stable browser native carrier", () => {
  it("requests docking on owner hide and disposes the carrier on owner close", async () => {
    const owner = nativeWindow();
    const registry = createSidePaneViewRegistry(owner as unknown as BrowserWindow, vi.fn());
    const response = registry.open(key);
    if (response.action !== "allow" || !response.createWindow) throw new Error("missing carrier");
    const host = response.createWindow({});
    const command = owner.webContents.ipc.handle.mock.calls[0]![1];
    await command({ sender: owner.webContents }, { key, action: "detach" });
    const floating = resolveSidePaneViewPresentation(owner.id, host.id)!.window;
    owner.emit("hide");
    expect(owner.webContents.send).toHaveBeenCalledWith(sidePaneWindowChannels.closeRequested, key);
    expect(host.close).not.toHaveBeenCalled();
    owner.emit("closed");
    expect(floating.close).toHaveBeenCalledOnce();
    expect(host.close).toHaveBeenCalledOnce();
    expect(resolveSidePaneViewOwner(host.id)).toBeUndefined();
  });
  it("closes an empty floating window when its carrier is unexpectedly destroyed", async () => {
    const owner = nativeWindow();
    const registry = createSidePaneViewRegistry(owner as unknown as BrowserWindow, vi.fn());
    const response = registry.open(key);
    if (response.action !== "allow" || !response.createWindow) throw new Error("missing carrier");
    const host = response.createWindow({});
    const id = host.id;
    const view = owner.contentView.addChildView.mock.calls[0]![0];
    const command = owner.webContents.ipc.handle.mock.calls[0]![1];
    await command({ sender: owner.webContents }, { key, action: "detach" });
    const floating = resolveSidePaneViewPresentation(owner.id, id)!.window;
    Object.defineProperty(view, "webContents", { get: () => undefined });
    host.isDestroyed = () => true;
    expect(() => host.emit("destroyed")).not.toThrow();
    expect(floating.close).toHaveBeenCalledOnce();
    expect(host.close).not.toHaveBeenCalled();
    expect(resolveSidePaneViewOwner(id)).toBeUndefined();
    await command({ sender: owner.webContents }, { key, action: "dispose" });
    expect(floating.close).toHaveBeenCalledOnce();
  });
  it("validates trusted blank creation and finite nonnegative layout", () => {
    expect(parseSidePaneViewRequest("about:blank", SIDE_PANE_VIEW_PREFIX + key)).toBe(key);
    expect(parseSidePaneViewRequest("https://example.com", SIDE_PANE_VIEW_PREFIX + key)).toBeNull();
    for (const width of [-1, Infinity, NaN, "42"])
      expect(
        parseSidePaneViewCommand({
          key,
          action: "layout",
          layout: { x: 0, y: 0, width, height: 500, visible: true },
        }),
      ).toBeNull();
    expect(parseSidePaneViewCommand({ key, action: "unknown" })).toBeNull();
  });
  it("moves the same view, keeps original authorization, and disposes only on tab close", async () => {
    const owner = nativeWindow();
    const prepare = vi.fn();
    const registry = createSidePaneViewRegistry(owner as unknown as BrowserWindow, prepare);
    const response = registry.open(key);
    if (response.action !== "allow" || !response.createWindow) throw new Error("missing carrier");
    const guestHost = response.createWindow({});
    const view = owner.contentView.addChildView.mock.calls[0]![0];
    const command = owner.webContents.ipc.handle.mock.calls[0]![1];
    expect(prepare).toHaveBeenCalledWith(guestHost);
    expect(resolveSidePaneViewOwner(guestHost.id)).toBe(owner.webContents);
    expect(resolveSidePaneViewPresentation(owner.id + 99, guestHost.id)).toBeUndefined();
    await command({ sender: owner.webContents }, { key, action: "detach" });
    const floating = resolveSidePaneViewPresentation(owner.id, guestHost.id)!;
    expect(floating.window).not.toBe(owner);
    expect(
      (floating.window as unknown as ReturnType<typeof nativeWindow>).contentView.addChildView,
    ).toHaveBeenCalledWith(view);
    const preventDefault = vi.fn();
    floating.window.emit("close", { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(owner.webContents.send).toHaveBeenCalledWith(sidePaneWindowChannels.closeRequested, key);
    await command({ sender: owner.webContents }, { key, action: "dock" });
    expect(resolveSidePaneViewPresentation(owner.id, guestHost.id)?.window).toBe(owner);
    expect(owner.contentView.addChildView).toHaveBeenLastCalledWith(view);
    expect(guestHost.close).not.toHaveBeenCalled();
    await expect(command({ sender: contents() }, { key, action: "dispose" })).rejects.toThrow();
    await command({ sender: owner.webContents }, { key, action: "dispose" });
    expect(guestHost.close).toHaveBeenCalledOnce();
    expect(resolveSidePaneViewOwner(guestHost.id)).toBeUndefined();
  });
});
