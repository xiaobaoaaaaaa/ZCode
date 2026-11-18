import { join } from "node:path";
import { Key } from "webdriverio";
import { getUpstreamRequestEvidence } from "#e2e/helpers/conversation-session-network";
import { clearAppData, DEFAULT_WORKSPACE } from "#e2e/helpers/desktop-app";
import { restartIntoWorkspacePreservingProfile } from "#e2e/helpers/model-provider-restart-runtime";
import {
  prepareV4ConversationE2E,
  switchV4Mode,
  sendV4Prompt,
  getV4ModelConfig,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "#e2e/helpers/v4-conversation";
import { setRendererViewport, clearRendererViewport } from "#e2e/helpers/renderer-viewport";
import {
  assistantSelector as id,
  openAssistant,
  submit,
  itemByTitle,
  waitForText,
} from "#e2e/helpers/workspace-assistant";
import {
  selectUpstreamModelById,
  selectUpstreamThoughtLevelValue,
  UPSTREAM_SECONDARY_MODEL,
} from "#e2e/helpers/upstream-provider";
import {
  TID_CHAT_MODE_SELECT_ITEM,
  TID_CHAT_MODE_SELECT_TRIGGER,
  TID_CHAT_REASONING_TRIGGER,
  TID_CHAT_REASONING_CONTENT,
  testId,
} from "@zcode/shared/test-ids";

const tid = (value: string) => `[data-testid="${value}"]`;
describe("Workspace assistant composer", () => {
  after(async () => {
    await clearRendererViewport();
    await clearAppData();
  });

  it("defaults to guarded, persists confirmed choices and preserves existing worker permissions", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E();
    await setRendererViewport(1280, 800);
    await switchV4Mode("build");
    await sendV4Prompt("E2E_WA6_ORDINARY_BUILD Record a recent normal submission.");
    await waitForV4AssistantMessageContaining("WA6_RECENT_MODE");
    await openAssistant();
    await $(id("controls")).waitForDisplayed();
    const plan = $(id("controls")).$(tid("v4-composer-plan-marker"));
    await plan.waitForDisplayed();
    expect(await plan.getText()).toMatch(/计划|plan/i);
    expect(await plan.$$("button").length).toBe(0);
    const modeSelector = `${id("controls")} ${tid(TID_CHAT_MODE_SELECT_TRIGGER)}`;
    const mode = $(modeSelector);
    await browser.waitUntil(async () => /自主模式|guarded/i.test(await mode.getText()), {
      timeoutMsg: "普通会话最近提交使用 build，但助手新委托缺省应为 guarded",
    });
    const pickYolo = async () => {
      await mode.click();
      await $(tid(testId(TID_CHAT_MODE_SELECT_ITEM, "yolo"))).click();
      await $(tid("yolo-confirmation-dialog")).waitForDisplayed();
    };
    await pickYolo();
    await $(tid("yolo-confirmation-cancel")).click();
    expect(await mode.getText()).toMatch(/自主模式|guarded/i);
    await pickYolo();
    expect(await $(tid("yolo-confirmation-confirm")).isEnabled()).toBe(false);
    await $(tid("yolo-confirmation-risk")).click();
    await $(tid("yolo-confirmation-confirm")).click();
    await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL);
    await selectUpstreamThoughtLevelValue("max");

    await submit("E2E_WA6_SETTINGS Inspect this workspace with my selected model.");
    const item = await itemByTitle("Settings verification");
    await waitForText(item.selector, "WA6_WORKER_CONFIGURED");
    await $(tid(TID_CHAT_REASONING_TRIGGER)).click();
    await waitForText(tid(TID_CHAT_REASONING_CONTENT), "WA6_MODEL_REASONING");
    const evidence = await getUpstreamRequestEvidence({ includes: ["E2E_WA6_SETTINGS"] });
    for (const fixtureId of ["wa6-selected-router", "wa6-created-task"]) {
      const request = evidence.find((entry) => entry.fixtureId === fixtureId);
      expect(request?.requestJson).toMatchObject({
        model: UPSTREAM_SECONDARY_MODEL,
        output_config: { effort: "max" },
      });
    }
    const artifactDir = process.env.ZCODE_E2E_ARTIFACT_DIR;
    if (artifactDir) {
      await browser.execute(async (selector) => {
        const content = document.querySelector(selector);
        await Promise.all(
          content?.getAnimations({ subtree: true }).map((animation) => animation.finished) ?? [],
        );
      }, tid(TID_CHAT_REASONING_CONTENT));
      await browser.saveScreenshot(join(artifactDir, "workspace-assistant-composer.png"));
    }
    const waitForSelectedConfig = () =>
      browser.waitUntil(
        async () => {
          const config = await getV4ModelConfig();
          return (
            config.mode === "yolo" &&
            config.model === UPSTREAM_SECONDARY_MODEL &&
            config.thought === "max"
          );
        },
        { timeoutMsg: "权限、模型和思考档位没有保留" },
      );
    await $(item.selector).$(id("open-task")).click();
    await waitForV4Pane((pane) => pane.sessionId === item.taskId, "助手没有打开委托的普通任务");
    await waitForSelectedConfig();
    await restartIntoWorkspacePreservingProfile(DEFAULT_WORKSPACE);
    await setRendererViewport(1280, 800);
    await openAssistant();
    await waitForSelectedConfig();
    // 修改今后委托的默认权限，再从这条任务回报定向跟进原会话。
    await $(modeSelector).click();
    await $(tid(testId(TID_CHAT_MODE_SELECT_ITEM, "guarded"))).click();
    const report = `${id("message")}[data-kind="report"][data-task-id="${item.taskId}"]`;
    await waitForText(report, "WA6_SETTINGS_SUMMARY");
    expect(await $(report).$$(tid(TID_CHAT_REASONING_TRIGGER)).length).toBe(0);
    await $(report).$(id("message-continue")).click();
    const input = $(id("input"));
    await input.click();
    await browser.keys("E2E_WA6_EXISTING");
    await browser
      .action("key")
      .down(Key.Shift)
      .down(Key.Enter)
      .up(Key.Enter)
      .up(Key.Shift)
      .perform();
    await browser.keys("Keep the existing configuration.");
    const draft = "E2E_WA6_EXISTING\nKeep the existing configuration.";
    const editorText = () =>
      browser.execute(
        (selector) => document.querySelector<HTMLElement>(selector)?.innerText,
        id("input"),
      );
    expect(await editorText()).toBe(draft);
    await $(item.selector).$(id("open-task")).click();
    await waitForV4Pane((pane) => pane.sessionId === item.taskId, "未进入已有关联任务");
    await openAssistant();
    await browser.waitUntil(async () => (await editorText()) === draft, {
      timeout: 10_000,
      timeoutMsg: "重入助手后多行草稿没有恢复",
    });
    await $(id("input")).click();
    await browser.keys(Key.Enter);
    await waitForText(item.selector, "WA6_EXISTING_KEPT");
    expect(
      await getUpstreamRequestEvidence({
        includes: ["Workspace assistant router", "E2E_WA6_EXISTING"],
      }),
    ).toHaveLength(0);
    await $(item.selector).$(id("open-task")).click();
    await waitForV4Pane((pane) => pane.sessionId === item.taskId, "未返回被跟进的原任务");
    await waitForSelectedConfig();
  });
});
