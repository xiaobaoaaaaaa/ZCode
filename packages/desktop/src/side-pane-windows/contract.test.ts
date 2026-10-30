import { describe, expect, it } from "vitest";
import {
  parseSidePaneWindowKey,
  parseSidePaneWindowRequest,
  SIDE_PANE_WINDOW_PREFIX,
} from "./contract.js";

const key = "019a24da-24b0-7817-97ca-333fe8f00df4";
describe("side pane window admission", () => {
  it("accepts only a blank surface with a valid opaque key", () => {
    expect(parseSidePaneWindowRequest("about:blank", `${SIDE_PANE_WINDOW_PREFIX}${key}`)).toBe(key);
    for (const url of [
      "https://example.com",
      "file:///tmp/index.html",
      "about:blank#x",
      "javascript:alert(1)",
    ]) {
      expect(parseSidePaneWindowRequest(url, `${SIDE_PANE_WINDOW_PREFIX}${key}`)).toBeNull();
    }
    expect(parseSidePaneWindowRequest("about:blank", key)).toBeNull();
    for (const value of [null, {}, "", "../workspace", `${key}:other`]) {
      expect(parseSidePaneWindowKey(value)).toBeNull();
    }
  });
});
