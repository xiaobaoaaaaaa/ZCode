import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, after, test } from "node:test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/settings-search/search.fixture.tsx";
const artifacts = join(tmpdir(), "zcode-settings-search-browser");
let server, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "settings-search-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});
for (const [width, locale, theme] of [
  [390, "zh-CN", "light"],
  [390, "en-US", "dark"],
  [1280, "en-US", "light"],
  [1280, "zh-CN", "dark"],
]) {
  test(`SGS01–06 ${width}/${locale}/${theme}`, { timeout: 120000 }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${origin}fixture?locale=${locale}&theme=${theme}`);
      const trigger = page.getByTestId("settings-global-search-trigger");
      await trigger.click();
      const dialogBounds = await page.getByRole("dialog").boundingBox();
      assert.ok(dialogBounds && dialogBounds.width <= Math.min(width - 32, 576));
      const input = page.getByRole("combobox");
      await input.fill("no-such-setting-xyz");
      await page
        .getByText(locale === "zh-CN" ? "未找到匹配的设置" : "No matching settings")
        .waitFor();
      await page
        .getByRole("button", { name: locale === "zh-CN" ? "清空搜索" : "Clear search" })
        .click();
      assert.equal(await input.inputValue(), "");
      await input.fill("font");
      await page.getByRole("option").first().waitFor();
      await page.screenshot({ path: `${artifacts}/${width}-${locale}-${theme}-results.png` });
      // 精确标题命中第一项，使用真实键盘 Enter 选择，避免绕过 cmdk 的选中状态。
      await input.fill(locale === "zh-CN" ? "界面字号" : "UI font size");
      // 标签取真实索引结果，此 fixture 不替换搜索或目标内容组件。
      const targetOption = page.locator('[cmdk-item][data-value="settings.uiFontSize"]');
      await targetOption.waitFor();
      await input.press("ArrowDown");
      await input.press("ArrowUp");
      await input.press("Enter");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const target = page.locator('[data-settings-search-id="settings.uiFontSize"]');
      await target.waitFor();
      assert.equal(await target.getAttribute("data-settings-search-highlight"), "true");
      assert.equal(await target.evaluate((el) => document.activeElement === el), true);
      assert.equal(await page.locator("main").getAttribute("data-writes"), "0");
      await page.screenshot({ path: `${artifacts}/${width}-${locale}-${theme}-target.png` });
      await trigger.click();
      assert.equal(await input.inputValue(), "");
      await input.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
}
