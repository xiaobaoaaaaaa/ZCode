import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, seedSettings } from "../helpers/desktop-app.js";
import { releaseControlledReplay } from "../helpers/controlled-replay.js";
import { ensureToolCrossProductFullAccessMode } from "../helpers/conversation-session-tool-cross-product.js";
import { expandAssistantHistoriesWithContent } from "../helpers/conversation-session-tool-diagnostics.js";
import { toggleLatestConversationToolGroup } from "../helpers/conversation-session-tool-groups.js";
import { resolveE2ERuntimePath } from "../helpers/e2e-runtime-paths.js";
import {
  E2E_REPLY_TOKEN,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "conversation-session-execution-activity-collapse";
const RUNTIME_ROOT = resolveE2ERuntimePath(CASE_NAME);
const TRIGGER = '[data-testid="execution-activity-trigger"]';
type ThemeWindow = typeof window & {
  __testActions: {
    getTheme(): string;
    setTheme(theme: string): void;
    getLocale(): "zh-CN" | "en-US";
    setLocale(locale: "zh-CN" | "en-US"): void;
  };
};

async function readGroups() {
  return browser.execute(
    (selector) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).map((button) => ({
        key: button.closest<HTMLElement>("[data-execution-activity]")!.dataset.executionActivity,
        expanded: button.getAttribute("aria-expanded") === "true",
        label: button.getAttribute("aria-label") ?? "",
      })),
    TRIGGER,
  );
}

async function toggleByKeyboard() {
  await browser.execute((selector) => {
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    button.scrollIntoView({ block: "center" });
    button.focus();
    if (document.activeElement !== button)
      throw new Error("Activity trigger did not receive focus");
  }, TRIGGER);
  await browser.keys("Enter");
}

describe("Execution activity collapse", () => {
  before(async function () {
    this.timeout(150000);
    await clearAppData();
    await seedSettings({
      messageStreamShowReasoning: true,
      messageStreamShowReasoningMigrationInitialized: true,
    });
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");
    await ensureToolCrossProductFullAccessMode();
    await browser.execute(() => (window as ThemeWindow).__testActions.setLocale("zh-CN"));
    await mkdir(RUNTIME_ROOT, { recursive: true });
    await writeFile(join(RUNTIME_ROOT, "seed-a.txt"), "ACTIVITY_READ_A\n");
    await writeFile(join(RUNTIME_ROOT, "seed-b.txt"), "ACTIVITY_READ_B\n");
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("keeps manual expansion across streaming groups and preserves existing file details", async function () {
    this.timeout(180000);
    await sendV4Prompt(
      "E2E_EXECUTION_ACTIVITY_COLLAPSE: Read the two seed files, write result.ts, run the command, then read the result and reply upstream-e2e-ok.",
    );
    await browser.waitUntil(async () => (await readGroups())[0]?.label.includes("1 次工具调用"), {
      timeout: 30000,
      timeoutMsg: "首个 Read 未显示为收起的执行过程",
    });
    const first = (await readGroups())[0]!;
    expect(first.expanded).toBe(false);
    expect(await browser.$('[data-tool-call-id="toolu_activity_read_a"]').isExisting()).toBe(false);
    await toggleByKeyboard();
    await browser.waitUntil(async () => (await readGroups())[0]?.expanded === true);
    await browser.$('[data-tool-call-id="toolu_activity_read_a"]').waitForExist();

    await releaseControlledReplay("activity-append");
    await browser.waitUntil(async () => (await readGroups())[0]?.label.includes("4 次工具调用"), {
      timeout: 30000,
      timeoutMsg: "追加 Read / Write / Bash 后摘要数量没有更新",
    });
    expect((await readGroups())[0]).toMatchObject({ key: first.key, expanded: true });
    await toggleLatestConversationToolGroup("Explore", true);
    await browser.$('[data-tool-call-id="toolu_activity_read_a"]').waitForExist();
    await browser.$('[data-tool-call-id="toolu_activity_read_b"]').waitForExist();
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelector<HTMLElement>('[data-tool-call-id="toolu_activity_write"]')
              ?.dataset.status === "completed",
        ),
      { timeout: 15000, timeoutMsg: "真实 Write 没有完成" },
    );
    expect(await readFile(join(RUNTIME_ROOT, "result.ts"), "utf8")).toBe(
      "export const ACTIVITY_RESULT = true;\n",
    );
    await browser.execute(() => {
      const trigger = document.querySelector<HTMLElement>(
        '[data-testid="tool-summary-trigger-toolu_activity_write"]',
      )!;
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    });
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document
              .querySelector<HTMLElement>('[data-tool-call-id="toolu_activity_write"]')
              ?.innerText.includes("ACTIVITY_RESULT") ?? false,
        ),
      { timeout: 15000, timeoutMsg: "展开后没有原有文件 Diff 内容" },
    );
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "activity-expanded-file.png"),
    );
    await toggleByKeyboard();
    await browser.waitUntil(async () => (await readGroups())[0]?.expanded === false);
    await captureLayouts();

    await releaseControlledReplay("activity-boundary");
    await browser.waitUntil(async () => (await readGroups()).length === 2, {
      timeout: 30000,
      timeoutMsg: "助手正文没有分隔两段执行过程",
    });
    expect((await readGroups()).map((group) => group.expanded)).toEqual([false, false]);
    expect((await readGroups())[0]?.key).toBe(first.key);
    expect(
      await browser.execute(() => {
        const row = Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]")).find(
          (node) => node.innerText === "执行进度：文件已更新。",
        );
        return Boolean(row && !row.closest("[data-execution-activity]"));
      }),
    ).toBe(true);
    await releaseControlledReplay("activity-finish");
    await waitForV4AssistantMessageContaining(E2E_REPLY_TOKEN, 30000);
    await waitForV4Pane((snapshot) => !snapshot.canStop, "执行没有结束", 30000);
    expect(await readGroups()).toHaveLength(0);
    await expandAssistantHistoriesWithContent();
    await browser.$('[data-tool-call-id="toolu_activity_write"]').waitForExist();
    expect(await readGroups()).toHaveLength(0);
  });
});

