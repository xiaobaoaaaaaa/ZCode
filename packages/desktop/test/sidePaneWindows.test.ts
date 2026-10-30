import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { attachSidePaneWindows } from "../src/side-pane-windows/index.js";
import {
  SIDE_PANE_WINDOW_PREFIX,
  sidePaneWindowChannels,
} from "../src/side-pane-windows/contract.js";

const key = "019a24da-24b0-7817-97ca-333fe8f00df4";
const request = { url: "about:blank", frameName: SIDE_PANE_WINDOW_PREFIX + key };
function windowMock() {
  const webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(),
    isDestroyed: () => false,
    send: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
    setMenu: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
  });
  return window;
}
describe("native side pane windows", () => {
  it("requires an owner ACK before close and rejects another window key", () => {
    const owner = windowMock();
    const child = windowMock();
    attachSidePaneWindows(owner as unknown as BrowserWindow);
    owner.webContents.emit("did-create-window", child, request);
    const preventDefault = vi.fn();
    child.emit("close", { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(owner.webContents.send).toHaveBeenCalledWith(sidePaneWindowChannels.closeRequested, key);
    owner.webContents.emit("ipc-message", {}, sidePaneWindowChannels.close, "other");
    expect(child.close).not.toHaveBeenCalled();
    owner.webContents.emit("ipc-message", {}, sidePaneWindowChannels.close, key);
    expect(child.close).toHaveBeenCalledOnce();
    preventDefault.mockClear();
    child.emit("close", { preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });
  it("focuses an existing window and disposes children when the owner closes", () => {
    const owner = windowMock();
    const child = windowMock();
    attachSidePaneWindows(owner as unknown as BrowserWindow);
    const handler = owner.webContents.setWindowOpenHandler.mock.calls[0]![0];
    expect(handler(request).action).toBe("allow");
    expect(handler({ ...request, url: "https://example.com" }).action).toBe("deny");
    owner.webContents.emit("did-create-window", child, request);
    expect(handler(request).action).toBe("deny");
    expect(child.focus).toHaveBeenCalledOnce();
    owner.emit("hide");
    expect(owner.webContents.send).toHaveBeenCalledWith(sidePaneWindowChannels.closeRequested, key);
    owner.emit("closed");
    expect(child.destroy).toHaveBeenCalledOnce();
  });
});
