import { describe, expect, it, vi } from "vitest";
import { createSidePaneWindowController } from "../src/side-pane-windows/controller.js";
import type { SidePaneWindowHandle } from "@zcode/shared";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function setup() {
  const pending = deferred<SidePaneWindowHandle>();
  const handle = { mount: vi.fn(), focus: vi.fn(), close: vi.fn(), setTitle: vi.fn() };
  const ports = {
    open: vi.fn(() => pending.promise),
    moveToWindow: vi.fn(),
    moveToDock: vi.fn(),
    onDocked: vi.fn(),
    onError: vi.fn(),
  };
  const controller = createSidePaneWindowController(ports);
  return { pending, handle, ports, controller };
}
describe("side pane placement transactions", () => {
  it("settles failed asynchronous docking during disposal and closes the handle", async () => {
    const { handle, ports } = setup();
    const failure = new Error("owner destroyed");
    const controller = createSidePaneWindowController({
      ...ports,
      open: async () => handle,
      moveToDock: () => Promise.reject(failure),
    });
    await controller.detach();
    controller.dispose();
    await Promise.resolve();
    expect(handle.close).toHaveBeenCalledOnce();
    expect(ports.onError).toHaveBeenCalledWith(failure);
    expect(controller.getSnapshot()).toBe("docked");
  });
  it("waits for native move acknowledgement before publishing placement", async () => {
    const { handle, ports } = setup();
    const detached = deferred<void>();
    const docked = deferred<void>();
    const controller = createSidePaneWindowController({
      ...ports,
      open: async () => handle,
      moveToWindow: () => detached.promise,
      moveToDock: () => docked.promise,
    });
    const opening = controller.detach();
    await Promise.resolve();
    expect(controller.getSnapshot()).toBe("opening");
    detached.resolve();
    await opening;
    expect(controller.getSnapshot()).toBe("detached");
    const docking = controller.dock();
    await Promise.resolve();
    expect(controller.getSnapshot()).toBe("docking");
    expect(handle.close).not.toHaveBeenCalled();
    docked.resolve();
    await docking;
    expect(controller.getSnapshot()).toBe("docked");
    expect(handle.close).toHaveBeenCalledOnce();
  });
  it("remains usable after StrictMode reconnect without accepting a stale open", async () => {
    const { pending, handle, ports, controller } = setup();
    const oldOpening = controller.detach();
    controller.dispose();
    controller.connect();
    const current = { ...handle, close: vi.fn() };
    ports.open.mockResolvedValueOnce(current);
    await controller.detach();
    pending.resolve(handle);
    await oldOpening;
    expect(handle.close).toHaveBeenCalledOnce();
    expect(current.close).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe("detached");
    expect(ports.moveToWindow).toHaveBeenCalledExactlyOnceWith(current);
  });
  it("coalesces repeated opens and focuses an existing window", async () => {
    const { pending, handle, ports, controller } = setup();
    const opening = controller.detach();
    void controller.detach();
    pending.resolve(handle);
    await opening;
    await controller.detach();
    expect(ports.open).toHaveBeenCalledTimes(1);
    expect(ports.moveToWindow).toHaveBeenCalledTimes(1);
    expect(handle.focus).toHaveBeenCalled();
    await controller.dock();
    expect(ports.moveToDock).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toBe("docked");
  });
  it("closes a late window if docking or unmount wins during creation", async () => {
    for (const dispose of [false, true]) {
      const { pending, handle, ports, controller } = setup();
      const opening = controller.detach();
      if (dispose) controller.dispose();
      else void controller.dock();
      pending.resolve(handle);
      await opening;
      expect(ports.moveToWindow).not.toHaveBeenCalled();
      expect(handle.close).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot()).toBe("docked");
    }
  });
  it("keeps the docked content usable after open failure and allows retry", async () => {
    const { ports, controller, handle } = setup();
    ports.open.mockRejectedValueOnce(new Error("window blocked"));
    await controller.detach();
    expect(controller.getSnapshot()).toBe("docked");
    expect(ports.onError).toHaveBeenCalledTimes(1);
    ports.open.mockResolvedValueOnce(handle);
    await controller.detach();
    expect(controller.getSnapshot()).toBe("detached");
  });
  it("does not move or close a surface if its preparation rejects", async () => {
    const { ports, handle, pending } = setup();
    const prepareMove = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const controller = createSidePaneWindowController({ ...ports, prepareMove });
    const opening = controller.detach();
    pending.resolve(handle);
    await opening;
    await controller.dock();
    expect(controller.getSnapshot()).toBe("detached");
    expect(ports.moveToDock).not.toHaveBeenCalled();
    expect(handle.close).not.toHaveBeenCalled();
  });
});
