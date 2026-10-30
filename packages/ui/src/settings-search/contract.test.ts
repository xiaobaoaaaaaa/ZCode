import { describe, expect, it } from "vitest";
import { createSettingsSearchIndex, searchSettings } from "./contract.js";

describe("settings global search", () => {
  it("matches Chinese, English and multi-token queries across sections", () => {
    const index = createSettingsSearchIndex({}, "zh-CN");
    for (const query of ["字体", " FONT ", "外观 字体"]) {
      expect(searchSettings(index, query).some((r) => r.id === "settings.uiFontSize")).toBe(true);
    }
    expect(searchSettings(index, "api key").some((r) => r.section === "modelProvider")).toBe(true);
    expect(searchSettings(index, "zzzz-no-match")).toEqual([]);
    expect(searchSettings(index, "  ").every((r) => r.sectionOnly)).toBe(true);
  });

  it("does not expose unavailable platform sections or fields", () => {
    const web = createSettingsSearchIndex({}, "en-US");
    expect(web.some((r) => r.section === "remoteDevices" || r.section === "computerUse")).toBe(
      false,
    );
    expect(web.some((r) => r.id === "settings.keepAwakeWhileRunning")).toBe(false);
    expect(web.some((r) => r.id === "settings.integratedTerminalShell")).toBe(false);
    expect(web.some((r) => r.section === "migration")).toBe(false);
    const mac = createSettingsSearchIndex({ isDesktop: true, isMacDesktop: true }, "en-US");
    expect(mac.some((r) => r.id === "settings.closeToTrayOnWindows")).toBe(false);
    const win = createSettingsSearchIndex(
      { isDesktop: true, isWindowsDesktop: true, hostPlatform: "win32" },
      "en-US",
    );
    expect(win.some((r) => r.id === "settings.integratedTerminalShell")).toBe(true);
    expect(win.some((r) => r.id === "settings.closeToTrayOnWindows")).toBe(true);
    const linux = createSettingsSearchIndex({ isDesktop: true }, "en-US");
    expect(linux.some((r) => r.id === "settings.closeToTrayOnWindows")).toBe(true);
  });

  it("has stable unique anchors, translated labels, and localized exact-title ranking", () => {
    for (const locale of ["zh-CN", "en-US"]) {
      const index = createSettingsSearchIndex({ isDesktop: true, hostPlatform: "win32" }, locale);
      expect(new Set(index.map((r) => r.id)).size).toBe(index.length);
      for (const row of index) {
        expect(row.title).not.toBe(row.id);
        expect(row.title).not.toBe("");
      }
      const font = index.find((r) => r.id === "settings.uiFontSize")!;
      expect(searchSettings(index, font.title)[0]?.id).toBe(font.id);
    }
  });
});
