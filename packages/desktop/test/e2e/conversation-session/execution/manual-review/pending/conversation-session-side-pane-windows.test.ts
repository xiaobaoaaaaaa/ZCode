import { TID_V4_SUBAGENT_OPEN_SIDE_PANE } from "@zcode/shared/test-ids";
import { clearAppData } from "#e2e/helpers/desktop-app";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
} from "#e2e/helpers/v4-conversation";
import { releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import {
  countUpstreamRequests,
  waitForUpstreamRequest,
} from "#e2e/helpers/conversation-session-network";

async function clickVisibleElement(element: ReturnType<typeof $>, button = 0) {
  // Electron 152 的 checkVisibility 曾把有真实几何、可命中的元素判为隐藏。
  // 用浏览器命中结果确定坐标，再发送真实指针；不改样式、不绕过产品事件。
  let point = { x: 0, y: 0 };
  await browser.waitUntil(
    async () => {
      const hitPoint = await browser.execute((target: HTMLElement) => {
        const rect = target.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        const hit = document.elementFromPoint(x, y);
        return rect.width > 0 && rect.height > 0 && hit && target.contains(hit) ? { x, y } : null;
      }, element);
      if (!hitPoint) return false;
      point = hitPoint;
      return true;
    },
    { timeout: 10000, timeoutMsg: "窗口迁移控件不可命中" },
  );
  await browser.performActions([
    {
      type: "pointer",
      id: "side-pane-pointer",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, x: point.x, y: point.y },
        { type: "pointerDown", button },
        { type: "pointerUp", button },
      ],
    },
  ]);
  // pointerUp 已释放按键；“收回侧栏”会立即关闭当前窗口，不能再向旧 window 发 releaseActions。
}

describe("Subagent side pane window", () => {
  after(async () => {
    await clearAppData();
  });
  it("SPW-004 preserves the child and receives new output across detach and dock", async () => {
    await prepareV4ConversationE2E();
    // 此回放仅启动返回文本的 Agent，不执行文件或命令操作；使用默认权限验收窗口迁移。
    const owner = await browser.getWindowHandle();
    await sendV4Prompt(
      "E2E_SPW_PARENT: launch exactly one Agent with subagent_type general-purpose to respond with E2E_SPW_CHILD_START and E2E_SPW_CHILD_DONE.",
    );
    const summary = await $(`[data-testid^="${TID_V4_SUBAGENT_OPEN_SIDE_PANE}-"]`);
    await summary.waitForExist({ timeout: 30_000 });
    await clickVisibleElement(summary);
    const tab = await $('[data-side-pane-tab-id^="subagent-session:"][data-state="active"]');
    await tab.waitForExist();
    const tabId = await tab.getAttribute("data-side-pane-tab-id");
    if (!tabId) throw new Error("Missing subagent tab ID");
    const childSelector = '[data-session-id^="sess_subagent_"]';
    await waitForV4AssistantMessageContaining("E2E_SPW_CHILD_START", 30_000, tabId);
    const childId = await $(childSelector).getAttribute("data-session-id");
    await browser.saveScreenshot(
      `${process.env.ZCODE_E2E_ARTIFACT_DIR}/side-pane-before-detach.png`,
    );
    await clickVisibleElement(tab, 2);
    await clickVisibleElement(
      await $(
        '//*[@role="menuitem" and (contains(.,"移至独立窗口") or contains(.,"Move to New Window"))]',
      ),
    );
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
    const childWindow = (await browser.getWindowHandles()).find((id) => id !== owner)!;
    await browser.switchToWindow(childWindow);
    await $("[data-detached-side-pane]").waitForExist();
    await browser.saveScreenshot(`${process.env.ZCODE_E2E_ARTIFACT_DIR}/side-pane-detached.png`);
    expect(await $(childSelector).getAttribute("data-session-id")).toBe(childId);
    expect(await $("[data-detached-side-pane]").getAttribute("data-detached-side-pane")).toBe(
      tabId,
    );
    const assistantText = await browser.execute(
      (selector) =>
        [...document.querySelector(selector)!.querySelectorAll<HTMLElement>("[data-row-id]")]
          .filter((row) => row.classList.contains("group/assistant-row"))
          .map((row) => row.innerText)
          .join("\n"),
      childSelector,
    );
    expect(assistantText).not.toContain("E2E_SPW_CHILD_DONE");
    await browser.switchToWindow(owner);
    await releaseControlledReplay("spw-child");
    await browser.switchToWindow(childWindow);
    await waitForV4AssistantMessageContaining("E2E_SPW_CHILD_DONE", 20_000, tabId);
    await clickVisibleElement(
      await $('//header//button[contains(.,"收回侧栏") or contains(.,"Move Back to Sidebar")]'),
    );
    await browser.switchToWindow(owner);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1);
    expect(await $(childSelector).getAttribute("data-session-id")).toBe(childId);
    expect(await $(childSelector).getText()).toContain("E2E_SPW_CHILD_DONE");
    await waitForV4AssistantMessageContaining("E2E_SPW_PARENT_DONE");
    expect(
      await countUpstreamRequests({
        lastUserMessageIncludes: ["E2E_SPW_CHILD:"],
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      }),
    ).toBe(1);
    await waitForUpstreamRequest(
      {
        includes: ["E2E_SPW_PARENT", "agentId: agent_", "E2E_SPW_CHILD_DONE"],
        excludes: ["Generate a concise title"],
      },
      "child result did not reach its original parent",
      20_000,
    );
  });
});
