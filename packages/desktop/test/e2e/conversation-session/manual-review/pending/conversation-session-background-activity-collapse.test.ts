import { join } from "node:path";
import { clearAppData, seedSettings } from "../../../helpers/desktop-app.js";
import { releaseControlledReplay } from "../../../helpers/controlled-replay.js";
import { getLatestUpstreamToolResultByToolCallId } from "../../../helpers/conversation-session-network.js";
import { ensureToolCrossProductFullAccessMode } from "../../../helpers/conversation-session-tool-cross-product.js";
import {
  clickV4Stop,
  getV4ConversationState,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";

const MARKER = "E2E_BACKGROUND_ACTIVITY";
const TRIGGER = '[data-testid="execution-activity-trigger"]';
const TOOL_A = "toolu_bg_activity_bash_a";
const TOOL_B = "toolu_bg_activity_bash_b";

async function readWakeTurn() {
  return browser.execute((trigger) => {
    const title = Array.from(
      document.querySelectorAll('[data-testid^="chat-background-result-title"]'),
    ).at(-1);
    const turn = title?.closest<HTMLElement>("section[data-turn-id]");
    return {
      turnId: turn?.dataset.turnId,
      titleOutsideActivity: Boolean(title && !title.closest("[data-execution-activity]")),
      progressOutsideActivity: Array.from(
        turn?.querySelectorAll('[data-testid^="v4-row-"]') ?? [],
      ).some(
        (row) =>
          row.textContent?.includes("E2E_WAKE_PROGRESS") &&
          !row.closest("[data-execution-activity]"),
      ),
      groups: Array.from(turn?.querySelectorAll(trigger) ?? []).map((button) => ({
        key: button.closest<HTMLElement>("[data-execution-activity]")?.dataset.executionActivity,
        expanded: button.getAttribute("aria-expanded") === "true",
        label: button.getAttribute("aria-label") ?? "",
      })),
      toolIds: Array.from(turn?.querySelectorAll<HTMLElement>("[data-tool-call-id]") ?? []).map(
        (tool) => tool.dataset.toolCallId,
      ),
      historyExpanded: turn
        ?.querySelector('[data-testid^="chat-assistant-history-trigger"]')
        ?.getAttribute("aria-expanded"),
    };
  }, TRIGGER);
}

describe("EA-BG-01 后台唤醒轮过程折叠", () => {
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
    await browser.execute(() =>
      (
        window as typeof window & {
          __testActions: { setLocale(locale: string): void };
        }
      ).__testActions.setLocale("zh-CN"),
    );
  });

  after(async () => {
    if ((await getV4ConversationState().catch(() => null))?.state === "streaming") {
      await clickV4Stop().catch(() => undefined);
    }
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("folds an automatic wake turn while preserving manual expansion and completed history", async function () {
    this.timeout(180000);
    await sendV4Prompt(`${MARKER}_LAUNCH: Start a background agent, then finish this main turn.`);
    await waitForV4AssistantMessageContaining(`${MARKER}_PARENT_DONE`);
    await waitForV4ConversationState((state) => state.state === "idle", "主轮没有结束");
    await releaseControlledReplay("bg-activity-child");
    await browser.waitUntil(
      async () => Boolean(await getLatestUpstreamToolResultByToolCallId(TOOL_A)),
      { timeout: 30000, timeoutMsg: "后台通知没有自动唤醒主轮并执行真实 Bash" },
    );
    await browser.waitUntil(async () => (await readWakeTurn()).groups.length === 1, {
      timeout: 15000,
      timeoutMsg: "后台唤醒轮未启用执行过程折叠",
    });
    const initial = await readWakeTurn();
    expect(initial.titleOutsideActivity).toBe(true);
    expect(initial.progressOutsideActivity).toBe(true);
    expect(initial.groups[0]).toMatchObject({ expanded: false });
    expect(initial.groups[0]!.label).toContain("终端 1");
    expect(initial.toolIds).not.toContain(TOOL_A);
    const turnSelector = `section[data-turn-id="${initial.turnId}"]`;
    const trigger = await browser.$(`${turnSelector} ${TRIGGER}`);
    await trigger.click();
    await browser.waitUntil(async () => (await readWakeTurn()).toolIds.includes(TOOL_A));
    await browser.$(`[data-testid="tool-summary-trigger-${TOOL_A}"]`).click();
    await browser.waitUntil(async () =>
      (await browser.$(`[data-tool-call-id="${TOOL_A}"]`).getText()).includes("E2E_WAKE_LOG_A"),
    );
    await releaseControlledReplay("bg-activity-append");
    await browser.waitUntil(
      async () => Boolean(await getLatestUpstreamToolResultByToolCallId(TOOL_B)),
      { timeout: 30000 },
    );
    await browser.waitUntil(async () => (await readWakeTurn()).groups[0]?.label.includes("终端 2"));
    expect((await readWakeTurn()).groups).toEqual([
      expect.objectContaining({ key: initial.groups[0]!.key, expanded: true }),
    ]);
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "background-activity-expanded.png"),
    );
    await trigger.click();
    await browser.waitUntil(async () => !(await readWakeTurn()).toolIds.includes(TOOL_A));
    expect((await readWakeTurn()).toolIds).not.toContain(TOOL_B);
    await browser.saveScreenshot(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "background-activity-collapsed.png"),
    );

    await releaseControlledReplay("bg-activity-finish");
    await waitForV4AssistantMessageContaining(`${MARKER}_FINAL`);
    await waitForV4ConversationState((state) => state.state === "idle", "唤醒轮没有结束");
    await browser.waitUntil(async () => {
      const state = await readWakeTurn();
      return state.groups.length === 0 && state.historyExpanded === "false";
    });
    await browser.$(`${turnSelector} [data-testid^="chat-assistant-history-trigger"]`).click();
    await browser.waitUntil(async () => (await readWakeTurn()).groups.length === 1);
    expect((await readWakeTurn()).groups[0]?.expanded).toBe(false);
    expect((await readWakeTurn()).toolIds).not.toContain(TOOL_A);
    await browser.$(`${turnSelector} ${TRIGGER}`).click();
    await browser.waitUntil(async () => (await readWakeTurn()).toolIds.includes(TOOL_A));
    expect((await readWakeTurn()).toolIds).toContain(TOOL_B);
  });
});
