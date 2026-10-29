import { join } from "node:path";
import { clearAppData } from "../helpers/desktop-app.js";
import { releaseControlledReplay } from "../helpers/controlled-replay.js";
import {
  clickV4Stop,
  getV4QueueItems,
  hasV4PausedQueueSendDialog,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const CONTINUE = '[data-testid="v4-composer-continue"]';
type PreferencesWindow = typeof window & {
  __testActions: {
    setTheme(theme: string): void;
    setLocale(locale: "zh-CN" | "en-US"): void;
  };
};

async function waitForContinue() {
  await browser.waitUntil(
    () =>
      browser.execute((selector) => {
        const button = document.querySelector<HTMLButtonElement>(selector);
        return Boolean(button && !button.disabled);
      }, CONTINUE),
    { timeout: 30000, timeoutMsg: "停止完成后没有出现可用的继续按钮" },
  );
}

describe("Continue interrupted conversation", () => {
  before(async function () {
    this.timeout(150000);
    await clearAppData();
    await prepareV4ConversationE2E();
    await browser.execute(() => {
      (window as PreferencesWindow).__testActions.setLocale("zh-CN");
      (window as PreferencesWindow).__testActions.setTheme("zai-light");
    });
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("continues twice in the same session, preserves context and queue, and rejects double clicks", async function () {
    this.timeout(150000);
    expect(await browser.$(CONTINUE).isExisting()).toBe(false);
    await sendV4Prompt("E2E_CONTINUE_INTERRUPTED: keep the original context and finish this task.");
    await waitForV4TimelineContaining("RESUME_INITIAL_RUNNING", 30000);
    const initial = await waitForV4Pane((s) => s.canStop, "首轮没有开始执行");
    await clickV4Stop();
    await waitForContinue();
    expect(await browser.$(CONTINUE).getAttribute("aria-label")).toBe("继续");
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "continue-zh-light.png"),
    );

    // 键盘激活空输入区的继续按钮，验证原有发送链路确实恢复本会话。
    await browser.execute((selector) => {
      const button = document.querySelector<HTMLButtonElement>(selector)!;
      button.focus();
      if (document.activeElement !== button) throw new Error("继续按钮没有获得键盘焦点");
    }, CONTINUE);
    await browser.keys("Enter");
    await waitForV4TimelineContaining("RESUME_RUNNING_ONE", 30000);
    expect((await waitForV4Pane((s) => s.canStop, "继续后没有恢复执行")).sessionId).toBe(
      initial.sessionId,
    );
    expect(await browser.$(CONTINUE).isExisting()).toBe(false);

    await sendV4Prompt("E2E_CONTINUE_HELD_ONE: keep this queued.");
    await waitForV4QueueCount(1);
    await sendV4Prompt("E2E_CONTINUE_HELD_TWO: keep this queued too.");
    await waitForV4QueueCount(2);
    const queued = await getV4QueueItems();
    await clickV4Stop();
    await waitForContinue();
    await browser.execute(() => {
      (window as PreferencesWindow).__testActions.setLocale("en-US");
      (window as PreferencesWindow).__testActions.setTheme("zai-dark");
    });
    await browser.waitUntil(
      async () => (await browser.$(CONTINUE).getAttribute("aria-label")) === "Continue",
    );
    await browser.execute(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await browser.saveScreenshot(join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "continue-en-dark.png"));
    // 同一事件循环内连点；fixture 每阶段只允许一次匹配，额外请求将使回放验收失败。
    await browser.execute((selector) => {
      const button = document.querySelector<HTMLButtonElement>(selector)!;
      button.click();
      button.click();
    }, CONTINUE);
    await waitForV4TimelineContaining("RESUME_RUNNING_TWO", 30000);
    expect((await waitForV4Pane((s) => s.canStop, "第二次继续没有恢复执行")).sessionId).toBe(
      initial.sessionId,
    );
    expect((await getV4QueueItems()).map((item) => item.queueItemId)).toEqual(
      queued.map((item) => item.queueItemId),
    );
    expect(await hasV4PausedQueueSendDialog()).toBe(false);
    await releaseControlledReplay("continue-second");
    await waitForV4TimelineContaining("RESUME_FINISHED", 30000);
    await waitForV4Pane((s) => !s.canStop, "继续后的任务没有结束");
    expect(await browser.$(CONTINUE).isExisting()).toBe(false);
    expect((await getV4QueueItems()).map((item) => item.queueItemId)).toEqual(
      queued.map((item) => item.queueItemId),
    );
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "continue-completed.png"),
    );
  });
});
