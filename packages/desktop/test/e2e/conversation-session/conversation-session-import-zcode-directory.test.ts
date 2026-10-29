import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TID_SETTINGS_SECTION_NAV, TID_TASK_SETTINGS_BUTTON, testId } from "@zcode/shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  DEFAULT_WORKSPACE,
  getE2EAppDataPaths,
} from "../helpers/desktop-app.js";
import { restartIntoWorkspacePreservingProfile } from "../helpers/model-provider-restart.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";
import { ensureProjectExpanded } from "../helpers/project-sidebar.js";

const paths = getE2EAppDataPaths();
const fixtureDir = join(paths.homeDir, "zdi01-fixture");
const source = join(fixtureDir, "source", ".zcode");
const destination = join(fixtureDir, "copies");
const pointer = join(paths.storageRoot, "import-profile.json");
type ThemeWindow = typeof window & {
  __testActions: {
    getTheme(): string;
    setTheme(theme: string): void;
    getLocale(): "zh-CN" | "en-US";
    setLocale(locale: "zh-CN" | "en-US"): void;
  };
};

async function captureImportLayouts() {
  const size = await browser.electron.execute((electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0]!;
    return { bounds: win.getBounds(), minimum: win.getMinimumSize() };
  });
  const preferences = await browser.execute(() => ({
    theme: (window as ThemeWindow).__testActions.getTheme(),
    locale: (window as ThemeWindow).__testActions.getLocale(),
  }));
  try {
    for (const width of [1200, 390]) {
      await browser.execute(
        (value) =>
          (window as ThemeWindow).__testActions.setLocale(value === 390 ? "zh-CN" : "en-US"),
        width,
      );
      await browser.electron.execute((electron, value) => {
        const win = electron.BrowserWindow.getAllWindows()[0]!;
        win.setMinimumSize(320, 480);
        win.setSize(value, 844);
      }, width);
      await browser.waitUntil(() => browser.execute((value) => innerWidth === value, width));
      for (const theme of ["zai-light", "zai-dark"]) {
        await browser.execute(
          (value) => (window as ThemeWindow).__testActions.setTheme(value),
          theme,
        );
        const button = browser.$('[data-testid="settings-import-data-restart"]');
        await button.scrollIntoView();
        await browser.execute(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        });
        expect(
          await browser.execute(() => {
            const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
            const button = document.querySelector('[data-testid="settings-import-data-restart"]')!;
            const box = button.getBoundingClientRect();
            return {
              fits: dialog.scrollWidth <= dialog.clientWidth + 1,
              visible:
                box.left >= 0 &&
                box.right <= innerWidth &&
                box.top >= 0 &&
                box.bottom <= innerHeight,
            };
          }),
        ).toEqual({ fits: true, visible: true });
        await browser.saveScreenshot(
          join(
            process.env.ZCODE_E2E_ARTIFACT_DIR || fixtureDir,
            `zcode-import-${width}-${theme}.png`,
          ),
        );
      }
    }
  } finally {
    await browser.electron.execute((electron, original) => {
      const win = electron.BrowserWindow.getAllWindows()[0]!;
      win.setMinimumSize(original.minimum[0]!, original.minimum[1]!);
      win.setBounds(original.bounds);
    }, size);
    await browser.execute((original) => {
      (window as ThemeWindow).__testActions.setTheme(original.theme);
      (window as ThemeWindow).__testActions.setLocale(original.locale);
    }, preferences);
  }
}

