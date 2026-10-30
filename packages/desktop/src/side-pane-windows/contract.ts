import {
  SIDE_PANE_WINDOW_PREFIX,
  SIDE_PANE_VIEW_PREFIX,
  type SidePaneViewCommand,
} from "@zcode/shared";
export { SIDE_PANE_WINDOW_PREFIX, SIDE_PANE_VIEW_PREFIX };
export const sidePaneWindowChannels = {
  closeRequested: "side-pane-window:close-requested",
  close: "side-pane-window:close",
  viewCommand: "side-pane-window:view-command",
} as const;

/** 只接受 renderer 生成的 UUID，不允许 URL/路径或任意 popup 复用窗口权限。 */
export function parseSidePaneWindowKey(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function parseSidePaneViewRequest(url: string, frameName: string): string | null {
  if (url !== "about:blank" || !frameName.startsWith(SIDE_PANE_VIEW_PREFIX)) return null;
  return parseSidePaneWindowKey(frameName.slice(SIDE_PANE_VIEW_PREFIX.length));
}

export function parseSidePaneViewCommand(value: unknown): SidePaneViewCommand | null {
  if (!value || typeof value !== "object") return null;
  const command = value as Record<string, unknown>;
  const key = parseSidePaneWindowKey(command.key);
  if (!key) return null;
  switch (command.action) {
    case "detach":
    case "dock":
    case "focus":
    case "capture":
    case "dispose":
      return { key, action: command.action };
    case "title":
      return typeof command.title === "string" && command.title.length <= 4096
        ? { key, action: "title", title: command.title }
        : null;
    case "occlude":
      return typeof command.occluded === "boolean"
        ? { key, action: "occlude", occluded: command.occluded }
        : null;
    case "layout": {
      if (!command.layout || typeof command.layout !== "object") return null;
      const layout = command.layout as Record<string, unknown>;
      for (const field of ["x", "y", "width", "height"]) {
        const number = layout[field];
        if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 100_000)
          return null;
      }
      if (
        (layout.width as number) < 0 ||
        (layout.height as number) < 0 ||
        typeof layout.visible !== "boolean"
      )
        return null;
      return {
        key,
        action: "layout",
        layout: {
          x: layout.x as number,
          y: layout.y as number,
          width: layout.width as number,
          height: layout.height as number,
          visible: layout.visible,
        },
      };
    }
    default:
      return null;
  }
}

export function parseSidePaneWindowRequest(url: string, frameName: string): string | null {
  if (url !== "about:blank" || !frameName.startsWith(SIDE_PANE_WINDOW_PREFIX)) return null;
  return parseSidePaneWindowKey(frameName.slice(SIDE_PANE_WINDOW_PREFIX.length));
}
