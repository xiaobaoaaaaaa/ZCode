import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const desktopManifest = new URL("../../packages/desktop/package.json", import.meta.url);
const requireDesktop = createRequire(desktopManifest);
const { AppUpdater } = requireDesktop("electron-updater/out/AppUpdater.js");

test("desktop dev manifest allows electron-updater to initialize before app startup", async () => {
  const manifest = JSON.parse(await readFile(desktopManifest, "utf8"));
  // 修复依据：Linux Electron 对缺失版本的开发壳返回 0.0，更新器在禁用更新前已校验版本。
  // 使用真实更新器的构造函数验证 manifest；注入 app adapter，避免测试依赖 GUI 或发起网络请求。
  const app = { version: manifest.version ?? "0.0" };
  assert.doesNotThrow(() => new AppUpdater(undefined, app));
});
