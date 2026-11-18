// M4 门禁：compact（v4 composer slash 命令 `/compact`）。
// 证据层 L3：首轮固定回复形成历史 → composer 输入 `/compact` → handleSendText 识别 slash →
// dispatchCommand("compact", baseRevision) → v4-bridge compactSession → CompactStarted/Completed
// 事件 → reducer onCompactLifecycle → timelineMarker compact/manual/success。
// 证明 slash 命令入口 + compact 全链路（命令面已桥接，仅补 UI 触发）。
import {
  TID_V4_COMPOSER_INPUT,
  TID_V4_MODEL_CONFIG,
  TID_V4_SESSION_PANE,
  TID_V4_TIMELINE,
  testId,
} from "@zcode/shared/test-ids";
import { clearAppData, setInputValueByTestIdDom } from "#e2e/helpers/desktop-app";
import {
  ensureUpstreamModelForE2E,
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  UPSTREAM_SECONDARY_MODEL,
} from "#e2e/helpers/upstream-provider";
import {
  clickV4Send,
  prepareV4ConversationE2E,
  selectV4ComposerModel,
  sendV4Prompt,
  waitForV4CompactMarker,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "#e2e/helpers/v4-conversation";

describe("v4 M4 门禁：compact（/compact slash）", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("SSC19/SSC37：主会话压缩后打开辅助对话，显示加载进度，时间线与模型独立", async () => {
    await prepareV4ConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);

    // 首轮：形成一段可被压缩的历史
    await sendV4Prompt("E2E_V4_COMPACT_SEED 请回复种子");
    await waitForV4TimelineContaining("V4_COMPACT_SEED_OK", 45000);
    await waitForV4Pane(
      (s) => !s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "首轮没有回到空闲态",
      45000,
    );

    // composer 输入 /compact slash 命令并发送（不走 sendText，走 compact 命令）
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/compact", {
      timeout: 15000,
      timeoutMsg: "composer 输入框没有出现",
    });
    await clickV4Send();

    // v4 投影产出结构化 marker；文案会随 locale 改变，不参与定位。
    await waitForV4CompactMarker({ origin: "manual", status: "success" }, 90000);

    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, "/btw");
    const sideCommand = $('[data-option-id="app-slash:btw"]');
    await sideCommand.waitForDisplayed();
    // SSC37：从真实点击前开始观察 DOM，即使本机创建快于 WebDriver 的轮询也能验证反馈。
    await browser.execute(() => {
      const seen = new Set<string>();
      const observer = new MutationObserver(() => {
        for (const status of document.querySelectorAll<HTMLElement>(
          "[role=status][data-side-chat-loading]",
        )) {
          const rect = status.getBoundingClientRect();
          if (
            status.textContent?.trim() &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight
          ) {
            seen.add(status.dataset.sideChatLoading!);
          }
        }
        document.body.dataset.e2eSideChatLoading = [...seen].join(",");
        if (seen.size === 2) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await sideCommand.click();
    // pane 先挂载再收到首份快照。等到有投影序号再读总行数，避免把加载中的空白当成通过。
    const sideSelector = `[data-testid^="${testId(TID_V4_SESSION_PANE, "selection-side-chat:")}"][data-projection-seq]:not([data-projection-seq=""])`;
    const sidePane = $(sideSelector);
    await sidePane.waitForDisplayed({ timeout: 30000 });
    await $("[data-side-chat-loading]").waitForExist({ reverse: true, timeout: 30000 });
    expect(await $("body").getAttribute("data-e2e-side-chat-loading")).toBe("opening,connecting");
    const timeline = sidePane.$(`[data-testid="${TID_V4_TIMELINE}"]`);
    expect(await timeline.getAttribute("data-total-row-count")).toBe("0");
    await waitForV4CompactMarker({ origin: "manual", status: "success" });
    expect(
      await sidePane.$(`[data-testid="${TID_V4_MODEL_CONFIG}"]`).getAttribute("data-model"),
    ).toBe(UPSTREAM_MODEL);
    await selectV4ComposerModel(UPSTREAM_PROVIDER_ID, UPSTREAM_SECONDARY_MODEL, sideSelector);
    const mainModel = $(
      `[data-testid="${testId(TID_V4_SESSION_PANE, "workspace-main")}"] [data-testid="${TID_V4_MODEL_CONFIG}"]`,
    );
    expect(await mainModel.getAttribute("data-model")).toBe(UPSTREAM_MODEL);
  });
});
