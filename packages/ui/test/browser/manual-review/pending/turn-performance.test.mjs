// PERF04/PERF05：真实 ConversationTurnGroup 的桌面/手机布局与键盘、触屏交互。
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/turn-performance.fixture.tsx";
const artifacts = join(root, "packages/desktop/.e2e-artifacts/turn-performance");
let server, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      {
        name: "hook-footer-fixture",
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
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      watch: { ignored: ["**/packages/desktop/out/**", "**/.e2e-artifacts/**"] },
    },
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

for (const mobile of [false, true])
  for (const theme of ["light", "dark"]) {
    test(`PERF04/PERF05 ${mobile ? "mobile" : "desktop"}/${theme}`, async () => {
      const page = await browser.newPage({
        viewport: { width: mobile ? 390 : 1200, height: 800 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      try {
        const url = `${origin}fixture?mobile=${mobile}&theme=${theme}`;
        await page.goto(url);
        const trigger = page.getByTestId("turn-performance-performance-footer");
        await trigger.waitFor({ state: "visible" });
        assert.match(await trigger.innerText(), /50 tok\/s/);
        await trigger.focus();
        await page.keyboard.press("Enter");
        const panel = page.getByTestId("turn-performance-details-performance-footer");
        await panel.waitFor({ state: "visible" });
        assert.match(await panel.innerText(), /1 s/);
        assert.match(await panel.innerText(), /1,200/);
        assert.match(await panel.innerText(), /—/);
        const bounds = await panel.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (mobile ? 390 : 1200));
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 800);
        await page.screenshot({
          path: join(artifacts, `${mobile ? "mobile" : "desktop"}-${theme}-details.png`),
        });
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
        await page.screenshot({
          path: join(artifacts, `${mobile ? "mobile" : "desktop"}-${theme}-summary.png`),
        });
        await page.goto(`${url}&running=true`);
        await trigger.waitFor({ state: "visible" });
        assert.match(await trigger.innerText(), mobile ? /This turn \(\d+ completed\)/ : /本轮（已完成 \d+ 请求）/);
        await trigger.click();
        await panel.waitFor({ state: "visible" });
        await page.mouse.click(5, 5);
        await panel.waitFor({ state: "hidden" });
        await page.goto(`${url}&missing=true`);
        await trigger.waitFor({ state: "visible" });
        assert.doesNotMatch(await trigger.innerText(), /tok\/s/);
        await page.goto(`${url}&empty=true`);
        await trigger.waitFor({ state: "visible" });
        assert.match(await trigger.innerText(), /50 tok\/s/);
        await page.goto(`${url}&legacy=true`);
        await page.locator('[data-turn-id="performance-footer"]').waitFor();
        assert.equal(await trigger.count(), 0);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
