import { prepareIncomingMessageCapability } from "#e2e/helpers/incoming-message-capability";
import { clearAppData } from "#e2e/helpers/desktop-app";
import {
  getUpstreamRequestEvidence,
  waitForUpstreamRequestContaining,
} from "#e2e/helpers/conversation-session-network";
import {
  clickV4Stop,
  getV4ConversationState,
  getV4Messages,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4UserMessageContaining,
} from "#e2e/helpers/v4-conversation";

describe("思考阶段引导 GI01/GI06", () => {
  after(async () => {
    if ((await getV4ConversationState()).state === "streaming") await clickV4Stop();
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("thinking request yields to guide without stopping the product turn", async function () {
    this.timeout(150000);
    await prepareIncomingMessageCapability(false);
    await sendV4Prompt("E2E_THINKING_GUIDE_BASE");
    await waitForUpstreamRequestContaining("E2E_THINKING_GUIDE_BASE", 30000);
    const before = await waitForV4ConversationState(
      (state) => state.state === "streaming",
      "初始请求未运行",
    );
    await browser.waitUntil(async () => (await $("body").getText()).includes("E2E_THINKING_WAIT"), {
      timeout: 15000,
      timeoutMsg: "未进入受控思考阶段",
    });
    await sendV4Prompt("E2E_THINKING_GUIDE_NEW");
    // 首请求在 fixture 中还需等待 60 秒；这里必须提前收到包含 guide 的真实 provider 请求。
    await waitForUpstreamRequestContaining("E2E_THINKING_GUIDE_NEW", 15000);
    await waitForV4AssistantMessageContaining("thinking-guide-applied", 15000);
    await waitForV4UserMessageContaining("E2E_THINKING_GUIDE_NEW");
    const after = await getV4ConversationState();
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.stopRequested).toBe(false);
    expect(after.queueCount).toBe(0);
    const requests = await getUpstreamRequestEvidence({
      includes: ["E2E_THINKING_GUIDE_BASE"],
      excludes: ["Generate a concise title"],
    });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.requestJson)).not.toContain("E2E_THINKING_WAIT");
    expect(
      (await getV4Messages("user")).filter((message) =>
        message.text.includes("E2E_THINKING_GUIDE_NEW"),
      ),
    ).toHaveLength(1);
    expect(
      (await getV4Messages("assistant")).some((message) =>
        message.text.includes("thinking-old-response"),
      ),
    ).toBe(false);
    await browser.saveScreenshot(`${process.env.ZCODE_E2E_ARTIFACT_DIR}/thinking-guide.png`);
  });
});
