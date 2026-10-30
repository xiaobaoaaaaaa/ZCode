import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";
import {
  waitForSuccessfulToolCallByToolCallId,
  waitForToolCallBlockByToolName,
} from "../../../helpers/conversation-session-tool.js";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { expandAssistantHistoriesWithContent } from "../../../helpers/conversation-session-tool-diagnostics.js";

const marker = "E2E_SIDE_PANE_AGENT_BROWSER";
const bootstrapId = "toolu_spw_browser_bootstrap";
const actionId = "toolu_spw_browser_action";
let server: Server;
let url: string;
let loads = 0;
let ownerHandle: string;
async function approveOnce() {
  const option = await $('[role="listbox"] button[data-permission-option-kind="allowOnce"]');
  await option.waitForExist({ timeout: 30_000 });
  await option.click();
}

describe("SPW-005b Agent browser native window", () => {
  before(async () => {
    server = createServer((request, response) => {
      if (request.url === "/page") loads++;
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        `<!doctype html><title>Agent Browser Window</title><body style="background:#ebf4ff"><h1>Agent Browser Window</h1><label>Name <input id="name"></label><button onclick="document.querySelector('[role=status]').textContent='Submitted '+document.querySelector('input').value">Continue</button><div role="status">Ready</div><script>window.memoryToken=Math.random();</script></body>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture bind failed");
    url = `http://127.0.0.1:${address.port}/page`;
  });
  after(async () => {
    if (ownerHandle) await browser.switchToWindow(ownerHandle);
    await clearAppData();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("continues real Agent operations and explicit/turn-end screenshots on the same guest", async function () {
    this.timeout(240_000);
    await prepareV4ConversationE2E();
    ownerHandle = await browser.getWindowHandle();
    await sendV4Prompt(
      `${marker} E2E_BROWSER_FIXTURE_URL:${url} Open the fixture, fill the form, then take a screenshot after continuing.`,
    );
    await waitForToolCallBlockByToolName("mcp__node_repl__js", 90_000);
    await approveOnce();
    await waitForSuccessfulToolCallByToolCallId(
      bootstrapId,
      ["E2E_SPW_BROWSER_READY", "e2eBrowserTabId"],
      90_000,
    );
    const before = await browser.electron.execute(async (electron, target) => {
      const guest = electron.webContents
        .getAllWebContents()
        .find((contents) => contents.getType() === "webview" && contents.getURL() === target)!;
      return {
        id: guest.id,
        host: guest.hostWebContents?.id,
        token: await guest.executeJavaScript("window.memoryToken"),
        input: await guest.executeJavaScript("document.querySelector('input').value"),
      };
    }, url);
    expect(before.input).toBe("before move");
    const tab = await $('[data-side-pane-tab-id^="browser-use:"]');
    await tab.waitForExist();
    const tabId = await tab.getAttribute("data-side-pane-tab-id");
    await tab.click({ button: "right" });
    await $(
      '//*[@role="menuitem" and (contains(.,"移至独立窗口") or contains(.,"Move to New Window"))]',
    ).click();
    await browser.waitUntil(async () =>
      browser.execute(
        (id) =>
          document
            .querySelector(`[data-native-side-pane="${id}"]`)
            ?.getAttribute("data-side-pane-window-state") === "detached",
        tabId,
      ),
    );
    await approveOnce();
    await waitForSuccessfulToolCallByToolCallId(
      actionId,
      ["E2E_SPW_BROWSER_ACTION_DONE", "Submitted after move"],
      90_000,
    );
    await waitForV4AssistantMessageContaining("E2E_SPW_BROWSER_FINISHED");
    await waitForV4Pane((snapshot) => !snapshot.canStop, "browser turn did not finish", 90_000);
    const after = await browser.electron.execute(async (electron, id) => {
      const guest = electron.webContents.fromId(id)!;
      return {
        id: guest.id,
        host: guest.hostWebContents?.id,
        token: await guest.executeJavaScript("window.memoryToken"),
        input: await guest.executeJavaScript("document.querySelector('input').value"),
        status: await guest.executeJavaScript(
          "document.querySelector('[role=status]').textContent",
        ),
      };
    }, before.id);
    expect(after).toEqual({ ...before, input: "after move", status: "Submitted after move" });
    expect(loads).toBe(1);
    // 完成回合后过程进入“已工作”历史；缩略图需要滚入视口才会解码。
    await expandAssistantHistoriesWithContent();
    await $(`[data-testid="tool-summary-trigger-${actionId}"]`).click();
    const processImage = await $(
      `[data-tool-call-id="${actionId}"] [data-node-repl-image-gallery] img`,
    );
    await processImage.waitForExist();
    await processImage.scrollIntoView();
    await browser.waitUntil(
      async () =>
        browser.execute((toolId) => {
          const image = document.querySelector<HTMLImageElement>(
            `[data-tool-call-id="${toolId}"] [data-node-repl-image-gallery] img`,
          );
          return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        }, actionId),
      { timeout: 30_000 },
    );
    // 自动轮尾图有独立的合成 tool id，但必须显示在最终正文后、工作历史外。
    await browser
      .waitUntil(
        async () =>
          browser.execute((toolId) => {
            const finalRow = [...document.querySelectorAll<HTMLElement>("[data-row-id]")].find(
              (row) => row.innerText === "E2E_SPW_BROWSER_FINISHED",
            );
            const image = [
              ...document.querySelectorAll<HTMLImageElement>(
                '[data-row-id] img[src^="data:image/png"]',
              ),
            ].find(
              (image) =>
                image.closest("[data-tool-call-id]")?.getAttribute("data-tool-call-id") !==
                  toolId &&
                !image.closest(
                  '[data-testid^="chat-assistant-history-content"], [data-execution-activity]',
                ) &&
                finalRow &&
                Boolean(finalRow.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING),
            );
            image?.scrollIntoView({ block: "center" });
            return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
          }, actionId),
        {
          timeout: 15_000,
          timeoutMsg: "Detached browser turn-end screenshot missing or undecodable",
        },
      )
      .catch(async (error: unknown) => {
        const facts = await browser.execute(() => ({
          images: [...document.images].map((image) => ({
            source: image.src.slice(0, 100),
            loaded: image.naturalWidth,
            tool: image.closest("[data-tool-call-id]")?.getAttribute("data-tool-call-id"),
          })),
          rows: [...document.querySelectorAll<HTMLElement>("[data-row-id]")].map((row) => ({
            id: row.dataset.rowId,
            text: row.innerText.slice(-180),
          })),
        }));
        throw new Error(`${String(error)}; ${JSON.stringify(facts)}`);
      });
    const finalImage = await browser.execute(
      (toolId) =>
        [
          ...document.querySelectorAll<HTMLImageElement>(
            '[data-row-id] img[src^="data:image/png"]',
          ),
        ].find(
          (image) =>
            image.closest("[data-tool-call-id]")?.getAttribute("data-tool-call-id") !== toolId,
        )!.src,
      actionId,
    );
    await writeFile(
      join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "agent-browser-turn-end.png"),
      Buffer.from(finalImage.split(",")[1]!, "base64"),
    );
    await tab.click({ button: "right" });
    await $(
      '//*[@role="menuitem" and (contains(.,"收回侧栏") or contains(.,"Move Back to Sidebar"))]',
    ).click();
    await browser.waitUntil(async () =>
      browser.execute(
        (id) =>
          document
            .querySelector(`[data-native-side-pane="${id}"]`)
            ?.getAttribute("data-side-pane-window-state") === "docked",
        tabId,
      ),
    );
    expect(
      await browser.electron.execute(
        async (electron, id) =>
          electron.webContents.fromId(id)!.executeJavaScript("window.memoryToken"),
        before.id,
      ),
    ).toBe(before.token);
  });
});
