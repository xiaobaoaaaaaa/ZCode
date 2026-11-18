import { clearAppData } from "#e2e/helpers/desktop-app";
import {
  countUpstreamRequests,
  getUpstreamRequestEvidence,
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

const request =
  "E2E_WA9_BATCH Delegate two separate tasks: inspect formatting and check translations.";
const tasks = [
  {
    title: "Format check",
    taskPrompt: "E2E_WA9_FORMAT",
    result: "WA9_FORMAT_RESULT",
    report: "WA9_FORMAT_REPORT",
  },
  {
    title: "Translation check",
    taskPrompt: "E2E_WA9_LOCALE",
    result: "WA9_LOCALE_RESULT",
    report: "WA9_LOCALE_REPORT",
  },
];

describe("Workspace assistant batch delegation", () => {
  after(async () => clearAppData());
  it("creates two independently accessible workers from one request and reports both results", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E();
    await openAssistant();
    await submit(request);
    const final = `${id("message")}[data-kind="report"]:not([data-task-id])`;
    await waitForText(final, "WA9_BATCH_RESULT");
    const ids = new Set<string>();
    for (const task of tasks) {
      const item = await itemByTitle(task.title);
      ids.add(item.taskId);
      await waitForText(item.selector, task.result);
      await waitForText(
        `${id("message")}[data-kind="report"][data-task-id="${item.taskId}"]`,
        task.report,
      );
      await $(item.selector).$(id("open-task")).click();
      await waitForV4Pane((pane) => pane.sessionId === item.taskId, "未打开批量委托对应的原任务");
      await waitForV4AssistantMessageContaining(task.result);
      await openAssistant();
      const executions = await countUpstreamRequests({
        lastUserMessageIncludes: [task.taskPrompt],
        excludes: [
          "Workspace assistant router",
          "Workspace assistant reporter",
          "Workspace assistant batch reporter",
          "Workspace assistant dependency",
          "Workspace assistant mailbox",
        ],
      });
      expect(executions).toBe(1);
    }
    expect(ids.size).toBe(2);
    expect(await $$(id("item")).length).toBe(2);
    expect(await $$(final).length).toBe(1);
    const synthesis = await getUpstreamRequestEvidence({
      includes: [
        "Workspace assistant batch reporter",
        request,
        ...ids,
        ...tasks.flatMap((task) => [task.result, task.report]),
      ],
    });
    expect(synthesis.map((entry) => entry.fixtureId)).toEqual(["wa9-synthesize"]);
    const users = await $$(`${id("message")}[data-role="user"]`).map((node) => node.getText());
    expect(users).toHaveLength(1);
    expect(users[0]).toContain(request);
  });
});
