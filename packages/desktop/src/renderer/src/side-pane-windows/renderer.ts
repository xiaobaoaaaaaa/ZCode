import { mirrorSidePaneDocument } from "./document.js";
import {
  SIDE_PANE_WINDOW_PREFIX,
  type IPlatformService,
  type SidePaneWindowHandle,
} from "@zcode/shared";

/** 同源空白辅助窗口只承载原 renderer 的 portal，不启动第二份应用或服务。 */
export function createSidePaneWindowPort(bridge: {
  onCloseRequested(handler: (key: string) => void): () => void;
  close(key: string): void;
}): NonNullable<IPlatformService["openSidePaneWindow"]> {
  return async ({ key, title, onCloseRequested }): Promise<SidePaneWindowHandle> => {
    const child = window.open("about:blank", `${SIDE_PANE_WINDOW_PREFIX}${key}`);
    if (!child) throw new Error("Unable to open side pane window");
    const stopMirror = mirrorSidePaneDocument(child, title);
    const document = child.document;
    const unsubscribe = bridge.onCloseRequested((requestedKey) => {
      if (requestedKey === key) onCloseRequested();
    });
    let closed = false;
    return {
      mount(content) {
        if (!(content instanceof HTMLElement)) throw new TypeError("Expected side pane DOM host");
        document.body.append(content);
      },
      focus: () => child.focus(),
      setTitle: (value) => {
        if (!child.closed) document.title = value;
      },
      close() {
        if (closed) return;
        closed = true;
        unsubscribe();
        stopMirror();
        bridge.close(key);
      },
    };
  };
}
