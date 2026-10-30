import {
  SIDE_PANE_VIEW_PREFIX,
  type IPlatformService,
  type SidePaneViewCommand,
} from "@zcode/shared";
import { mirrorSidePaneDocument } from "./document.js";

export function createSidePaneViewPort(bridge: {
  command(command: SidePaneViewCommand): Promise<unknown>;
  onCloseRequested(handler: (key: string) => void): () => void;
}): NonNullable<IPlatformService["createSidePaneView"]> {
  return async ({ key, title, onCloseRequested }) => {
    const child = window.open("about:blank", `${SIDE_PANE_VIEW_PREFIX}${key}`);
    if (!child) throw new Error("Unable to create browser carrier");
    const stopMirror = mirrorSidePaneDocument(child, title, true);
    const container = child.document.createElement("div");
    container.className = "h-full min-h-0 w-full";
    container.setAttribute("data-side-pane-view-host", key);
    child.document.body.append(container);
    const unsubscribe = bridge.onCloseRequested((requestedKey) => {
      if (requestedKey === key) onCloseRequested();
    });
    let disposed = false;
    const send = (command: SidePaneViewCommand) => {
      if (!disposed)
        void bridge.command(command).catch(() => {
          if (!disposed) onCloseRequested();
        });
    };
    send({ key, action: "title", title });
    return {
      container,
      setLayout: (layout) => send({ key, action: "layout", layout }),
      detach: async () => {
        await bridge.command({ key, action: "detach" });
      },
      dock: async () => {
        await bridge.command({ key, action: "dock" });
      },
      focus: () => send({ key, action: "focus" }),
      setTitle: (value) => {
        child.document.title = value;
        send({ key, action: "title", title: value });
      },
      capture: async () => {
        const result = await bridge.command({ key, action: "capture" });
        return typeof result === "string" ? result : undefined;
      },
      setOccluded: (occluded) => send({ key, action: "occlude", occluded }),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        stopMirror();
        void bridge.command({ key, action: "dispose" }).catch(() => {
          /* 原窗口销毁后 IPC 已不可用。 */
        });
      },
    };
  };
}
