import { describe, expect, it } from "vitest";
import { globalProfileRuntimeModule } from "./module.js";
describe("global profile runtime contract", () => {
  it("declares its owner", () =>
    expect(globalProfileRuntimeModule.id).toBe("global-profile-runtime"));
});
