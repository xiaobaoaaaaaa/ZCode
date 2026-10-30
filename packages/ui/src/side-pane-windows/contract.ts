import type { SidePaneWindowHandle } from "@zcode/shared";

export const SIDE_PANE_WINDOW_DRAG_TYPE = "application/x-zcode-side-pane-window";
export const SIDE_PANE_WINDOW_MOVED_EVENT = "zcode-side-pane-window-moved";
export type SidePaneWindowPhase = "docked" | "opening" | "detached" | "docking";
export interface SidePaneWindowActions {
  detach(): Promise<void>;
  dock(): Promise<void>;
  focus(): void;
  getSnapshot(): SidePaneWindowPhase;
  subscribe(listener: () => void): () => void;
}
export interface SidePaneWindowPorts {
  open(onCloseRequested: () => void): Promise<SidePaneWindowHandle>;
  moveToWindow(handle: SidePaneWindowHandle): void | Promise<void>;
  moveToDock(): void | Promise<void>;
  prepareMove?(): Promise<boolean>;
  onDocked(): void;
  onError(error: unknown): void;
}

/** 客户区外松开才移出；侧栏内的普通排序不会误触发。 */
export function isSidePaneWindowDragOutside(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
): boolean {
  return point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height;
}
