import { parseSidePaneWindowRequest, SIDE_PANE_WINDOW_PREFIX } from "./contract.js";
export const acceptedSidePaneWindow = parseSidePaneWindowRequest(
  "about:blank",
  `${SIDE_PANE_WINDOW_PREFIX}019a24da-24b0-7817-97ca-333fe8f00df4`,
);
