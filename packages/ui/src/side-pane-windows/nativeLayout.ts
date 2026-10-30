const OVERLAYS = [
  "dialog-overlay",
  "alert-dialog-overlay",
  "context-menu-content",
  "context-menu-sub-content",
  "dropdown-menu-content",
  "dropdown-menu-sub-content",
  "popover-content",
  "select-content",
  "tooltip-content",
]
  .map((slot) => `[data-slot="${slot}"]`)
  .join(",");
const subscribers = new Set<(overlays: DOMRect[]) => void>();
let cleanup: (() => void) | undefined;

/** 所有原生标签共享一次布局观察；没有持续轮询，也不为每个后台标签扫描整棵应用树。 */
export function observeNativePaneEnvironment(listener: (overlays: DOMRect[]) => void): () => void {
  subscribers.add(listener);
  if (!cleanup) {
    let frame = 0;
    const update = () => {
      frame = 0;
      const overlays = [...document.querySelectorAll(OVERLAYS)]
        .filter((element) => element.getAttribute("data-state") !== "closed")
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      for (const subscriber of subscribers) subscriber(overlays);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "data-state", "aria-hidden"],
    });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    schedule();
    cleanup = () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }
  listener([]);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) {
      cleanup?.();
      cleanup = undefined;
    }
  };
}
