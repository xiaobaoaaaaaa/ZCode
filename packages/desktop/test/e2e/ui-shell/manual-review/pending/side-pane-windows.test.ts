import { nativeSidePaneDrag as nativeDrag } from "../../../helpers/native-side-pane-drag.js";
import { join } from "node:path";
import { TID_SIDE_PANE_TOGGLE, TID_WORKSPACE_HEADER } from "@zcode/shared/test-ids";
import { prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";
import { clearAppData } from "../../../helpers/desktop-app.js";

const tabSelector = '[data-side-pane-tab-id][data-state="active"]';
const terminalSelector = ".terminal-xterm-shell .xterm-helper-textarea";
let ownerHandle: string;
let ownerId: number;
let tabId: string;

async function terminalCommand(command: string) {
  const textarea = await $(terminalSelector);
  await textarea.waitForExist({ timeout: 10_000 });
  await $(".xterm-screen").click();
  await browser.waitUntil(async () => textarea.isFocused());
  await browser.keys(command);
  await browser.keys("Enter");
}
async function waitForOutput(marker: string) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (value) =>
          [...document.querySelectorAll(".xterm-rows")].some((element) =>
            element.textContent?.includes(value),
          ),
        marker,
      ),
    { timeout: 10_000, timeoutMsg: `terminal output missing: ${marker}` },
  );
}
async function detach() {
  const existing = new Set(await browser.getWindowHandles());
  await $(tabSelector).click({ button: "right" });
  const menu = await $(
    '//*[@role="menuitem" and (contains(.,"移至独立窗口") or contains(.,"Move to New Window"))]',
  );
  await menu.waitForClickable();
  await menu.click();
  await browser.waitUntil(
    async () => (await browser.getWindowHandles()).length === existing.size + 1,
    { timeout: 10_000 },
  );
  const child = (await browser.getWindowHandles()).find((handle) => !existing.has(handle))!;
  await browser.switchToWindow(child);
  await $("[data-detached-side-pane]").waitForDisplayed({ timeout: 10_000 });
  return child;
}