describe("ZDI01：从独立 ZCode 目录完整导入", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("通过设置导入，冷重启后读取并继续来源会话，仅写入副本", async function () {
    this.timeout(300_000);
    await prepareV4ConversationE2E({ resetDraftBeforeProvider: true });
    await sendV4Prompt("E2E_ZDI01_BEFORE_MIGRATION");
    await waitForV4TimelineContaining("ZDI01_BEFORE_MIGRATION_DONE", 60_000);
    const session = await waitForV4Pane(
      (state) => Boolean(state.sessionId && state.sessionId !== "draft" && !state.canStop),
      "ZDI01 来源会话未完成",
      60_000,
    );
    const sessionId = session.sessionId!;
    await rm(fixtureDir, { recursive: true, force: true });
    await mkdir(join(source, "cli"), { recursive: true });
    await mkdir(destination);
    // 测试来源是离线副本，包含真实 App 索引及 CLI WAL；不携带 Dev runtime 的链接。
    await cp(paths.appDataDir, join(source, "v2"), { recursive: true });
    await cp(join(paths.storageRoot, "cli", "db"), join(source, "cli", "db"), { recursive: true });
    await cp(
      join(paths.storageRoot, "cli", "config.json"),
      join(source, "cli", "config.json"),
    ).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      await writeFile(join(source, "cli", "config.json"), "{}");
    });
    const sourceSettings = JSON.parse(await readFile(join(source, "v2", "setting.json"), "utf8"));
    delete sourceSettings.dataBaseDir;
    await writeFile(join(source, "v2", "setting.json"), JSON.stringify(sourceSettings));
    await mkdir(join(source, "workspace", "default"), { recursive: true });
    await writeFile(
      join(source, "workspace", "default", "import-canary.txt"),
      "source workspace preserved",
    );
    const sourceSettingsBefore = await readFile(join(source, "v2", "setting.json"), "utf8");
    const originalIndex = join(paths.appDataDir, "tasks-index.sqlite");
    const originalUpdatedAt = taskUpdatedAt(originalIndex, sessionId);

    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), { timeout: 15_000 });
    await clickTestIdByDom("settings-import-data-open", { timeout: 15_000 });
    const picker = await browser.electron.mock("dialog", "showOpenDialog");
    await picker.mockResolvedValueOnce({ canceled: false, filePaths: [source] });
    await clickTestIdByDom("settings-import-data-pick-source");
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="settings-import-data-source"]').getValue()) === source,
    );
    await picker.mockResolvedValueOnce({ canceled: false, filePaths: [destination] });
    await clickTestIdByDom("settings-import-data-pick-destination");
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="settings-import-data-destination"]').getValue()) ===
        destination,
    );
    await clickTestIdByDom("settings-import-data-submit");
    await browser
      .$('[data-testid="settings-import-data-restart"]')
      .waitForExist({ timeout: 60_000 });
    const profile = JSON.parse(await readFile(pointer, "utf8")).dataBaseDir as string;
    const copiedRoot = join(profile, ".zcode");
    expect(
      await readFile(join(copiedRoot, "workspace", "default", "import-canary.txt"), "utf8"),
    ).toBe("source workspace preserved");
    expect(await readFile(join(source, "v2", "setting.json"), "utf8")).toBe(sourceSettingsBefore);
    expect(
      await browser.electron.execute(() => ({
        profile: process.env.ZCODE_PROFILE_BASE_DIR ?? null,
      })),
    ).toEqual({ profile: null });
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR || fixtureDir, "zcode-import-ready.png"),
    );
    await captureImportLayouts();

    // WDIO 重建连接，复用产品正常退出屏障，并保留 Chromium profile。
    await restartIntoWorkspacePreservingProfile();
    expect(await browser.electron.execute(() => process.env.ZCODE_PROFILE_BASE_DIR)).toBe(profile);
    expect(await browser.electron.execute(() => process.env.HOME)).toBe(paths.homeDir);
    await ensureProjectExpanded(DEFAULT_WORKSPACE);
    await selectV4TaskById(sessionId);
    await waitForV4TimelineContaining("ZDI01_BEFORE_MIGRATION_DONE", 60_000);
    await sendV4Prompt("E2E_ZDI01_AFTER_MIGRATION");
    await waitForV4TimelineContaining("ZDI01_AFTER_MIGRATION_DONE", 60_000);
    await waitForV4Pane(
      (state) => state.sessionId === sessionId && !state.canStop,
      "ZDI01 副本中的后续对话未完成",
      60_000,
    );
    expect(taskUpdatedAt(join(copiedRoot, "v2", "tasks-index.sqlite"), sessionId)).toBeGreaterThan(
      originalUpdatedAt,
    );
    expect(taskUpdatedAt(originalIndex, sessionId)).toBe(originalUpdatedAt);
    expect(await readFile(join(source, "v2", "setting.json"), "utf8")).toBe(sourceSettingsBefore);
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR || fixtureDir, "zcode-import-history.png"),
    );
  });
});

function taskUpdatedAt(path: string, sessionId: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number(
      db.prepare("SELECT updated_at FROM tasks WHERE task_id = ?").get(sessionId)?.updated_at ?? 0,
    );
  } finally {
    db.close();
  }
}
