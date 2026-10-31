import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { clearAppData, seedSettings } from "../helpers/desktop-app.js";
import { releaseControlledReplay } from "../helpers/controlled-replay.js";
import { getLatestUpstreamToolResultByToolCallId } from "../helpers/conversation-session-network.js";
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
let screenshotServer: Server | undefined;
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
    screenshotServer = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        '<!doctype html><title>Activity screenshot</title><body style="background:white;color:black"><h1>E2E browser image</h1></body>',
      );
    });
    await new Promise<void>((resolve) => screenshotServer!.listen(0, "127.0.0.1", resolve));
    // controlled-stream 原始 chunk 不插值动态 URL；通过本例隔离目录交给真实工具读取。
    await writeFile(
      join(RUNTIME_ROOT, "screenshot-url.txt"),
      `http://127.0.0.1:${(screenshotServer.address() as AddressInfo).port}/`,
    );
  });

  after(async () => {
    screenshotServer?.closeAllConnections();
    if (screenshotServer) {
      await new Promise<void>((resolve, reject) =>
        screenshotServer!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("keeps manual expansion across streaming groups and preserves existing file details", async function () {
    this.timeout(180000);
    await sendV4Prompt(
      "E2E_EXECUTION_ACTIVITY_COLLAPSE: Read the two seed files, write result.ts, run the command, capture a browser screenshot with mcp__node_repl__js, then read the result and reply upstream-e2e-ok.",
    );
    await browser.waitUntil(async () => (await readGroups())[0]?.label.includes("读取 1"), {
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
    await browser.waitUntil(
      async () => (await readGroups())[0]?.label.includes("读取 2 · 编辑 1 · 终端 1"),
      {
        timeout: 30000,
        timeoutMsg: "追加 Read / Write / Bash 后摘要数量没有更新",
      },
    );
    expect((await readGroups())[0]).toMatchObject({ key: first.key, expanded: true });
    await browser.waitUntil(
      async () => Boolean(await getLatestUpstreamToolResultByToolCallId("toolu_activity_bash")),
      { timeout: 30000 },
    );
    expect((await readGroups())[0]).toMatchObject({ key: first.key, expanded: true });
    expect(await readGroups()).toHaveLength(1);
    await browser.$('[data-testid="tool-summary-trigger-toolu_activity_bash"]').click();
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const tool = document.querySelector('[data-tool-call-id="toolu_activity_bash"]');
          return Boolean(
            tool?.closest("[data-execution-activity]") &&
            tool
              .querySelector('[data-testid="bash-result-output"]')
              ?.textContent?.includes("ACTIVITY_LONG_OUTPUT"),
          );
        }),
      { timeout: 15000, timeoutMsg: "长终端输出没有保留在展开的执行过程内" },
    );
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
    // Radix 收起动画完成后才卸载 children；等待实际不可见/卸载，不用 aria 切换代替完成态。
    await browser.$('[data-tool-call-id="toolu_activity_bash"]').waitForExist({ reverse: true });
    await captureLayouts();

    // 本例验证前台图片交互；先恢复测试窗口，避免宿主桌面遮挡导致真实截图无合成 surface。
    await browser.electron.execute((electron) => {
      const win = electron.BrowserWindow.getAllWindows()[0]!;
      win.show();
      win.focus();
    });
    await browser.waitUntil(() => browser.execute(() => document.visibilityState === "visible"), {
      timeout: 10000,
      timeoutMsg: "真实浏览器截图要求测试窗口在宿主桌面可见",
    });
    await releaseControlledReplay("activity-browser");
    // 等真实 Node REPL 工具结果回传；此前有图 display 会把整条调用移到外层并拆开连续组。
    await browser.waitUntil(
      async () => Boolean(await getLatestUpstreamToolResultByToolCallId("toolu_activity_browser")),
      { timeout: 30000, timeoutMsg: "浏览器截图工具结果未进入下一次请求" },
    );
    const browserResult = await getLatestUpstreamToolResultByToolCallId("toolu_activity_browser");
    expect(browserResult?.isError).toBe(false);
    expect(browserResult?.content).toContain("E2E_ACTIVITY_BROWSER_LOG");
    await browser.waitUntil(
      async () => (await readGroups())[0]?.label.includes("读取 2 · 编辑 1 · 终端 1 · 浏览器 1"),
      {
        timeout: 15000,
        timeoutMsg: "浏览器截图结果没有留在原执行过程内",
      },
    );
    expect(await readGroups()).toHaveLength(1);
    expect((await readGroups())[0]).toMatchObject({ key: first.key, expanded: false });
    expect((await readGroups())[0]?.label).not.toContain("次工具调用");
    // 所有类别仍在一个折叠组内；英文摘要和窄列使用同一份分类事实。
    await captureLayouts();
    const browserTool = '[data-tool-call-id="toolu_activity_browser"]';
    expect(await browser.$(browserTool).isExisting()).toBe(false);
    await toggleByKeyboard();
    await browser.$('[data-testid="tool-summary-trigger-toolu_activity_browser"]').click();
    await browser
      .$(`${browserTool} [data-node-repl-image-gallery] img`)
      .waitForDisplayed({ timeout: 15000 });
    // 缩略图按现有组件懒加载；滚入视口后再确认解码，不能把 DOM 可见误当作图片已加载。
    await browser.$(`${browserTool} [data-node-repl-image-gallery] img`).scrollIntoView();
    await browser.waitUntil(
      () =>
        browser.execute((selector) => {
          const image = document.querySelector<HTMLImageElement>(selector);
          return Boolean(image?.complete && image.naturalWidth > 0);
        }, `${browserTool} [data-node-repl-image-gallery] img`),
      { timeout: 10000, timeoutMsg: "浏览器截图缩略图未完成加载" },
    );
    expect(
      await browser.execute((selector) => {
        const tool = document.querySelector<HTMLElement>(selector)!;
        const image = tool.querySelector<HTMLImageElement>("[data-node-repl-image-gallery] img")!;
        const result = tool.querySelector('[data-testid="node-repl-result-surface"]');
        // 日志代码查看器使用 Shadow DOM；宿主 innerText 不包含真正渲染的代码内容。
        const text = [
          result?.textContent ?? "",
          ...Array.from(result?.querySelectorAll("*") ?? []).map(
            (element) => element.shadowRoot?.textContent ?? "",
          ),
        ].join("\n");
        return {
          inActivity: Boolean(tool.closest("[data-execution-activity]")),
          hasLog: text.includes("E2E_ACTIVITY_BROWSER_LOG"),
          hasImage: image.naturalWidth > 0,
        };
      }, browserTool),
    ).toEqual({ inActivity: true, hasLog: true, hasImage: true });
    await browser.$(`${browserTool} [data-image-thumbnail-trigger]`).click();
    await browser.$('[data-testid="node-repl-image-lightbox"]').waitForDisplayed();
    await browser.keys("Escape");
    await browser.$('[data-testid="node-repl-image-lightbox"]').waitForExist({ reverse: true });
    expect((await readGroups())[0]).toMatchObject({ key: first.key, expanded: true });
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "activity-browser-expanded.png"),
    );
    await toggleByKeyboard();
    await browser.$(browserTool).waitForExist({ reverse: true });

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
        // 后台窗口可能不提交动画帧，双 rAF 会让 execute 永不返回；等待实际主题提交，
        // 再由下方布局断言和 screenshot 读取当前视图，不用延长超时掩盖就绪条件。
        await browser.waitUntil(
          () =>
            browser.execute(
              (value) => document.documentElement.classList.contains(`theme-${value}`),
              theme,
            ),
          { timeout: 10000, timeoutMsg: `布局截图前主题 ${theme} 未生效` },
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
        expect((await readGroups())[0]?.label).toContain("Read 2 · Edit 1 · Terminal 1");
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