describe("Side pane native windows", () => {
  before(async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
    ownerHandle = await browser.getWindowHandle();
    ownerId = await browser.electron.execute(
      (electron) => electron.BrowserWindow.getAllWindows()[0]!.id,
    );
    await $(`[data-testid="${TID_SIDE_PANE_TOGGLE}"]`).click();
    const terminal = await $('[data-state="active"] [data-side-pane-open-tab-item="terminal"]');
    await terminal.waitForClickable();
    await terminal.click();
    const id = await $(tabSelector).getAttribute("data-side-pane-tab-id");
    if (!id) throw new Error("Missing terminal tab ID");
    tabId = id;
  });
  afterEach(async () => {
    await browser.switchToWindow(ownerHandle);
    await browser.electron.execute((electron, id) => {
      const owner = electron.BrowserWindow.fromId(id)!;
      owner.show();
      for (const window of electron.BrowserWindow.getAllWindows())
        if (window.id !== id) window.close();
    }, ownerId);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1);
  });
  after(async () => {
    await browser.switchToWindow(ownerHandle);
    await browser.electron.execute((electron, id) => {
      for (const window of electron.BrowserWindow.getAllWindows())
        if (window.id !== id) window.close();
    }, ownerId);
    await clearAppData();
  });
  it("SPW-001/003 keeps the shell and scrollback when moving and closing the window", async () => {
    const set =
      process.platform === "win32"
        ? '$env:ZCODE_PANE_MARKER="E2E_PANE_ALIVE"; Write-Output $env:ZCODE_PANE_MARKER; Write-Output ("SPW_PID=" + $PID)'
        : "export ZCODE_PANE_MARKER=E2E_PANE_ALIVE; echo $ZCODE_PANE_MARKER; echo SPW_PID=$$";
    await terminalCommand(set);
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          /SPW_PID=\d+/.test(document.querySelector(".xterm-rows")?.textContent ?? ""),
        ),
      { timeout: 10_000 },
    );
    const before = await browser.execute(
      () => document.querySelector(".xterm-rows")?.textContent ?? "",
    );
    const pid = before.match(/SPW_PID=(\d+)/)?.[1];
    expect(pid).toBeTruthy();
    await detach();
    expect(await $("[data-detached-side-pane]").getAttribute("data-detached-side-pane")).toBe(
      tabId,
    );
    await waitForOutput("E2E_PANE_ALIVE");
    await terminalCommand(
      process.platform === "win32"
        ? 'Write-Output $env:ZCODE_PANE_MARKER; Write-Output ("SPW_PID=" + $PID)'
        : "echo $ZCODE_PANE_MARKER; echo SPW_PID=$$",
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            (document.querySelector(".xterm-rows")?.textContent?.match(/SPW_PID=\d+/g)?.length ??
              0) >= 2,
        ),
      { timeout: 10_000 },
    );
    const rows = await browser.execute(
      () => document.querySelector(".xterm-rows")?.textContent ?? "",
    );
    expect(rows.match(/SPW_PID=(\d+)/g)?.at(-1)).toBe(`SPW_PID=${pid}`);
    expect(rows.length).toBeGreaterThan(before.length);
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".", "side-pane-window-terminal.png"),
    );
    await browser.electron.execute((electron, id) => {
      const child = electron.BrowserWindow.getAllWindows().find((window) => window.id !== id);
      child?.close();
    }, ownerId);
    await browser.switchToWindow(ownerHandle);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, {
      timeout: 10_000,
    });
    expect(await $(tabSelector).getAttribute("data-side-pane-tab-id")).toBe(tabId);
    await waitForOutput("E2E_PANE_ALIVE");
    await terminalCommand(
      process.platform === "win32"
        ? "Write-Output $env:ZCODE_PANE_MARKER"
        : "echo $ZCODE_PANE_MARKER",
    );
    await waitForOutput("E2E_PANE_ALIVE");
  });
  (process.platform === "linux" && process.env.DISPLAY ? it : it.skip)(
    "SPW-002 drags outside the native window and back to the original tab strip",
    async () => {
      await browser.electron.execute((electron, id) => {
        const owner = electron.BrowserWindow.fromId(id)!;
        owner.setBounds({ x: 40, y: 40, width: 900, height: 700 });
        owner.show();
        owner.focus();
      }, ownerId);
      await browser.waitUntil(async () => await browser.execute(() => window.innerWidth === 900));
      // 窗口缩窄会按既有布局策略自动收起右侧栏；等待该状态再由用户入口展开，
      // 避免在 resize idle 回调前开始拖动，随后把拖回目标留在屏幕外。
      await browser.waitUntil(async () =>
        browser.execute(() => {
          const frame = document.querySelector("[data-workspace-side-frame]");
          return (
            frame?.getAttribute("aria-hidden") === "true" &&
            frame.parentElement!.getBoundingClientRect().width < 1
          );
        }),
      );
      await $(
        `[data-testid="${TID_WORKSPACE_HEADER}"] [data-testid="${TID_SIDE_PANE_TOGGLE}"]`,
      ).click();
      await browser.waitUntil(async () =>
        browser.execute(() => {
          const rect = document
            .querySelector("[data-side-pane-tabs-viewport]")!
            .getBoundingClientRect();
          const panel = document.querySelector("[data-workspace-side-frame]")!.parentElement!;
          return (
            panel.getAnimations().every((animation) => animation.playState === "finished") &&
            rect.width > 0 &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth
          );
        }),
      );
      const bounds = await browser.electron.execute(
        (electron, id) => electron.BrowserWindow.fromId(id)!.getContentBounds(),
        ownerId,
      );
      const point = await browser.execute((selector) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      }, tabSelector);
      await nativeDrag(
        { x: bounds.x + point.x, y: bounds.y + point.y },
        { x: bounds.x + bounds.width + 70, y: bounds.y + point.y },
      );
      await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2, {
        timeout: 10_000,
        timeoutMsg: "native drag-out did not open a window",
      });
      const childHandle = (await browser.getWindowHandles()).find(
        (handle) => handle !== ownerHandle,
      )!;
      const childBounds = await browser.electron.execute((electron, id) => {
        const child = electron.BrowserWindow.getAllWindows().find((window) => window.id !== id)!;
        child.setBounds({ x: 1000, y: 600, width: 400, height: 350 });
        return child.getContentBounds();
      }, ownerId);
      await browser.saveScreenshot(
        join(process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".", "side-pane-window-drag-owner.png"),
      );
      await browser.switchToWindow(childHandle);
      await $("[data-side-pane-window-drag]").waitForDisplayed();
      const source = await browser.execute(() => {
        const rect = document
          .querySelector("[data-side-pane-window-drag]")!
          .getBoundingClientRect();
        return { x: Math.round(rect.left + 25), y: Math.round(rect.top + rect.height / 2) };
      });
      await nativeDrag(
        { x: childBounds.x + source.x, y: childBounds.y + source.y },
        { x: bounds.x + point.x, y: bounds.y + point.y },
      );
      await browser.switchToWindow(ownerHandle);
      await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, {
        timeout: 10_000,
        timeoutMsg: "native drag-back did not dock the window",
      });
      await waitForOutput("E2E_PANE_ALIVE");
    },
  );
  it("SPW-007 renders terminal menus in the auxiliary document and docks with a button", async () => {
    await detach();
    await $(".xterm-screen").click({ button: "right" });
    await $('[data-slot="context-menu-content"]').waitForDisplayed();
    expect(await $('[data-slot="context-menu-content"]').getText()).toMatch(/Copy|复制/);
    await browser.keys("Escape");
    await $(
      '//header//button[contains(.,"收回侧栏") or contains(.,"Move Back to Sidebar")]',
    ).click();
    await browser.switchToWindow(ownerHandle);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1);
  });
  it("SPW-007 keeps locale, theme and layout in a narrow auxiliary window", async () => {
    const child = await detach();
    await browser.electron.execute((electron, id) => {
      electron.BrowserWindow.getAllWindows()
        .find((window) => window.id !== id)!
        .setSize(360, 320);
    }, ownerId);
    for (const locale of ["zh-CN", "en-US"] as const) {
      for (const theme of ["zai-light", "zai-dark"] as const) {
        await browser.switchToWindow(ownerHandle);
        await browser.execute(
          (nextLocale, nextTheme) => {
            const actions = (
              window as unknown as {
                __testActions: { setLocale(value: string): void; setTheme(value: string): void };
              }
            ).__testActions;
            actions.setLocale(nextLocale);
            actions.setTheme(nextTheme);
          },
          locale,
          theme,
        );
        await browser.switchToWindow(child);
        await browser.waitUntil(async () =>
          browser.execute(
            (nextTheme, label) =>
              document.documentElement.classList.contains(`theme-${nextTheme}`) &&
              document.querySelector("header")!.textContent!.includes(label),
            theme,
            locale === "zh-CN" ? "收回侧栏" : "Move Back to Sidebar",
          ),
        );
        expect(
          await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        expect(await $("header button").isClickable()).toBe(true);
        await browser.saveScreenshot(
          join(
            process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".",
            `side-pane-window-${locale}-${theme}-360.png`,
          ),
        );
      }
    }
  });
  it("SPW-001/003 keeps one window per tab and docks all when the owner hides", async () => {
    const first = await detach();
    await browser.switchToWindow(ownerHandle);
    await $(tabSelector).click({ button: "right" });
    await $('//*[@role="menuitem" and contains(.,"Focus Window")]').click();
    expect(await browser.getWindowHandles()).toHaveLength(2);
    expect(await browser.getWindowHandles()).toContain(first);
    await browser.switchToWindow(ownerHandle);
    await $("[data-side-pane-add-tab-trigger]").click();
    await $('[data-state="active"] [data-side-pane-open-tab-item="terminal"]').click();
    const secondId = await $(tabSelector).getAttribute("data-side-pane-tab-id");
    expect(secondId).not.toBe(tabId);
    await detach();
    expect(await browser.getWindowHandles()).toHaveLength(3);
    await browser.electron.execute(
      (electron, id) => electron.BrowserWindow.fromId(id)!.hide(),
      ownerId,
    );
    await browser.switchToWindow(ownerHandle);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1);
    await browser.electron.execute(
      (electron, id) => electron.BrowserWindow.fromId(id)!.show(),
      ownerId,
    );
    expect(await $$("[data-side-pane-tab-id]")).toHaveLength(2);
    await $(`[data-side-pane-tab-id="${tabId}"]`).click();
    await waitForOutput("E2E_PANE_ALIVE");
  });
});
