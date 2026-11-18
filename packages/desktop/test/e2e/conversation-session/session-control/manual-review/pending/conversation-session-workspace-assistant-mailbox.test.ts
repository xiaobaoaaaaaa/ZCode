import { clearAppData } from "#e2e/helpers/desktop-app";
import { waitForControlledReplay, releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import {
  countUpstreamRequests,
  waitForUpstreamRequest,
} from "#e2e/helpers/conversation-session-network";
import {
  prepareV4ConversationE2E,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "#e2e/helpers/v4-conversation";
import {
  assistantSelector as id,
  itemByTitle,
  openAssistant,
  submit,
  waitForText,
} from "#e2e/helpers/workspace-assistant";

describe("Workspace assistant delegated messages", () => {
  after(async () => clearAppData());

  it("receives a real worker question, hands off a dependency and returns the assistant's reply", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E();
    await openAssistant();
    await submit("E2E_WA5_SOURCE Research the release notes.");
    const source = await itemByTitle("Release note research");
    let targetId: string;
    await waitForControlledReplay("wa5-source-gate");
    try {
      await submit(
        "E2E_WA5_CONSUMER Prepare a review checklist using the other worker's findings.",
      );
      const target = await itemByTitle("Review checklist");
      targetId = target.taskId;
      expect(target.taskId).not.toBe(source.taskId);
      await waitForUpstreamRequest(
        {
          includes: [
            "Workspace assistant mailbox",
            "E2E_WA5_NEED_SOURCE",
            source.taskId,
            target.taskId,
          ],
        },
        "任务消息没有携带可信来源和依赖范围进入助手",
      );
      await waitForText(target.selector, "WA5_WAIT_ACK");
      await $(target.selector).$(id("open-task")).click();
      await waitForV4Pane((pane) => pane.sessionId === target.taskId, "未进入真正的依赖方会话");
      await waitForV4AssistantMessageContaining("WA5_WAIT_ACK");
    } finally {
      await releaseControlledReplay("wa5-source-gate");
    }
    await waitForV4AssistantMessageContaining("E2E_WA5_FINAL_CONSUMER_RESULT", 90_000);
    await openAssistant();
    const message = (taskId: string, kind: string) =>
      `${id("message")}[data-task-id="${taskId}"][data-kind="${kind}"]`;
    await waitForText(message(source.taskId, "report"), "E2E_WA5_SOURCE_SUMMARY");
    await waitForText(message(targetId, "worker"), "E2E_WA5_PROGRESS");
    await waitForText(message(targetId, "report"), "WA5_FINAL_SUMMARY");
    const nonWorker = [
      "Workspace assistant reporter",
      "Workspace assistant mailbox",
      "Workspace assistant router",
      "Workspace assistant dependency",
    ];
    await waitForUpstreamRequest(
      {
        includes: [
          "Workspace assistant dependency",
          "E2E_WA5_NEED_SOURCE",
          source.taskId,
          targetId,
          "E2E_WA5_SOURCE_FINDING",
          "E2E_WA5_SOURCE_SUMMARY",
        ],
      },
      "定向答复没有使用目标问题和来源的原始结果",
    );
    for (const answer of ["E2E_WA5_DEPENDENCY_ANSWER", "E2E_WA5_DIRECT_ANSWER"]) {
      expect(
        await countUpstreamRequests({
          lastUserMessageIncludes: ["[Workspace assistant reply]", answer],
          excludes: nonWorker,
        }),
      ).toBeGreaterThan(0);
    }
    expect(
      await countUpstreamRequests({
        lastUserMessageIncludes: ["[Workspace assistant reply]", "E2E_WA5_PROGRESS"],
        excludes: nonWorker,
      }),
    ).toBe(0);
    expect(await $(source.selector).getText()).not.toContain("E2E_WA5_FINAL_CONSUMER_RESULT");
  });
});
