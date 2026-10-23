import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppearanceImporter } from "../src/profile-import/index.js";
let root: string;
let source: string;
let target: string;
const originalHome = process.env.ZCODE_DESKTOP_HOME_DIR;
const file = (profile: string) => join(profile, "v2", "setting.json");
async function write(profile: string, value: unknown) {
  await mkdir(join(profile, "v2"), { recursive: true });
  await writeFile(file(profile), JSON.stringify(value));
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zcode-appearance-synthetic-"));
  source = join(root, "official");
  target = join(root, "personal", ".zcode-personal");
  await write(source, {
    locale: "en-US",
    desktopZoomLevel: 2,
    apiKey: "do-not-copy",
    theme: "dark",
    providerFamilyConnectionSelections: { secret: "excluded" },
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  (await import("../src/fs/fsFaultInjection.js")).resetProcessFsFaultInjectorForTests();
  if (originalHome === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
  else process.env.ZCODE_DESKTOP_HOME_DIR = originalHome;
  await rm(root, { recursive: true, force: true });
});
describe("synthetic appearance import", () => {
  it("extracts only known safe fields and derives legacy language preference", async () => {
    const commit = vi.fn(async () => ({ imported: ["locale"], preserved: [] }));
    const importer = createAppearanceImporter(target, commit);
    const preview = await importer.previewAppearanceImport({ source });
    expect(preview.settings).toEqual({
      locale: "en-US",
      localePreference: "en-US",
      desktopZoomLevel: 2,
    });
    expect(JSON.stringify(preview)).not.toContain("do-not-copy");
    expect(commit).not.toHaveBeenCalled();
    await importer.confirmAppearanceImport({ token: preview.token });
    expect(commit).toHaveBeenCalledOnce();
    expect(await readFile(file(source), "utf8")).toContain("do-not-copy");
    await expect(importer.confirmAppearanceImport({ token: preview.token })).rejects.toThrow(
      "Preview expired",
    );
  });
  it("rejects concurrent source changes, unsupported values and symbolic source files", async () => {
    const commit = vi.fn(async () => ({ imported: [], preserved: [] }));
    const importer = createAppearanceImporter(target, commit);
    const preview = await importer.previewAppearanceImport({ source });
    await write(source, { locale: "zh-CN" });
    await expect(importer.confirmAppearanceImport({ token: preview.token })).rejects.toThrow(
      "Source settings changed",
    );
    await write(source, { locale: "unknown" });
    await expect(importer.previewAppearanceImport({ source })).rejects.toThrow(
      "Unsupported locale",
    );
    await write(source, { desktopZoomLevel: 6 });
    await expect(importer.previewAppearanceImport({ source })).rejects.toThrow("zoom");
    await rm(file(source));
    await symlink(join(root, "outside"), file(source));
    await expect(importer.previewAppearanceImport({ source })).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
  it("merges absent fields under SettingService's lock, preserves existing language and never copies secrets", async () => {
    process.env.ZCODE_DESKTOP_HOME_DIR = join(root, "personal");
    await write(target, { locale: "zh-CN", marker: "preserved-by-raw-check" });
    const { createSettingService } = await import("../src/setting/settingService.js");
    const service = createSettingService();
    const preview = await service.previewAppearanceImport!({ source });
    const report = await service.confirmAppearanceImport!({ token: preview.token });
    expect(report).toEqual({
      imported: ["desktopZoomLevel"],
      preserved: ["locale", "localePreference"],
    });
    const saved = JSON.parse(await readFile(file(target), "utf8"));
    expect(saved.locale).toBe("zh-CN");
    expect(saved.desktopZoomLevel).toBe(2);
    expect(saved.apiKey).toBeUndefined();
    expect(saved.marker).toBe("preserved-by-raw-check");
    const second = await service.previewAppearanceImport!({ source });
    expect((await service.confirmAppearanceImport!({ token: second.token })).imported).toEqual([]);
  });
  it("preserves a value written after preview and rejects corrupt personal settings", async () => {
    process.env.ZCODE_DESKTOP_HOME_DIR = join(root, "personal");
    const { createSettingService } = await import("../src/setting/settingService.js");
    const service = createSettingService();
    const preview = await service.previewAppearanceImport!({ source });
    await write(target, { localePreference: "system", desktopZoomLevel: -1 });
    expect((await service.confirmAppearanceImport!({ token: preview.token })).imported).toEqual([]);
    const second = await service.previewAppearanceImport!({ source });
    await writeFile(file(target), "invalid JSON");
    await expect(service.confirmAppearanceImport!({ token: second.token })).rejects.toThrow();
    expect(await readFile(file(target), "utf8")).toBe("invalid JSON");
  });
});

it("imports into missing personal settings without creating credential fields", async () => {
  process.env.ZCODE_DESKTOP_HOME_DIR = join(root, "personal");
  const { createSettingService } = await import("../src/setting/settingService.js");
  const service = createSettingService();
  const preview = await service.previewAppearanceImport!({ source });
  expect((await service.confirmAppearanceImport!({ token: preview.token })).imported).toEqual([
    "locale",
    "localePreference",
    "desktopZoomLevel",
  ]);
  expect(JSON.parse(await readFile(file(target), "utf8"))).toEqual({
    locale: "en-US",
    localePreference: "en-US",
    desktopZoomLevel: 2,
  });
});

it("rejects a symbolic personal settings file without replacing it", async () => {
  process.env.ZCODE_DESKTOP_HOME_DIR = join(root, "personal");
  const { createSettingService } = await import("../src/setting/settingService.js");
  const service = createSettingService();
  const preview = await service.previewAppearanceImport!({ source });
  await mkdir(join(target, "v2"), { recursive: true });
  const outside = join(root, "outside.json");
  await writeFile(outside, '{"locale":"zh-CN"}');
  await symlink(outside, file(target));
  await expect(service.confirmAppearanceImport!({ token: preview.token })).rejects.toThrow();
  expect(await readFile(outside, "utf8")).toBe('{"locale":"zh-CN"}');
});

it("leaves personal settings intact after a rejected write", async () => {
  process.env.ZCODE_DESKTOP_HOME_DIR = join(root, "personal");
  await write(target, { locale: "zh-CN", unknownFutureField: { preserve: true } });
  const before = await readFile(file(target), "utf8");
  const { createSettingService } = await import("../src/setting/settingService.js");
  const service = createSettingService();
  const preview = await service.previewAppearanceImport!({ source });
  vi.stubEnv("ZCODE_ENV", "test");
  vi.stubEnv("ZCODE_E2E_FS_FAULTS_ALLOW", "1");
  vi.stubEnv(
    "ZCODE_E2E_FS_FAULTS",
    JSON.stringify([
      {
        id: "synthetic-import-failure",
        code: "EACCES",
        operations: ["writeFile"],
        pathIncludes: file(target),
      },
    ]),
  );
  (await import("../src/fs/fsFaultInjection.js")).resetProcessFsFaultInjectorForTests();
  await expect(service.confirmAppearanceImport!({ token: preview.token })).rejects.toMatchObject({
    code: "EACCES",
  });
  expect(await readFile(file(target), "utf8")).toBe(before);
});
