import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveE2ERuntimePath } from "#e2e/helpers/e2e-runtime-paths";
import { waitForControlledReplay, releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_MEMORY_SWITCH,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  getLatestUpstreamToolResultByToolCallId,
  getUpstreamRequestEvidence,
  readUpstreamToolResultFromRequest,
} from "#e2e/helpers/conversation-session-network";
import {
  clearAppData,
  clickTestIdByDom,
  DEFAULT_WORKSPACE,
  readSettings,
  seedCliConfig,
} from "#e2e/helpers/desktop-app";
import { resolveE2EProjectMemoryRoot } from "#e2e/helpers/project-memory";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import {
  assistantSelector as id,
  openAssistant,
  submit,
  waitForText,
} from "#e2e/helpers/workspace-assistant";

const file = "release-check.txt";
const memory = "release-gate.md";
const projectMemory = resolveE2EProjectMemoryRoot(DEFAULT_WORKSPACE);
const indexPath = join(projectMemory, "MEMORY.md");
const sources = [
  {
    path: resolveE2ERuntimePath(file),
    prompt: "E2E_WA7_FILE Find the workspace release-check file and read which channel it lists.",
    fact: "canary-7842",
    callId: "toolu_wa7_file",
  },
  {
    path: join(projectMemory, memory),
    prompt: `E2E_WA7_MEMORY For that same channel, which sign-off is recorded in project memory ${memory}?`,
    fact: "release-board-3926",
    callId: "toolu_wa7_memory",
  },
];

describe("Workspace assistant read-only answers", () => {
  after(async () => {
    for (const source of sources) await rm(source.path, { force: true });
    await rm(indexPath, { force: true });
    await clearAppData();
  });

  it("reads separate workspace and project-memory evidence before answering directly", async function () {
    this.timeout(180_000);
    await seedCliConfig({ features: { memory: true }, memory: { use: true } });
    await prepareV4ConversationE2E();
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "memory"));
    const toggle = $(`[data-testid="${TID_SETTINGS_MEMORY_SWITCH}"]`);
    await toggle.waitForDisplayed();
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await browser.waitUntil(async () => (await readSettings()).memoryEnabled === true, {
      timeoutMsg: "工作区的项目记忆设置没有保存",
    });
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    await prepareV4ConversationE2E();
    for (const source of sources) {
      await mkdir(dirname(source.path), { recursive: true });
      await writeFile(source.path, `Release record: ${source.fact}\n`, "utf8");
    }
    await writeFile(
      indexPath,
      `- [Release sign-off](${memory}) — required release confirmation.\n`,
      "utf8",
    );
    await openAssistant();
    for (const source of sources) {
      await submit(source.prompt);
      if (source.callId === "toolu_wa7_file") {
        await waitForControlledReplay("wa7-file-answer");
        try {
          const activity = `${id("live-reply")} ${id("tool-activity")}[data-tool-name="Read"][data-tool-status="completed"]`;
          await $(activity).waitForDisplayed({ timeout: 15_000 });
          expect(await $(activity).getText()).toContain("Read");
          expect(await $$(`${id("message")}[data-role="assistant"]`).length).toBe(0);
        } finally {
          await releaseControlledReplay("wa7-file-answer");
        }
      }
      await waitForText(`${id("message")}[data-role="assistant"]`, source.fact);
      const tool = await getLatestUpstreamToolResultByToolCallId(source.callId);
      expect(tool?.isError).toBe(false);
      expect(tool?.content).toContain(source.fact);
      expect(await $$(id("item")).length).toBe(0);
    }
    const requests = await getUpstreamRequestEvidence({ includes: ["Workspace assistant router"] });
    expect(requests.map((entry) => entry.fixtureId)).toEqual([
      "wa7-find-file",
      "wa7-file-read",
      "wa7-file-answer",
      "wa7-memory-read",
      "wa7-memory-answer",
    ]);
    const found = await getLatestUpstreamToolResultByToolCallId("toolu_wa7_glob");
    expect(found?.isError).toBe(false);
    expect(found?.content).toContain(file);
    const nextTurn = requests.find((entry) => entry.fixtureId === "wa7-memory-read");
    expect(
      readUpstreamToolResultFromRequest(nextTurn?.requestJson, "toolu_wa7_file")?.content,
    ).toContain("canary-7842");
  });
});