async function captureLayouts() {
  const original = await browser.electron.execute((electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0]!;
    return { bounds: win.getBounds(), minimum: win.getMinimumSize() };
  });
  const preferences = await browser.execute(() => ({
    theme: (window as ThemeWindow).__testActions.getTheme(),
    locale: (window as ThemeWindow).__testActions.getLocale(),
  }));
  try {
    for (const width of [1200]) {
      await browser.electron.execute((electron, value) => {
        const win = electron.BrowserWindow.getAllWindows()[0]!;
        win.setMinimumSize(320, 480);
        win.setSize(value, 844);
      }, width);
      await browser.execute(() => (window as ThemeWindow).__testActions.setLocale("en-US"));
      await browser.waitUntil(() => browser.execute((value) => innerWidth === value, width));
      for (const theme of ["zai-light", "zai-dark"]) {
        await browser.execute(
          (value) => (window as ThemeWindow).__testActions.setTheme(value),
          theme,
        );
        await browser.execute(
          (selector) => document.querySelector(selector)!.scrollIntoView({ block: "center" }),
          TRIGGER,
        );
        await browser.execute(
          async () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        expect(
          await browser.execute((selector) => {
            const button = document.querySelector<HTMLElement>(selector)!;
            const box = button.getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.top >= 0 &&
              box.bottom <= innerHeight &&
              button.scrollWidth <= button.clientWidth + 1
            );
          }, TRIGGER),
        ).toBe(true);
        expect((await readGroups())[0]?.label).not.toContain("{count");
        await browser.saveScreenshot(
          join(process.env.ZCODE_E2E_ARTIFACT_DIR!, `activity-${width}-${theme}.png`),
        );
      }
    }
  } finally {
    await browser.electron.execute((electron, value) => {
      const win = electron.BrowserWindow.getAllWindows()[0]!;
      win.setMinimumSize(value.minimum[0]!, value.minimum[1]!);
      win.setBounds(value.bounds);
    }, original);
    await browser.execute((value) => {
      (window as ThemeWindow).__testActions.setTheme(value.theme);
      (window as ThemeWindow).__testActions.setLocale(value.locale);
    }, preferences);
  }
}
