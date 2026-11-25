import { TID_V4_COMPOSER_INPUT } from "@zcode/shared/test-ids";
import { clearAppData } from "#e2e/helpers/desktop-app";
import { clearRendererViewport, setRendererViewport } from "#e2e/helpers/renderer-viewport";
import { prepareV4ConversationE2E, setV4ComposerText } from "#e2e/helpers/v4-conversation";

describe("展开底部输入框", () => {
  before(async () => {
    await prepareV4ConversationE2E({ skipProvider: true });
  });
  after(async () => {
    await clearRendererViewport();
    await clearAppData();
  });

  it("展开和收起长草稿时保留正文、选区及编辑焦点", async () => {
    await setRendererViewport(1280, 800);
    const draft = Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 行测试正文`).join("\n");
    await setV4ComposerText(draft);
    const input = $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`);
    const toggle = $('[data-testid="composer-input-expansion"]');
    await input.click();
    await browser.keys(["Control", "Home"]);
    await browser.keys(["Shift", "ArrowRight"]);

    const snapshot = () =>
      browser.execute((id) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        return {
          height: el.clientHeight,
          scrollable: el.scrollHeight > el.clientHeight,
          text: el.innerText,
          selection: window.getSelection()?.toString(),
          focused: document.activeElement === el,
        };
      }, TID_V4_COMPOSER_INPUT);
    const compact = await snapshot();
    expect(compact.scrollable).toBe(true);
    expect(compact.selection).toBeTruthy();
    expect(compact.focused).toBe(true);
    expect(await toggle.getAttribute("aria-expanded")).toBe("false");

    await toggle.click();
    const expanded = await snapshot();
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
    expect(expanded.height).toBeGreaterThan(compact.height);
    expect(expanded).toEqual({ ...compact, height: expanded.height });
    await setRendererViewport(800, 600);
    const resized = await snapshot();
    expect(resized.height).toBeLessThan(expanded.height);
    expect(resized.height).toBeGreaterThan(compact.height);

    await toggle.click();
    expect(await snapshot()).toEqual(compact);
    await browser.keys("Tab");
    expect(await toggle.isFocused()).toBe(true);
    await browser.keys("Enter");
    expect(await toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
