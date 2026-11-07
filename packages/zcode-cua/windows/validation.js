export class AutomationError extends Error {
  constructor(code, message, actionSent = false) {
    super(message);
    this.code = code;
    this.actionSent = actionSent;
  }
}
export const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fields = {
  list_apps: [],
  list_windows: ["app_ref"],
  get_app_state: ["app_ref", "include_screenshot", "disable_diffing", "tree_shown_to_model"],
  left_click: [
    "target",
    "app_ref",
    "mouse_button",
    "click_count",
    "modifiers",
    "strategy",
    "return_state",
  ],
  left_click_drag: ["from_target", "to", "app_ref", "modifiers", "strategy", "return_state"],
  scroll: ["target", "app_ref", "scroll_direction", "scroll_amount", "strategy", "return_state"],
  type: ["text", "target", "app_ref", "strategy", "return_state"],
  set_value: ["target", "value", "app_ref", "strategy", "return_state"],
  select_text: ["target", "text_range", "app_ref", "return_state"],
  key: ["text", "repeat", "hold_seconds", "app_ref", "strategy", "return_state"],
  paste: ["text", "format", "app_ref", "return_state"],
  perform_action: ["target", "action", "app_ref", "return_state"],
  request_access: ["capabilities"],
  stop_computer_control: ["reason"],
};
export const mutations = new Set([
  "left_click",
  "left_click_drag",
  "scroll",
  "type",
  "set_value",
  "select_text",
  "key",
  "paste",
  "perform_action",
]);
function requireValue(ok, message) {
  if (!ok) throw new AutomationError("invalid_request", message);
}
function exact(record, keys) {
  requireValue(isRecord(record), "Expected an arguments object");
  requireValue(
    Object.keys(record).every((k) => keys.includes(k)),
    "Unknown argument",
  );
}
function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function target(value) {
  requireValue(isRecord(value), "A target is required");
  if (value.type === "element") {
    exact(value, ["type", "index"]);
    requireValue(integer(value.index, 0, 999), "Invalid element index");
  } else {
    exact(value, ["type", "x", "y", "frame_id"]);
    requireValue(
      value.type === "coordinate" && integer(value.x, 0, 32767) && integer(value.y, 0, 32767),
      "Invalid raster coordinates",
    );
    if (value.frame_id !== undefined)
      requireValue(
        typeof value.frame_id === "string" && value.frame_id.length <= 100,
        "Invalid frame id",
      );
  }
}
export function validateCall(method, value) {
  requireValue(Object.hasOwn(fields, method), "Unsupported Computer Use method");
  const args = value ?? {};
  exact(args, fields[method]);
  if (!["list_apps", "request_access", "stop_computer_control"].includes(method)) {
    exact(args.app_ref, ["pid", "name", "bundle_id", "window_id"]);
    const ref = args.app_ref;
    requireValue(
      integer(ref.pid, 1, 2147483647) || (typeof ref.name === "string" && ref.name.length > 0),
      "Use an observed process id or exact running app name",
    );
    if (ref.pid !== undefined) requireValue(integer(ref.pid, 1, 2147483647), "Invalid process id");
    if (ref.window_id !== undefined)
      requireValue(integer(ref.window_id, 1, Number.MAX_SAFE_INTEGER), "Invalid window id");
    for (const key of ["name", "bundle_id"])
      if (ref[key] !== undefined && ref[key] !== null)
        requireValue(typeof ref[key] === "string" && ref[key].length <= 512, "Invalid app name");
  }
  for (const key of ["target", "from_target", "to"]) if (args[key] !== undefined) target(args[key]);
  if (["left_click", "scroll", "set_value", "select_text", "perform_action"].includes(method))
    target(args.target);
  if (method === "left_click_drag") {
    target(args.from_target);
    target(args.to);
  }
  if (["type", "key", "paste"].includes(method))
    requireValue(
      typeof args.text === "string" && args.text.length <= 8192,
      "Text must be a string of at most 8192 characters",
    );
  if (method === "set_value")
    requireValue(typeof args.value === "string" && args.value.length <= 8192, "Invalid value");
  for (const key of ["include_screenshot", "disable_diffing", "tree_shown_to_model"])
    if (args[key] !== undefined) requireValue(typeof args[key] === "boolean", `Invalid ${key}`);
  for (const [key, values] of Object.entries({
    strategy: ["auto", "a11y", "event"],
    mouse_button: ["left", "right", "middle"],
    scroll_direction: ["up", "down", "left", "right"],
    return_state: ["none", "full", "compact"],
    format: ["text"],
  })) {
    if (args[key] !== undefined) requireValue(values.includes(args[key]), `Unsupported ${key}`);
  }
  for (const [key, max] of [
    ["click_count", 3],
    ["repeat", 20],
    ["scroll_amount", 10],
  ])
    if (args[key] !== undefined) requireValue(integer(args[key], 1, max), `Invalid ${key}`);
  if (method === "scroll")
    requireValue(
      ["up", "down", "left", "right"].includes(args.scroll_direction),
      "Invalid direction",
    );
  if (args.hold_seconds !== undefined)
    requireValue(
      Number.isFinite(args.hold_seconds) && args.hold_seconds >= 0 && args.hold_seconds <= 2,
      "Hold must be between 0 and 2 seconds",
    );
  for (const key of ["reason", "modifiers", "action"])
    if (args[key] !== undefined)
      requireValue(typeof args[key] === "string" && args[key].length <= 256, `Invalid ${key}`);
  if (method === "perform_action")
    requireValue(typeof args.action === "string" && args.action.length > 0, "Action required");
  if (method === "select_text")
    requireValue(
      Array.isArray(args.text_range) &&
        args.text_range.length === 2 &&
        args.text_range.every((n) => integer(n, 0, 8192)),
      "Expected [start, length]",
    );
  if (args.capabilities !== undefined)
    requireValue(
      Array.isArray(args.capabilities) &&
        args.capabilities.every((v) => ["accessibility", "screen_recording"].includes(v)),
      "Unsupported capability",
    );
  return args;
}
export function ownerKey(clientId, context) {
  requireValue(
    isRecord(context) && context.runtimeScope === "main",
    "Computer Use requires a main session",
  );
  const workspace =
    context.workspaceIdentity?.trim() || context.workspacePath || context.workspaceKey;
  requireValue(
    typeof context.sessionId === "string" &&
      context.sessionId.length > 0 &&
      typeof workspace === "string" &&
      workspace.length > 0,
    "Missing session/workspace identity",
  );
  requireValue(typeof clientId === "string" && clientId.length <= 100, "Invalid runtime identity");
  return JSON.stringify([clientId, context.sessionId, workspace, context.remoteSessionId ?? null]);
}
export function errorResult(error, actionSent = false) {
  const receipt = {
    code: error.code ?? "internal",
    message: error.message ?? "Computer Use failed",
    action_sent: error.actionSent ?? actionSent,
    dispatch_status: (error.actionSent ?? actionSent) ? "possibly_sent" : "not_sent",
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(receipt) }],
    structuredContent: receipt,
  };
}
export function resultEnvelope(raw) {
  if (raw.error)
    return errorResult(
      Object.assign(new Error(raw.error.message), {
        code: raw.error.code,
        actionSent: raw.error.action_sent === true,
      }),
    );
  const { image, ...structuredContent } = raw;
  const content = [];
  const metadata = raw.app
    ? {
        "zcode.cua/app-associations-v1": {
          primary: { appKey: `pid:${raw.app.pid}`, displayName: raw.app.name },
        },
      }
    : {};
  if (image) {
    const block = { type: "image", mimeType: "image/png", data: image };
    const raster = rasterIdentity(block);
    if (!raster || raster.width !== raw.width || raster.height !== raw.height)
      return errorResult(new AutomationError("internal", "Invalid native screenshot"));
    metadata[integrityKey] = {
      version: 1,
      frame_id: raw.frame_id,
      width: raster.width,
      height: raster.height,
      media_type: "image/png",
      sha256: raster.sha256,
    };
    content.push(block);
    content.push({
      type: "text",
      text: JSON.stringify({
        image_ref: {
          frame_id: raw.frame_id,
          width: raw.width,
          height: raw.height,
          sha256: raster.sha256,
          actionable: true,
        },
      }),
    });
  }
  content.push({ type: "text", text: raw.text ?? JSON.stringify(structuredContent) });
  return {
    content,
    structuredContent,
    ...(Object.keys(metadata).length ? { _meta: metadata } : {}),
  };
}
import { rasterIdentity, integrityKey } from "./frame.js";
