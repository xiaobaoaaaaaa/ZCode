export const assistantSelector = (name: string) => `[data-testid="workspace-assistant-${name}"]`;

export async function openAssistant() {
  const entry = $(assistantSelector("open"));
  await entry.waitForClickable();
  await entry.click();
  await $(assistantSelector("page")).waitForDisplayed();
}

export async function submit(text: string) {
  const input = $(assistantSelector("input"));
  await input.waitForEnabled();
  await input.setValue(text);
  const button = $(assistantSelector("send"));
  await button.waitForClickable();
  await button.click();
}

export async function waitForText(selector: string, text: string) {
  await browser.waitUntil(
    async () =>
      (await $$(selector).map((element) => element.getText())).some((value) =>
        value.includes(text),
      ),
    { timeout: 60_000, timeoutMsg: `助手未在 ${selector} 显示 ${text}` },
  );
}

export async function itemByTitle(title: string) {
  await waitForText(assistantSelector("item"), title);
  const items = await $$(assistantSelector("item")).getElements();
  for (const row of items) {
    if ((await row.getText()).includes(title)) {
      const taskId = await row.getAttribute("data-task-id");
      if (!taskId) throw new Error(`工作项缺少任务引用: ${title}`);
      return { taskId, selector: `${assistantSelector("item")}[data-task-id="${taskId}"]` };
    }
  }
  throw new Error(`工作项未找到: ${title}`);
}
