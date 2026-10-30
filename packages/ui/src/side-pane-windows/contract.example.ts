import { isSidePaneWindowDragOutside } from "./contract.js";
export const detachesBeyondRightEdge = isSidePaneWindowDragOutside(
  { x: 1201, y: 100 },
  { width: 1200, height: 800 },
);
