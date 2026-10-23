import { afterAll, vi } from "vitest";

// 真 app 装配会播种用户级插件缓存；每个测试文件使用临时 home，防止读写真实 profile。
// 不改 HOME 环境变量，项目级 .zcode 路径和单测自己的 os mock 仍按原合同工作。
const isolatedHome = await vi.hoisted(async () => {
  const [{ mkdtemp }, { tmpdir }, { join }] = await Promise.all([
    import("node:fs/promises"),
    import("node:os"),
    import("node:path"),
  ]);
  return mkdtemp(join(tmpdir(), "zcode-bootstrap-home-"));
});
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: vi.fn(() => isolatedHome),
}));
afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(isolatedHome, { recursive: true, force: true });
});
