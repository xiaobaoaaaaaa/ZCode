import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_COMPOSER_INPUT,
  TID_V4_STOP,
  testId,
} from "@zcode/shared/test-ids";
import { Key } from "webdriverio";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  readSettings,
  waitForWorkspaceApp,
} from "../helpers/desktop-app.js";
import {
  waitForUpstreamRequestContaining,
  expectNoUpstreamRequestForTextWithin,
} from "../helpers/conversation-session-network.js";
import { getQueueItems, waitForQueueContaining } from "../helpers/conversation-session-queue.js";
import {
  clickV4Stop,
  getV4ConversationState,
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4ComposerText,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";
import { sel } from "../helpers/selectors.js";
import { startDraftFromProject } from "../helpers/project-sidebar.js";

const TEST_TIMEOUT_MS = 180000;
const primaryModifierKey = process.platform === "darwin" ? Key.Command : Key.Control;

describe("会话区修饰键单条 delivery E2E", () => {
  before(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
    await browser.waitUntil(
      () => browser.execute(() => document.body.classList.contains("zcode-startup-ready")),
      { timeout: 10000, timeoutMsg: "启动壳未完成 ready 切换" },
    );
    // Linux Electron 曾在 ready 后卡住 opacity transition；不通过截图或额外等待触发绘制。
    expect(
      await browser.execute(() => getComputedStyle(document.getElementById("root")!).opacity),
    ).toBe("1");
    await prepareV4ConversationE2E();
    expect((await readSettings()).zcodeInteractionBehavior).toBe("queue");
  });

  beforeEach(async function () {
    this.timeout(TEST_TIMEOUT_MS);
    // 全局新建是未归类草稿；本用例的返回断言绑定固定项目，必须从该项目创建。
    await startDraftFromProject(DEFAULT_WORKSPACE);
  });

  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("M06k：queue 下 Enter 入队，Ctrl/Cmd+Enter 引导当前任务且不抢占", async () => {
    const runId = Date.now();
    await startPreOutputTurn(`E2E_MODIFIED_KEY_BASE_${runId}`);
    const original = await getV4ConversationState();
    const queuedMarker = `E2E_MODIFIED_KEY_QUEUED_${runId}`;
    await setV4ComposerText(queuedMarker);
    await $(sel(TID_V4_COMPOSER_INPUT)).click();
    await browser.keys(Key.Enter);
    await waitForQueueContaining(queuedMarker);

    const marker = `E2E_MODIFIED_KEY_GUIDED_${runId}`;
    await setV4ComposerText(marker);
    await submitWithModifiedEnter();
    await waitForV4ComposerText("", "组合键引导后 composer 未清空", 3000);
    await browser.waitUntil(
      () =>
        browser.execute(
          (text) =>
            document
              .querySelector('[data-v4-pending-guide-list="true"]')
              ?.textContent?.includes(text) ?? false,
          marker,
        ),
      { timeout: 15000, timeoutMsg: "组合键消息没有进入当前任务的待引导列表" },
    );
    const queue = await getQueueItems();
    expect(queue.filter((item) => item.content.includes(queuedMarker))).toHaveLength(1);
    expect(queue.some((item) => item.content.includes(marker))).toBe(false);
    // 基础 provider 仍在等待响应；guide 必须等待安全边界，不能偷偷 stop/startNow。
    await expectNoUpstreamRequestForTextWithin(marker, 1500);
    const current = await getV4ConversationState();
    expect(current.activeInputId).toBe(original.activeInputId);
    expect(current.state).toBe("streaming");
    expect(current.stopRequested).toBe(false);
    expect((await readSettings()).zcodeInteractionBehavior).toBe("queue");
  });

  it("M06n：guide running 下 Cmd/Ctrl+Enter 只反向进入 future queue", async () => {
    await setInteractionBehavior("guide");
    await startDraftFromProject(DEFAULT_WORKSPACE);
    const runId = Date.now();
    await startPreOutputTurn(`E2E_MODIFIED_GUIDE_BASE_${runId}`);
    const marker = `E2E_MODIFIED_GUIDE_QUEUE_${runId}`;
    await setV4ComposerText(marker);

    await submitWithModifiedEnter();

    await waitForV4ComposerText("", "guide 反向入队后 composer 没有立即清空", 3000);
    await waitForQueueContaining(marker);
    expect((await getQueueItems()).filter((item) => item.content.includes(marker))).toHaveLength(1);
    await expectNoUpstreamRequestForTextWithin(marker, 1500);
    expect((await readSettings()).zcodeInteractionBehavior).toBe("guide");
  });
});

async function submitWithModifiedEnter() {
  // Lexical 是 contenteditable；通用 DOM click helper 不会建立真实 WebDriver 键盘焦点，
  // 会让 Cmd/Ctrl+Enter 发到旧 activeElement，形成“产品未清空”的假失败。
  await $(sel(TID_V4_COMPOSER_INPUT)).click();
  // 使用 trusted W3C key action，确保 Enter 触发时平台主修饰键仍处于按下状态。
  await browser
    .action("key")
    .down(primaryModifierKey)
    .down(Key.Enter)
    .up(Key.Enter)
    .up(primaryModifierKey)
    .perform();
}

async function startPreOutputTurn(marker: string) {
  await sendV4Prompt(`E2E_HOLD_STREAM ${marker}`);
  await waitForUpstreamRequestContaining(marker, 30000);
  await waitForV4ConversationState(
    (snapshot) => snapshot.state === "streaming",
    `基础 turn 没有进入 pre-output running 窗口: ${marker}`,
    15000,
  );
  await $(sel(TID_V4_STOP)).waitForDisplayed({
    timeout: 15000,
    timeoutMsg: `基础 turn 已 streaming 但 composer 尚未进入可抢占状态: ${marker}`,
  });
}

async function setInteractionBehavior(behavior: "queue" | "guide") {
  if ((await readSettings()).zcodeInteractionBehavior === behavior) return;
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const trigger = Array.from(
          document.querySelectorAll<HTMLElement>('[role="combobox"]'),
        ).find((element) =>
          ["引导", "Guide", "队列", "Queue"].some((label) => element.innerText.includes(label)),
        );
        if (!trigger) return false;
        trigger.click();
        return true;
      }),
    { timeout: 15000, timeoutMsg: "没有找到交互行为 Select" },
  );
  await browser.waitUntil(
    async () =>
      browser.execute(
        (labels) => {
          const option = Array.from(
            document.querySelectorAll<HTMLElement>('[role="option"], [data-radix-collection-item]'),
          ).find((element) => labels.includes(element.innerText.trim()));
          if (!option) return false;
          option.click();
          return true;
        },
        behavior === "guide" ? ["引导", "Guide"] : ["队列", "Queue"],
      ),
    { timeout: 15000, timeoutMsg: `没有找到交互行为 ${behavior} 选项` },
  );
  await browser.waitUntil(
    async () => (await readSettings()).zcodeInteractionBehavior === behavior,
    {
      timeout: 15000,
      timeoutMsg: `交互行为没有保存为 ${behavior}`,
    },
  );
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30000);
}

async function stopIfBusy() {
  const snapshot = await getV4ConversationState().catch(() => null);
  if (snapshot?.state !== "streaming") return;
  await clickV4Stop().catch(() => undefined);
  await waitForV4ConversationState(
    (state) => state.state !== "streaming",
    "清理修饰键 delivery case 时会话没有停止",
    30000,
  ).catch(() => undefined);
}
