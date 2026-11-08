import { Key } from "webdriverio";
import { TID_V4_COMPOSER_INPUT } from "@zcode/shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { sel } from "../../../helpers/selectors.js";
import {
  clickV4Stop,
  getLatestV4CommandAck,
  getV4ConversationState,
  getV4Messages,
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4ComposerText,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";
import {
  expectNoUpstreamRequestForTextWithin,
  getUpstreamRequestEvidence,
  waitForUpstreamRequestContaining,
} from "../../../helpers/conversation-session-network.js";

const GUIDE = "E2E_GUIDE_WITHDRAW_PENDING";
const BUTTON = '[data-v4-pending-guide-withdraw="true"]';

describe("待引导撤回 GW01/GW02", () => {
  after(async () => {
    if ((await getV4ConversationState()).state === "streaming") await clickV4Stop();
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("草稿冲突时保留引导；清空后撤回恢复原文且不进入模型上下文", async function () {
    this.timeout(180000);
    await prepareV4ConversationE2E();
    await sendV4Prompt("E2E_HOLD_STREAM E2E_GUIDE_WITHDRAW_BASE");
    await waitForUpstreamRequestContaining("E2E_GUIDE_WITHDRAW_BASE", 30000);
    const before = await waitForV4ConversationState(
      (snapshot) => snapshot.state === "streaming",
      "首轮没有运行",
    );
    await setV4ComposerText(GUIDE);
    await $(sel(TID_V4_COMPOSER_INPUT)).click();
    await browser
      .action("key")
      .down(process.platform === "darwin" ? Key.Command : Key.Control)
      .down(Key.Enter)
      .up(Key.Enter)
      .up(process.platform === "darwin" ? Key.Command : Key.Control)
      .perform();
    await waitForV4ComposerText("", "guide 已接收后未清空");
    await $(BUTTON).waitForDisplayed({ timeout: 15000 });
    expect(await $('[data-v4-pending-guide-list="true"]').getText()).toContain(GUIDE);

    const ackBefore = await getLatestV4CommandAck("deleteQueueItem");
    await setV4ComposerText("existing draft");
    await $(BUTTON).click();
    await waitForV4ComposerText("existing draft", "撤回覆盖了已有草稿");
    expect(await getLatestV4CommandAck("deleteQueueItem")).toEqual(ackBefore);
    expect(await $(BUTTON).isDisplayed()).toBe(true);

    await setV4ComposerText("");
    await $(BUTTON).click();
    await waitForV4ComposerText(GUIDE, "撤回没有恢复引导原文");
    await $(BUTTON).waitForExist({ reverse: true, timeout: 15000 });
    expect((await getLatestV4CommandAck("deleteQueueItem"))?.status).toBe("accepted");
    const requests = await getUpstreamRequestEvidence({ includes: ["E2E_GUIDE_WITHDRAW_BASE"] });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.status).toBe("pending");
    // 有草稿时 Composer 按合同把 Stop 换为发送键；旧 helper 据此会误判 idle。
    // 暂时清空草稿核对同一任务仍可停止，再放回原文验证 Escape 不清空草稿。
    await setV4ComposerText("");
    const after = await waitForV4ConversationState(
      (snapshot) => snapshot.state === "streaming",
      "撤回中断了当前执行",
    );
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.stopRequested).toBe(false);
    await setV4ComposerText(GUIDE);
    expect((await getV4Messages("user")).some((message) => message.text.includes(GUIDE))).toBe(
      false,
    );
    await expectNoUpstreamRequestForTextWithin(GUIDE, 1000);
    await $(sel(TID_V4_COMPOSER_INPUT)).click();
    await browser.keys(Key.Escape);
    await browser.waitUntil(
      async () => (await getLatestV4CommandAck("stop"))?.status === "accepted",
      {
        timeout: 15000,
        timeoutMsg: "Escape 未停止当前执行",
      },
    );
    await waitForV4ConversationState(
      (snapshot) => snapshot.state !== "streaming" && snapshot.queueCount === 0,
      "撤回的 guide 在停止后复活为 held queue",
    );
    await waitForV4ComposerText(GUIDE, "停止当前执行不应清空已撤回草稿");
  });
});
