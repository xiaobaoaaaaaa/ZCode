import { describe, expect, it } from "vitest";
import { isSidePaneWindowDragOutside } from "./contract.js";

describe("side pane window drag boundary", () => {
  it("does not detach while sorting or releasing on a window edge", () => {
    for (const point of [
      { x: 20, y: 10 },
      { x: 900, y: 700 },
      { x: 0, y: 0 },
    ]) {
      expect(isSidePaneWindowDragOutside(point, { width: 900, height: 700 })).toBe(false);
    }
    for (const point of [
      { x: -1, y: 10 },
      { x: 901, y: 10 },
      { x: 50, y: -1 },
      { x: 50, y: 701 },
    ]) {
      expect(isSidePaneWindowDragOutside(point, { width: 900, height: 700 })).toBe(true);
    }
  });
});
