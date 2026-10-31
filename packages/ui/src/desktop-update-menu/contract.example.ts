import {
  getUpdateMenuLabelId,
  getUpdateMenuLabelValues,
  shouldShowDesktopUpdateEntry,
} from "./contract.js";

export function exampleDesktopUpdateMenu() {
  const state = { kind: "update-available", enabled: true, version: "3.17.1-personal.4" } as const;
  return {
    visible: shouldShowDesktopUpdateEntry("personal"),
    messageId: getUpdateMenuLabelId(state),
    values: getUpdateMenuLabelValues(state),
  };
}
