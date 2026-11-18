import { clearAppData } from "#e2e/helpers/desktop-app";
import { waitForUpstreamRequest } from "#e2e/helpers/conversation-session-network";
import {
  prepareV4ConversationE2E,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "#e2e/helpers/v4-conversation";
import {
  assistantSelector as id,
  openAssistant,
  submit,
  waitForText,
  itemByTitle,
} from "#e2e/helpers/workspace-assistant";

describe("Workspace assistant worker attention", () => {
  after(async () => clearAppData());

  it("shows a waiting worker, accepts the user's answer in its original session and returns the result", async function () {
    this.timeout(150_000);
    await prepareV4ConversationE2E();
    await openAssistant();
    await submit("E2E_WA_ATTENTION Investigate the API and ask which environment to check.");
    const worker = await itemByTitle("API investigation");
    const status = $(worker.selector).$(id("status"));
    await browser.waitUntil(
      async () => ["需要处理", "Needs attention"].includes(await status.getText()),
      {
        timeout: 45_000,
        timeoutMsg: "待答复的问题没有显示为需要处理",
      },
    );
    await $(worker.selector).$(id("open-task")).click();
    await waitForV4Pane((pane) => pane.sessionId === worker.taskId, "未进入原任务");
    await waitForText(
      '[data-elicitation-dialog-body="true"]',
      "Which environment should be checked?",
    );
    const answer = $('[data-elicitation-dialog-body="true"] textarea');
    await answer.click();
    await answer.setValue("E2E_WA_HUMAN_ANSWER Test the staging environment.");
    await browser.keys("Enter");
    await waitForUpstreamRequest(
      { includes: ["toolu_wa_worker_question", "E2E_WA_HUMAN_ANSWER"] },
      "原任务没有收到用户提交的回答",
    );
    await waitForV4AssistantMessageContaining("WA_HUMAN_CONFIRMED");
    await openAssistant();
    await waitForText(worker.selector, "WA_HUMAN_CONFIRMED");
    expect(await status.getText()).toMatch(/已完成|Completed/u);
  });
});
