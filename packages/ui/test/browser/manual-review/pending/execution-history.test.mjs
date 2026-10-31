// EA-HISTORY-01：完成态各入口的真实组件交互；运行到完成的链路由 Electron E2E 验证。
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
const entry = "/packages/ui/test/browser/manual-review/pending/execution-history.fixture.tsx";
const artifacts = join(root, "packages/desktop/.e2e-artifacts/execution-history");
let server, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    cacheDir: join(artifacts, "vite-cache"),
    plugins: [
      {
        name: "execution-history-fixture",
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
  for (const theme of ["light", "dark"])
    for (const mode of ["main", "background", "timeline"]) {
      test(
        `EA-HISTORY-01 ${mode}/${mobile ? "mobile" : "desktop"}/${theme}`,
        { timeout: 60000 },
        async () => {
          const page = await browser.newPage({
            viewport: { width: mobile ? 390 : 1200, height: 900 },
            isMobile: mobile,
            hasTouch: mobile,
          });
          const errors = [];
          page.on("pageerror", (error) => errors.push(String(error)));
          try {
            await page.goto(`${origin}fixture?mobile=${mobile}&theme=${theme}&mode=${mode}`);
            await page.getByText("E2E_FINAL_REPLY", { exact: true }).waitFor();
            const history = page.locator('[data-testid^="chat-assistant-history-trigger"]');
            if (mode !== "timeline") {
              await history.waitFor();
              if ((await history.getAttribute("aria-expanded")) !== "true") await history.click();
            }
            const trigger = page.getByTestId("execution-activity-trigger");
            await trigger.waitFor({ timeout: 10000 });
            assert.equal(await trigger.count(), 1, "连续的思考与成功工具应合并");
            assert.equal(await trigger.getAttribute("aria-expanded"), "false");
            assert.equal(await page.locator('[data-tool-call-id="history-bash"]').count(), 0);
            assert.equal(await page.locator('[data-tool-call-id="history-error"]').count(), 1);
            assert.equal(
              await page
                .locator('[data-execution-activity] [data-tool-call-id="history-error"]')
                .count(),
              0,
            );
            assert.equal(
              await page.locator("[data-execution-activity]").getByText("E2E_FINAL_REPLY").count(),
              0,
            );
            await trigger.click();
            await page.locator('[data-tool-call-id="history-bash"]').waitFor();
            await page.getByRole("button", { name: "Append", exact: true }).click();
            await page.locator('[data-tool-call-id="history-read"]').waitFor();
            assert.equal(await trigger.getAttribute("aria-expanded"), "true");
            // Radix 内容挂载早于高度动画结束；截图和溢出检查必须等真实布局稳定。
            await page.waitForFunction(() =>
              document.getAnimations().every((animation) => animation.playState !== "running"),
            );
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              true,
            );
            await page.screenshot({
              path: join(artifacts, `${mode}-${mobile}-${theme}-expanded.png`),
            });
            await trigger.click();
            await page.locator('[data-tool-call-id="history-bash"]').waitFor({ state: "detached" });
            await page.waitForFunction(() =>
              document.getAnimations().every((animation) => animation.playState !== "running"),
            );
            await page.screenshot({
              path: join(artifacts, `${mode}-${mobile}-${theme}-collapsed.png`),
            });
            assert.deepEqual(errors, []);
          } finally {
            await page.close();
          }
        },
      );
    }
