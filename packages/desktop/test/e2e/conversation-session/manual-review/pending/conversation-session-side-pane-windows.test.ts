import { TID_V4_SUBAGENT_OPEN_SIDE_PANE } from "@zcode/shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
} from "../../../helpers/v4-conversation.js";
import { ensureToolCrossProductFullAccessMode } from "../../../helpers/conversation-session-tool-cross-product.js";
import { releaseControlledReplay } from "../../../helpers/controlled-replay.js";
import {
  countUpstreamRequests,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";

describe("Subagent side pane window", () => {
  after(async () => {
    await clearAppData();
  });
  it("SPW-004 preserves the child and receives new output across detach and dock", async () => {
    await prepareV4ConversationE2E();
    await ensureToolCrossProductFullAccessMode();
    const owner = await browser.getWindowHandle();
    await sendV4Prompt(
      "E2E_SPW_PARENT: launch exactly one Agent with subagent_type general-purpose to respond with E2E_SPW_CHILD_START and E2E_SPW_CHILD_DONE.",
    );
    const summary = await $(`[data-testid^="${TID_V4_SUBAGENT_OPEN_SIDE_PANE}-"]`);
    await summary.waitForClickable({ timeout: 30_000 });
    await summary.click();
    const tab = await $('[data-side-pane-tab-id^="subagent-session:"][data-state="active"]');
    await tab.waitForDisplayed();
    const tabId = await tab.getAttribute("data-side-pane-tab-id");
    if (!tabId) throw new Error("Missing subagent tab ID");
    const childSelector = '[data-session-id^="sess_subagent_"]';
    await waitForV4AssistantMessageContaining("E2E_SPW_CHILD_START", 30_000, tabId);
    const childId = await $(childSelector).getAttribute("data-session-id");
    await tab.click({ button: "right" });
    await $(
      '//*[@role="menuitem" and (contains(.,"移至独立窗口") or contains(.,"Move to New Window"))]',
    ).click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2);
    const childWindow = (await browser.getWindowHandles()).find((id) => id !== owner)!;
    await browser.switchToWindow(childWindow);
    await $("[data-detached-side-pane]").waitForDisplayed();
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
    await $(
      '//header//button[contains(.,"收回侧栏") or contains(.,"Move Back to Sidebar")]',
    ).click();
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
