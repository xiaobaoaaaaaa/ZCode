// TOS：使用真实 Timeline、失败 Tooltip 和选区菜单，不替换产品滚动逻辑。
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry =
  "/packages/ui/test/browser/manual-review/pending/conversation-overlay-stability.fixture.tsx";
const artifacts = join(root, "packages/desktop/.e2e-artifacts/conversation-overlay-stability");
let server, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      {
        name: "timeline-fixture",
        enforce: "pre",
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

const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const selectHistory = async (page) => {
  await page
    .getByTestId("v4-row-20003")
    .getByText("E2E_TOS_SELECTED_TEXT", { exact: true })
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page.locator("[data-conversation-selection-tooltip]").waitFor();
};

for (const mobile of [false, true])
  for (const theme of ["light", "dark"]) {
    test(`TOS01–03 ${mobile ? "mobile" : "desktop"}/${theme}`, { timeout: 90000 }, async () => {
      const page = await browser.newPage({
        viewport: { width: mobile ? 430 : 1200, height: 1000 },
        hasTouch: mobile,
        isMobile: mobile,
      });
      const errors = [];
      const evidence = {};
      page.on("pageerror", (error) => errors.push(String(error)));
      try {
        await page.goto(`${origin}fixture?theme=${theme}&mobile=${mobile}`);
        const timeline = page.getByTestId("v4-timeline");
        const failure = page.getByText("E2E_TOS_FAILED", { exact: true });
        const tooltip = page.locator('[data-slot="tooltip-content"]');
        const menu = page.locator("[data-conversation-selection-tooltip]");
        await failure.waitFor();
        await settle(page);
        await page.evaluate(() => {
          window.__scrollEvents = [];
          window.addEventListener(
            "scroll",
            (event) => {
              if (
                event.target instanceof HTMLElement &&
                event.target.dataset.testid === "v4-timeline"
              ) {
                window.__scrollEvents.push({
                  trusted: event.isTrusted,
                  top: event.target.scrollTop,
                });
              }
            },
            true,
          );
        });
        const geometry = () =>
          timeline.evaluate((e) => ({
            top: e.scrollTop,
            height: e.scrollHeight,
            viewport: e.clientHeight,
          }));
        evidence.before = await geometry();
        assert.equal(evidence.before.height, evidence.before.viewport, "前置：没有滚动空间");
        await failure.hover();
        await tooltip.waitFor();
        // 观察实际的一秒计时器；这段等待是被测行为，不是 UI 就绪等待。
        await page.waitForTimeout(2200);
        assert.notEqual(await tooltip.getAttribute("data-state"), "closed", "计时不能关闭失败浮层");
        for (const action of ["refresh", "stream", "stream"]) {
          await page.evaluate((name) => window.__overlayFixture[name](), action);
          await settle(page);
          assert.notEqual(
            await tooltip.getAttribute("data-state"),
            "closed",
            `${action} 不能关闭失败浮层`,
          );
        }
        evidence.after = await geometry();
        assert.deepEqual(evidence.after, evidence.before, "刷新期间没有几何位移");
        await page.screenshot({ path: join(artifacts, `${mobile}-${theme}-failure.png`) });
        await page.mouse.move(1, 1);
        await selectHistory(page);
        await page.waitForTimeout(2200);
        assert.equal(await menu.isVisible(), true, "计时不能关闭选区菜单");
        await page.evaluate(() => window.__overlayFixture.stream());
        await settle(page);
        assert.equal(await menu.isVisible(), true, "流式更新不能关闭选区菜单");
        evidence.scrollsBeforeUserAction = await page.evaluate(() => window.__scrollEvents);
        assert.deepEqual(evidence.scrollsBeforeUserAction, [], "内部同步不得冒充 DOM 滚动");
        await page.screenshot({ path: join(artifacts, `${mobile}-${theme}-selection.png`) });
        await menu.getByRole("button").last().click();
        assert.equal(await page.getByTestId("asked").textContent(), "E2E_TOS_SELECTED_TEXT");

        // 仅为真实滚动提供空间，保持被测浮层/正文在视口内，不改产品 handler。
        await timeline.evaluate((e) => {
          e.style.height = "240px";
          e.style.flex = "none";
          e.scrollTop = 0;
        });
        await settle(page);
        await failure.hover();
        await tooltip.waitFor();
        await timeline.evaluate((e) => {
          e.scrollTop += 40;
        });
        await tooltip.waitFor({ state: "hidden" });
        await page.mouse.move(1, 1);
        await page
          .getByTestId("v4-row-20003")
          .getByText("E2E_TOS_SELECTED_TEXT", { exact: true })
          .scrollIntoViewIfNeeded();
        await settle(page);
        await selectHistory(page);
        await timeline.evaluate((e) => {
          e.scrollTop = e.scrollTop > 0 ? 0 : 40;
        });
        await menu.waitFor({ state: "hidden" });
        evidence.realScrolls = await page.evaluate(() => window.__scrollEvents);
        assert.ok(
          evidence.realScrolls.some((event) => event.trusted),
          "真实 scroll 路径已覆盖",
        );
        assert.deepEqual(errors, []);
      } finally {
        await writeFile(
          join(artifacts, `${mobile}-${theme}.json`),
          JSON.stringify({ evidence, errors }, null, 2),
        );
        await page.close();
      }
    });

    test(
      `TOS04 prepend ${mobile ? "mobile" : "desktop"}/${theme}`,
      { timeout: 90000 },
      async () => {
        const page = await browser.newPage({
          viewport: { width: mobile ? 430 : 1200, height: 800 },
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        try {
          await page.goto(`${origin}fixture?theme=${theme}&mobile=${mobile}`);
          const history = page
            .getByTestId("v4-row-20003")
            .getByText("E2E_TOS_SELECTED_TEXT", { exact: true });
          await history.waitFor();
          await settle(page);
          await page.evaluate(() => {
            // 模拟 Chromium 合并/丢失的原生 scroll，强制验证内部 observer 同步。
            window.addEventListener(
              "scroll",
              (event) => {
                if (event.isTrusted) event.stopImmediatePropagation();
              },
              true,
            );
            window.__overlayFixture.prepend();
          });
          await page.waitForFunction(
            () =>
              document.querySelector('[data-testid="v4-timeline"]').dataset.windowRowCount ===
              "3006",
          );
          await settle(page);
          assert.equal(await history.isVisible(), true, "前插后最后历史轮不能卸载成空白窗口");
          const evidence = await page.getByTestId("v4-timeline").evaluate((e) => {
            const bounds = e.getBoundingClientRect();
            const history = e.querySelector('[data-turn-id="history"]');
            const rect = history?.getBoundingClientRect();
            return {
              top: e.scrollTop,
              gap: e.scrollHeight - e.clientHeight - e.scrollTop,
              following: e.dataset.following,
              mounted: e.querySelectorAll("[data-v4-turn-unit]").length,
              historyInViewport: !!rect && rect.bottom > bounds.top && rect.top < bounds.bottom,
            };
          });
          assert.ok(evidence.top > 10000, JSON.stringify(evidence));
          assert.ok(Math.abs(evidence.gap) <= 1, JSON.stringify(evidence));
          assert.equal(evidence.following, "true");
          assert.equal(evidence.historyInViewport, true);
          assert.ok(evidence.mounted < 30, "仍然使用虚拟窗口");
          assert.deepEqual(errors, []);
          await writeFile(
            join(artifacts, `prepend-${mobile}-${theme}.json`),
            JSON.stringify(evidence, null, 2),
          );
          await page.screenshot({ path: join(artifacts, `prepend-${mobile}-${theme}.png`) });
        } finally {
          await page.close();
        }
      },
    );
  }
