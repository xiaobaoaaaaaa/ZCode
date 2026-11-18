import {
  assistantSelector as id,
  openAssistant,
  submit,
  waitForText,
  itemByTitle,
} from "#e2e/helpers/workspace-assistant";
import { setRendererViewport, clearRendererViewport } from "#e2e/helpers/renderer-viewport";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { restartIntoWorkspacePreservingProfile } from "#e2e/helpers/model-provider-restart-runtime";
import { clearAppData, DEFAULT_WORKSPACE, getE2EAppDataPaths } from "#e2e/helpers/desktop-app";
import { waitForControlledReplay, releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import { countUpstreamRequests } from "#e2e/helpers/conversation-session-network";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "#e2e/helpers/v4-conversation";

const marker = {
  cold: "E2E_WA_COLD",
  invalid: "E2E_WA_RETRY",
  question: "E2E_WA_GENERAL",
  queue: "E2E_WA_QUEUE_STALE",
  diff: "E2E_WA_DIFF_WRAP",
  routed: "E2E_WA_ROUTED",
  takeover: "E2E_WA_TAKEOVER",
  ambiguous: "E2E_WA_AMBIGUOUS",
  followup: "E2E_WA_FOLLOWUP",
};
const queueGate = "wa-worker-queue_stale";

describe("Workspace assistant task coordination", () => {
  after(async () => clearAppData());

  it("keeps two out-of-order workers distinct across follow-up and handoff", async function () {
    this.timeout(240_000);
    await prepareV4ConversationE2E();
    await openAssistant();

    await submit(`${marker.question} What is a queue?`);
    await waitForText(id("message"), "WA_GENERAL_ANSWER");
    expect(await $$(id("item")).length).toBe(0);

    await submit(`${marker.queue} Investigate stale messages in a queue.`);
    const queue = await itemByTitle("Queue investigation");
    await waitForControlledReplay(queueGate);
    try {
      await submit(`${marker.diff} Investigate diff line wrapping.`);
      const diff = await itemByTitle("Diff investigation");
      expect(diff.taskId).not.toBe(queue.taskId);
      await waitForText(diff.selector, "WA_B_RESULT");
      await waitForText(id("message"), "WA_B_SUMMARY");

      await submit(`${marker.ambiguous} Please handle the earlier problem.`);
      await waitForText(id("message"), "WA_CHOOSE_A_TASK");
      expect(await $$(id("item")).length).toBe(2);
      const choices = await $$(id("choice")).map((button) => button.getAttribute("data-task-id"));
      expect(choices.sort()).toEqual([queue.taskId, diff.taskId].sort());
      const clarifiedDeliveries = () =>
        countUpstreamRequests({
          lastUserMessageIncludes: [marker.ambiguous],
          excludes: [
            "Workspace assistant router",
            "Workspace assistant reporter",
            "Workspace assistant mailbox",
          ],
        });
      expect(await clarifiedDeliveries()).toBe(0);
      await $(`${id("choice")}[data-task-id="${diff.taskId}"]`).click();
      await waitForText(diff.selector, "WA_B_CHOICE_RESULT");
      expect(await clarifiedDeliveries()).toBe(1);
      await submit(`${marker.routed} Continue the diff investigation for narrow lines.`);
      await waitForText(diff.selector, "WA_B_ROUTED_RESULT");

      await $(diff.selector).$(id("open-task")).click();
      await waitForV4Pane((pane) => pane.sessionId === diff.taskId, "打开事项应定位原来的普通会话");
      await waitForV4AssistantMessageContaining("WA_B_ROUTED_RESULT");
      await sendV4Prompt(`${marker.takeover} Check a narrower sidebar too.`);
      await waitForV4AssistantMessageContaining("WA_B_TAKEOVER_RESULT");
      await openAssistant();
      await waitForText(diff.selector, "WA_B_TAKEOVER_RESULT");
      await waitForText(id("message"), "WA_GENERAL_ANSWER");
      await $(queue.selector).$(id("continue-task")).click();
      await submit(`${marker.followup} It reproduces with two online devices.`);
      await waitForText(id("message"), marker.followup);
    } finally {
      await releaseControlledReplay(queueGate);
    }

    await waitForText(queue.selector, "WA_A_FINAL_RESULT");
    if (process.env.ZCODE_E2E_ARTIFACT_DIR) {
      const dir = process.env.ZCODE_E2E_ARTIFACT_DIR;
      await browser.saveScreenshot(join(dir, "workspace-assistant-results-compact.png"));
      await setRendererViewport(1280, 800);
      try {
        await browser.saveScreenshot(join(dir, "workspace-assistant-results.png"));
      } finally {
        await clearRendererViewport();
      }
    }
    expect(await $$(id("item")).length).toBe(2);
    expect(
      await countUpstreamRequests({ includes: ["Workspace assistant router", marker.followup] }),
    ).toBe(0);
    expect(
      await countUpstreamRequests({
        includes: [marker.queue, marker.followup],
        excludes: [
          "Workspace assistant router",
          "Workspace assistant reporter",
          "Workspace assistant mailbox",
        ],
      }),
    ).toBe(1);
    expect(
      await countUpstreamRequests({
        includes: [marker.diff, marker.followup],
        excludes: [
          "Workspace assistant router",
          "Workspace assistant reporter",
          "Workspace assistant mailbox",
        ],
      }),
    ).toBe(0);

    await submit(`${marker.invalid} Investigate the last task.`);
    await waitForText(id("message"), marker.invalid);
    const retryButton = $(
      `//*[@data-testid="workspace-assistant-message" and @data-role="user" and contains(., "${marker.invalid}")]//button`,
    );
    await retryButton.waitForClickable();
    expect(await $$(id("item")).length).toBe(2);
    await retryButton.click();
    await waitForText(id("message"), "WA_RETRY_RECOVERED");
    const retryMessages = await $$(`${id("message")}[data-role="user"]`).map((node) =>
      node.getText(),
    );
    expect(retryMessages.filter((text) => text.includes(marker.invalid))).toHaveLength(1);

    const firstInputs = () =>
      countUpstreamRequests({
        excludes: [
          "Workspace assistant router",
          "Workspace assistant reporter",
          "Workspace assistant mailbox",
        ],
        lastUserMessageIncludes: [marker.queue],
        lastUserMessageExcludes: [marker.followup],
      });
    expect(await firstInputs()).toBe(1);
    await restartIntoWorkspacePreservingProfile(DEFAULT_WORKSPACE, {
      afterElectronProcessExit() {
        const { appDataDir, homeDir } = getE2EAppDataPaths();
        if (!basename(homeDir).startsWith(".e2e-home")) throw new Error("测试仅允许隔离 HOME");
        // 模拟 CLI 已接纳、Host 收到 ACK 前退出，只回退隔离测试库中 A 的结算标记。
        const db = new DatabaseSync(join(appDataDir, "tasks-index.sqlite"));
        try {
          const changed = db
            .prepare(
              "UPDATE workspace_assistant_inputs SET settled=0 WHERE assigned_id=? AND settled=1",
            )
            .run(queue.taskId);
          expect(changed.changes).toBe(1);
        } finally {
          db.close();
        }
      },
    });
    await openAssistant();
    await waitForText(id("message"), "WA_GENERAL_ANSWER");
    const cold = await itemByTitle("Diff investigation");
    await waitForText(cold.selector, "WA_B_TAKEOVER_RESULT");
    await $(cold.selector).$(id("continue-task")).click();
    await submit(`${marker.cold} Recheck the same diff task after restart.`);
    await waitForText(cold.selector, "WA_B_COLD_RESULT");
    const replay = $(
      `//*[@data-testid="workspace-assistant-message" and @data-role="user" and contains(., "${marker.queue}")]//button`,
    );
    await replay.waitForClickable();
    await replay.click();
    expect((await itemByTitle("Queue investigation")).taskId).toBe(queue.taskId);
    await waitForText(queue.selector, "WA_A_FINAL_RESULT");
    await waitForText((await itemByTitle("Diff investigation")).selector, "WA_B_COLD_RESULT");
    expect(await firstInputs()).toBe(1);
    expect(await $$(id("item")).length).toBe(2);
  });
});
