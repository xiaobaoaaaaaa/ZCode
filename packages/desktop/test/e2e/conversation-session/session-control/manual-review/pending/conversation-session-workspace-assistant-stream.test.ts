import { join } from "node:path";
import { TID_CHAT_REASONING_CONTENT, TID_CHAT_REASONING_TRIGGER } from "@zcode/shared/test-ids";
import { clearAppData } from "#e2e/helpers/desktop-app";
import { releaseControlledReplay, waitForControlledReplay } from "#e2e/helpers/controlled-replay";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import { clearRendererViewport, setRendererViewport } from "#e2e/helpers/renderer-viewport";
import {
  assistantSelector as id,
  openAssistant,
  submit,
  waitForText,
} from "#e2e/helpers/workspace-assistant";

const reasoning = "WA8_CHECKING_CONTEXT";
const first = "WA8_FIRST_SENTENCE";
const last = "WA8_SECOND_SENTENCE";
const gate = "wa8-direct-stream";
const trigger = `[data-testid="${TID_CHAT_REASONING_TRIGGER}"]`;
const content = `[data-testid="${TID_CHAT_REASONING_CONTENT}"]`;

describe("Workspace assistant live replies", () => {
  after(async () => clearAppData());

  it("renders reasoning and the incomplete answer before the provider finishes, then keeps one reply", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E();
    await openAssistant();
    await submit("E2E_WA8_STREAM Explain what a project workspace is.");
    await waitForControlledReplay(gate);
    const live = id("live-reply");
    try {
      const section = $(live);
      const toggle = section.$(trigger);
      await section.waitForDisplayed();
      if ((await toggle.isExisting()) && !(await section.$(content).isDisplayed()))
        await toggle.click();
      await waitForText(live, reasoning);
      expect(await section.getText()).not.toContain(first);
    } finally {
      await releaseControlledReplay(gate);
    }
    await waitForControlledReplay(gate);
    try {
      await waitForText(live, first);
      const text = await $(live).getText();
      expect(text).not.toContain(last);
      expect(text).not.toContain('"kind"');
      expect(text).not.toContain('"text"');
      const buttons = await $$(`${id("message")}[data-role="user"] button`).map((button) =>
        button.getText(),
      );
      expect(buttons.filter((label) => /重试|retry/i.test(label))).toHaveLength(0);
      if (process.env.ZCODE_E2E_ARTIFACT_DIR) {
        await setRendererViewport(1280, 800);
        try {
          await browser.saveScreenshot(
            join(process.env.ZCODE_E2E_ARTIFACT_DIR, "workspace-assistant-stream.png"),
          );
        } finally {
          await clearRendererViewport();
        }
      }
    } finally {
      await releaseControlledReplay(gate);
    }
    const completed = `${id("message")}[data-role="assistant"]`;
    await waitForText(completed, `${first} ${last}`);
    await $(live).waitForExist({ reverse: true });
    expect(await $$(completed).length).toBe(1);
    const message = $(completed);
    if (!(await message.$(content).isDisplayed())) await message.$(trigger).click();
    await waitForText(`${completed} ${content}`, reasoning);
    const text = await message.getText();
    expect(text.split(reasoning)).toHaveLength(2);
    expect(text.split(first)).toHaveLength(2);
    expect(text.split(last)).toHaveLength(2);
    expect(await $$(id("item")).length).toBe(0);
  });
});
