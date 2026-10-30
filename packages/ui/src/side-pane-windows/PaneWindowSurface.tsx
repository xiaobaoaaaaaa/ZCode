import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeftIcon, ExternalLinkIcon, GripVerticalIcon } from "lucide-react";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { logger } from "@/logger.js";
import { createSidePaneWindowController } from "./controller.js";
import { WindowPortalContext } from "./portal.js";
import {
  SIDE_PANE_WINDOW_DRAG_TYPE,
  SIDE_PANE_WINDOW_MOVED_EVENT,
  type SidePaneWindowActions,
} from "./contract.js";

export function SidePaneWindowSurface({
  tabId,
  title,
  visible,
  register,
  children,
  onDocked,
}: {
  tabId: string;
  title: string;
  visible: boolean;
  register: (id: string, key: string, actions: SidePaneWindowActions) => () => void;
  onDocked: () => void;
  children: (detached: boolean) => ReactNode;
}) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "h-full min-h-0 w-full";
    element.setAttribute("data-side-pane-window-host", "");
    return element;
  });
  const [key] = useState(() => crypto.randomUUID());
  const dock = useRef<HTMLDivElement>(null);
  const current = useRef({ title, platform, onDocked });
  current.current = { title, platform, onDocked };
  const [error, setError] = useState(false);
  const moved = () => host.dispatchEvent(new CustomEvent(SIDE_PANE_WINDOW_MOVED_EVENT));
  const [controller] = useState(() =>
    createSidePaneWindowController({
      open: async (onCloseRequested) => {
        setError(false);
        const open = current.current.platform.openSidePaneWindow;
        if (!open) throw new Error("Side pane windows are unavailable");
        return open({ key, title: current.current.title, onCloseRequested });
      },
      moveToWindow: (window) => {
        window.mount(host);
        moved();
      },
      moveToDock: () => {
        dock.current?.append(host);
        moved();
      },
      onDocked: () => current.current.onDocked(),
      onError: (cause) => {
        setError(true);
        logger.warn("[side-pane-window] move failed", cause);
      },
    }),
  );
  const phase = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const detached = phase === "detached" || phase === "docking";
  useLayoutEffect(() => {
    controller.connect();
    dock.current?.append(host);
    const unregister = register(tabId, key, controller);
    return () => {
      unregister();
      controller.dispose();
      host.remove();
    };
  }, [controller, host, key, register, tabId]);
  useLayoutEffect(() => controller.setTitle(title), [controller, title]);
  return (
    <div className={visible ? "h-full min-h-0" : "hidden"} data-side-pane-window-state={phase}>
      <div ref={dock} className={detached ? "hidden" : "h-full min-h-0"} />
      {detached ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-ui-base">
          <span>{intl.formatMessage({ id: "sidePane.window.opened" })}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={controller.focus}>
              <ExternalLinkIcon />
              {intl.formatMessage({ id: "sidePane.window.focus" })}
            </Button>
            <Button variant="outline" onClick={() => void controller.dock()}>
              {intl.formatMessage({ id: "sidePane.window.dock" })}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="text-ui-sm text-destructive">
          {intl.formatMessage({ id: "sidePane.window.failed" })}
        </div>
      ) : null}
      {createPortal(
        <WindowPortalContext.Provider value={detached ? host.ownerDocument.body : undefined}>
          <div
            className="flex h-full min-h-0 flex-col bg-background text-foreground"
            data-detached-side-pane={detached ? tabId : undefined}
          >
            {detached ? (
              <header className="flex shrink-0 items-center gap-2 border-b border-border bg-header px-3 py-2 text-ui-base">
                <div
                  draggable
                  className="flex min-w-0 flex-1 cursor-grab items-center gap-2"
                  data-side-pane-window-drag={tabId}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(SIDE_PANE_WINDOW_DRAG_TYPE, key);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <GripVerticalIcon className="size-4 shrink-0 text-foreground-subtle" />
                  <span className="truncate">{title}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void controller.dock()}>
                  <ArrowDownLeftIcon className="size-4" />
                  {intl.formatMessage({ id: "sidePane.window.dock" })}
                </Button>
              </header>
            ) : null}
            <div className="min-h-0 flex-1">{children(detached)}</div>
          </div>
        </WindowPortalContext.Provider>,
        host,
      )}
    </div>
  );
}
