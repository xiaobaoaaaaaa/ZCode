import { describe, expect, it } from "vitest";

import { globalMemoryStorageModule } from "./module.js";

// 契约测试只 import contract 与 module，不知道实现是谁；同一份测试应同时跑真实现与跨进程代理。
describe("global-memory-storage contract", () => {
  it("declares its module manifest", () => {
    expect(globalMemoryStorageModule.id).toBe("global-memory-storage");
  });
});
