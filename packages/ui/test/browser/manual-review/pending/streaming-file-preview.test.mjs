import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/streaming-file-preview.fixture.tsx";
const artifacts = join(tmpdir(), "zcode-streaming-file-preview");
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
        name: "streaming-file-preview-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
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
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : { channel: "chrome" },
  );
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function atBottom(locator) {
  await locator
    .page()
    .waitForFunction(
      (el) =>
        el &&
        el.scrollHeight > el.clientHeight &&
        Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 2,
      await locator.elementHandle(),
    );
}
async function scrollUp(page, viewport) {
  await viewport.hover();
  const previous = await viewport.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, -140);
  await page.waitForFunction(({ el, previous }) => el.scrollTop < previous - 50, {
    el: await viewport.elementHandle(),
    previous,
  });
  // 等真实 scroll 派发及浏览器滚动完成后再记录阅读位置。
  await viewport.evaluate(
    (el) =>
      new Promise((resolve) => {
        let previous = el.scrollTop;
        const frame = () =>
          requestAnimationFrame(() => {
            if (el.scrollTop === previous) resolve();
            else {
              previous = el.scrollTop;
              frame();
            }
          });
        frame();
      }),
  );
  return viewport.evaluate((el) => el.scrollTop);
}

for (const width of [390, 1200])
  for (const theme of ["light", "dark"]) {
    test(`streaming file follow ${width} ${theme}`, async (t) => {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      t.after(() => page.close());
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `${origin}fixture?theme=${theme}&locale=${width === 390 ? "zh-CN" : "en-US"}`,
        // 首次导航包含 Vite 的依赖扫描和编译；交互断言仍使用默认等待边界。
        { waitUntil: "domcontentloaded", timeout: 120_000 },
      );
      await page.getByTestId("tool-summary-trigger-live").click();
      const live = page.getByTestId("live").locator("[data-inline-diff-preview]");
      await atBottom(live);
      await page.getByRole("button", { name: "append", exact: true }).click();
      await live.getByText('const line60 = "streamed file content";', { exact: true }).waitFor();
      await atBottom(live);
      const top = await scrollUp(page, live);
      await page.getByRole("button", { name: "append", exact: true }).click();
      await live.getByText('const line80 = "streamed file content";', { exact: true }).waitFor();
      assert.equal(await live.evaluate((el) => el.scrollTop), top);
      await live.focus();
      await page.keyboard.press("Control+End");
      await atBottom(live);
      await page.getByRole("button", { name: "large", exact: true }).click();
      await live.getByText('const line1000 = "streamed file content";', { exact: true }).waitFor();
      await atBottom(live);
      await page.getByRole("button", { name: "wrap", exact: true }).click();
      await atBottom(live);
      await scrollUp(page, live);
      await page.getByTestId("tool-summary-trigger-live").click();
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="live"] [data-inline-diff-preview]'),
      );
      await page.getByTestId("tool-summary-trigger-live").click();
      await atBottom(live);
      await page.getByTestId("tool-summary-trigger-multi").click();
      await page.getByTestId("tool-summary-trigger-multi:0").click();
      await page.getByTestId("tool-summary-trigger-multi:1").click();
      const files = page.getByTestId("multi").locator("[data-inline-diff-preview]");
      await atBottom(files.nth(0));
      await atBottom(files.nth(1));
      const firstTop = await scrollUp(page, files.nth(0));
      await page.getByRole("button", { name: "append", exact: true }).click();
      await files
        .nth(1)
        .getByText('const line1020 = "streamed file content";', { exact: true })
        .waitFor();
      await atBottom(files.nth(1));
      assert.equal(await files.nth(0).evaluate((el) => el.scrollTop), firstTop);
      await page
        .getByRole("button", { name: theme === "dark" ? "fail" : "finish", exact: true })
        .click();
      await live.getByText('const line1030 = "streamed file content";', { exact: true }).waitFor();
      await atBottom(live);
      assert.equal(await files.nth(0).evaluate((el) => el.scrollTop), firstTop);
      await page.getByTestId("tool-summary-trigger-history").click();
      const history = page.getByTestId("history").locator("[data-inline-diff-preview]");
      assert.equal(await history.evaluate((el) => el.scrollTop), 0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    });
  }
