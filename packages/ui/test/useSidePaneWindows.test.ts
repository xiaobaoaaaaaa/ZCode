// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSidePaneWindows } from "../src/side-pane-windows/useSidePaneWindows.js";
import { createSidePaneWindowController } from "../src/side-pane-windows/controller.js";

it("projects placement changes for tab menus and admits only registered drag keys", async () => {
  const handle = { mount: vi.fn(), focus: vi.fn(), close: vi.fn(), setTitle: vi.fn() };
  const moveToDock = vi.fn();
  const controller = createSidePaneWindowController({
    open: async () => handle,
    moveToWindow: vi.fn(),
    moveToDock,
    onDocked: vi.fn(),
    onError: vi.fn(),
  });
  const { result, unmount } = renderHook(useSidePaneWindows);
  let unregister!: () => void;
  act(() => {
    unregister = result.current.register("tab", "original-window-key", controller);
  });
  await act(async () => {
    await result.current.detach("tab");
  });
  expect(result.current.getPhase("tab")).toBe("detached");
  expect(result.current.acceptDrop("another-window-key")).toBe(false);
  expect(moveToDock).not.toHaveBeenCalled();
  await act(async () => {
    expect(result.current.acceptDrop("original-window-key")).toBe(true);
  });
  expect(result.current.getPhase("tab")).toBe("docked");
  expect(handle.close).toHaveBeenCalledOnce();
  act(unregister);
  expect(result.current.acceptDrop("original-window-key")).toBe(false);
  unmount();
});
