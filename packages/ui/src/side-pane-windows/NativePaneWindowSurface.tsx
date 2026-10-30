import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BrowserViewScreenshotSurfacePreparePayload, SidePaneViewHandle } from "@zcode/shared";
import { ArrowDownLeftIcon, ExternalLinkIcon, GripVerticalIcon } from "lucide-react";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { logger } from "@/logger.js";
import { createSidePaneWindowController } from "./controller.js";
import { WindowPortalContext } from "./portal.js";
import { SIDE_PANE_WINDOW_DRAG_TYPE, type SidePaneWindowActions } from "./contract.js";
import { observeNativePaneEnvironment } from "./nativeLayout.js";

export function NativeSidePaneWindowSurface({
  tabId,
  title,
  visible,
  register,
  children,
  onDocked,
  screenshotRequest,
}: {
  tabId: string;
  title: string;
  visible: boolean;
  register: (id: string, key: string, actions: SidePaneWindowActions) => () => void;
  onDocked: () => void;
  children: (detached: boolean) => ReactNode;
  screenshotRequest?: BrowserViewScreenshotSurfacePreparePayload | null;
}) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const dock = useRef<HTMLDivElement>(null);
  const current = useRef({ title, onDocked });
  current.current = { title, onDocked };
  const [carrier, setCarrier] = useState<{
    key: string;
    handle: SidePaneViewHandle;
    host: HTMLElement;
  }>();
  const carrierRef = useRef(carrier);
  carrierRef.current = carrier;
  const [error, setError] = useState(false);
  const [snapshot, setSnapshot] = useState<string>();
  const [controller] = useState(() =>
    createSidePaneWindowController({
      open: async () => {
        setError(false);
        const handle = carrierRef.current?.handle;
        if (!handle) throw new Error("Browser carrier unavailable");
        return {
          mount() {},
          focus: () => handle.focus(),
          setTitle: (value) => handle.setTitle(value),
          close() {},
        };
      },
      moveToWindow: async () => {
        await carrierRef.current?.handle.detach();
      },
      moveToDock: async () => {
        await carrierRef.current?.handle.dock();
      },
      onDocked: () => current.current.onDocked(),
      onError: (cause) => {
        setError(true);
        logger.warn("[side-pane-view] move failed", cause);
      },
    }),
  );
  const phase = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const detached = phase === "detached" || phase === "docking";
  useLayoutEffect(() => {
    const create = platform.createSidePaneView;
    if (!create) return;
    controller.connect();
    const key = crypto.randomUUID();
    let canceled = false;
    let handle: SidePaneViewHandle | undefined;
    let unregister: (() => void) | undefined;
    void create({
      key,
      title: current.current.title,
      onCloseRequested: () => {
        void controller.dock();
      },
    })
      .then((created) => {
        if (canceled) {
          created.dispose();
          return;
        }
        handle = created;
        const host = created.container as HTMLElement;
        if (!host?.ownerDocument) throw new Error("Missing browser carrier document");
        setCarrier({ key, handle, host });
        unregister = register(tabId, key, controller);
      })
      .catch((cause: unknown) => {
        if (!canceled) {
          setError(true);
          logger.warn("[side-pane-view] creation failed", cause);
        }
      });
    return () => {
      canceled = true;
      unregister?.();
      controller.dispose();
      handle?.dispose();
    };
  }, [platform.createSidePaneView, controller, register, tabId]);
  useLayoutEffect(() => {
    carrier?.handle.setTitle(title);
  }, [carrier, title]);

  useLayoutEffect(() => {
    if (!carrier || !dock.current) return;
    const { handle } = carrier;
    const element = dock.current;
    let lastLayout = "";
    let occluded = false;
    let generation = 0;
    let previousOverlays: DOMRect[] = [];
    const measure = (overlays = previousOverlays) => {
      previousOverlays = overlays;
      const rect = element.getBoundingClientRect();
      const preparing = Boolean(screenshotRequest);
      const layout =
        preparing && screenshotRequest
          ? {
              x: 0,
              y: 0,
              width: Math.min(screenshotRequest.viewport.width, window.innerWidth),
              height: Math.min(screenshotRequest.viewport.height + 48, window.innerHeight),
              visible: true,
            }
          : {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              visible: visible && rect.width > 0 && rect.height > 0,
            };
      const serialized = JSON.stringify(layout);
      if (serialized !== lastLayout) {
        lastLayout = serialized;
        handle.setLayout(layout);
      }
      const nextOccluded =
        !detached &&
        !preparing &&
        layout.visible &&
        overlays.some(
          (overlay) =>
            overlay.left < rect.right &&
            overlay.right > rect.left &&
            overlay.top < rect.bottom &&
            overlay.bottom > rect.top,
        );
      if (nextOccluded === occluded) return;
      occluded = nextOccluded;
      const epoch = ++generation;
      if (occluded) {
        // 原生视图会盖住原窗口的 DOM 菜单；用当前帧占位并隐藏视图，不能重挂 webview。
        void handle
          .capture()
          .then((frame) => {
            if (epoch !== generation) return;
            setSnapshot(frame);
            handle.setOccluded(true);
          })
          .catch(() => {
            if (epoch === generation) handle.setOccluded(true);
          });
      } else {
        handle.setOccluded(false);
        setSnapshot(undefined);
      }
    };
    const stop = observeNativePaneEnvironment(measure);
    const resize = new ResizeObserver(() => measure());
    resize.observe(element);
    return () => {
      ++generation;
      stop();
      resize.disconnect();
      handle.setOccluded(false);
    };
  }, [carrier, detached, screenshotRequest, visible]);

  return (
    <div
      ref={dock}
      className={visible ? "relative h-full min-h-0" : "hidden"}
      data-side-pane-window-state={phase}
      data-native-side-pane={tabId}
    >
      {snapshot && !detached ? (
        <img src={snapshot} alt="" className="pointer-events-none absolute inset-0 size-full" />
      ) : null}
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
      {carrier
        ? createPortal(
            <WindowPortalContext.Provider value={carrier.host.ownerDocument.body}>
              <div
                className="flex h-full min-h-0 flex-col text-foreground"
                style={{ background: screenshotRequest ? "transparent" : "var(--background)" }}
                data-detached-side-pane={detached ? tabId : undefined}
              >
                {detached && !screenshotRequest ? (
                  <header className="flex shrink-0 items-center gap-2 border-b border-border bg-header px-3 py-2 text-ui-base">
                    <div
                      draggable
                      className="flex min-w-0 flex-1 cursor-grab items-center gap-2"
                      data-side-pane-window-drag={tabId}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(SIDE_PANE_WINDOW_DRAG_TYPE, carrier.key);
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
            carrier.host,
          )
        : null}
    </div>
  );
}
