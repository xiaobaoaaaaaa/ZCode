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
            // 旧完成快照未提供耗时，不把本次展开的时间伪造为历史耗时。
            assert.match(
              await page.locator("[data-reasoning-label]").innerText(),
              /持续了几秒|a few seconds/,
            );
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

// EA-TIMING-01：只控制 Date，保留真实 React 挂载、Radix 动画与定时器。
// CLI 的终态 durationMs 生成及 delivery/replay 一致性由 product-projection 回归验证。
const timingStart = 1_700_000_000_000;
async function openTimingActivity(page) {
  const history = page.locator('[data-testid^="chat-assistant-history-trigger"]');
  if ((await history.count()) > 0 && (await history.getAttribute("aria-expanded")) !== "true") {
    await history.click();
  }
  const activity = page.getByTestId("execution-activity-trigger");
  await activity.waitFor();
  if ((await activity.getAttribute("aria-expanded")) !== "true") await activity.click();
  const reasoning = page.getByTestId("chat-reasoning-trigger");
  await reasoning.waitFor();
  return { activity, reasoning };
}

async function expectReasoningSeconds(page, seconds) {
  await page.waitForFunction(
    (value) => {
      const label = document.querySelector("[data-reasoning-label]")?.textContent;
      return label?.includes(` ${value} 秒`) || label?.includes(`${value} seconds`);
    },
    seconds,
    { timeout: 3000 },
  );
}

for (const mobile of [false, true])
  for (const theme of ["light", "dark"])
    for (const mode of ["main", "background", "timeline"]) {
      test(
        `EA-TIMING-01 ${mode}/${mobile ? "mobile" : "desktop"}/${theme}`,
        { timeout: 60000 },
        async () => {
          const page = await browser.newPage({
            viewport: { width: mobile ? 390 : 1200, height: 900 },
            isMobile: mobile,
            hasTouch: mobile,
          });
          const errors = [];
          page.on("pageerror", (error) => errors.push(String(error)));
          page.on("console", (message) => {
            if (/changing from (uncontrolled|controlled)/.test(message.text())) {
              errors.push(message.text());
            }
          });
          try {
            await page.clock.setFixedTime(timingStart + 5000);
            await page.goto(
              `${origin}fixture?scenario=timing&mobile=${mobile}&theme=${theme}&mode=${mode}`,
            );
            let { activity, reasoning } = await openTimingActivity(page);
            await reasoning.click();
            await expectReasoningSeconds(page, 5);

            // 内层开合与外层卸载都必须继续使用消息起点。
            await reasoning.click();
            await page.clock.setFixedTime(timingStart + 9000);
            await reasoning.click();
            await expectReasoningSeconds(page, 9);
            await activity.click();
            await reasoning.waitFor({ state: "detached" });
            await page.clock.setFixedTime(timingStart + 12000);
            ({ activity, reasoning } = await openTimingActivity(page));
            await reasoning.click();
            await expectReasoningSeconds(page, 12);

            await activity.click();
            await reasoning.waitFor({ state: "detached" });
            await page.clock.setFixedTime(timingStart + 17000);
            await page.getByRole("button", { name: "Finish reasoning", exact: true }).click();
            ({ reasoning } = await openTimingActivity(page));
            await expectReasoningSeconds(page, 17);
            await page.getByRole("button", { name: "Finish turn", exact: true }).click();
            await page.getByText("E2E_TIMING_DONE", { exact: true }).waitFor();
            await openTimingActivity(page);
            await expectReasoningSeconds(page, 17);

            // 整轮历史重挂载及之后的时间流逝不改变完成态秒数。
            await page.clock.setFixedTime(timingStart + 77000);
            await page.getByRole("button", { name: "Remount", exact: true }).click();
            await openTimingActivity(page);
            await expectReasoningSeconds(page, 17);
            await page.waitForFunction(() =>
              document.getAnimations().every((animation) => animation.playState !== "running"),
            );
            await page.screenshot({
              path: join(artifacts, `timing-${mode}-${mobile}-${theme}.png`),
            });
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              true,
            );

            await page.getByRole("button", { name: "New thought", exact: true }).click();
            await page.clock.setFixedTime(timingStart + 79000);
            ({ reasoning } = await openTimingActivity(page));
            await reasoning.click();
            await expectReasoningSeconds(page, 2);
            await page.clock.setFixedTime(timingStart + 80000);
            await expectReasoningSeconds(page, 3);
            // 挂载期间收到 CLI 终态也应直接采用固定耗时，不能切换受控组件模式。
            await page.getByRole("button", { name: "Finish reasoning", exact: true }).click();
            await page.clock.setFixedTime(timingStart + 90000);
            await expectReasoningSeconds(page, 3);
            assert.deepEqual(errors, []);
          } finally {
            await page.close();
          }
        },
      );
    }

for (const ending of ["complete", "interrupted"])
  test(`EA-TIMING-01 never-mounted/${ending}`, { timeout: 30000 }, async () => {
    const page = await browser.newPage();
    try {
      await page.clock.setFixedTime(timingStart + 6000);
      await page.goto(`${origin}fixture?scenario=timing&ending=${ending}`);
      await page.getByTestId("execution-activity-trigger").waitFor();
      assert.equal(await page.getByTestId("chat-reasoning-trigger").count(), 0);
      await page.getByRole("button", { name: "Finish reasoning", exact: true }).click();
      await page.getByRole("button", { name: "Finish turn", exact: true }).click();
      await page.getByText("E2E_TIMING_DONE", { exact: true }).waitFor();
      await page.clock.setFixedTime(timingStart + 60000);
      if (ending === "interrupted") {
        // 中断思考是已有外显边界，不应期待它重新进入执行过程组。
        const history = page.locator('[data-testid^="chat-assistant-history-trigger"]');
        await history.waitFor();
        if ((await history.getAttribute("aria-expanded")) !== "true") await history.click();
        await page.getByTestId("chat-reasoning-trigger").waitFor();
        assert.equal(await page.getByTestId("execution-activity-trigger").count(), 0);
      } else {
        await openTimingActivity(page);
      }
      await expectReasoningSeconds(page, 6);
    } finally {
      await page.close();
    }
  });

for (const mobile of [false, true])
  for (const mode of ["main", "background", "timeline"])
    test(`EA-AUTO-01 ${mode}/${mobile ? "mobile" : "desktop"}`, { timeout: 30000 }, async () => {
      const page = await browser.newPage({
        viewport: { width: mobile ? 390 : 1200, height: 900 },
        isMobile: mobile,
        hasTouch: mobile,
      });
      try {
        await page.clock.setFixedTime(timingStart + 5000);
        await page.goto(
          `${origin}fixture?scenario=timing&autoExpand=true&mobile=${mobile}&mode=${mode}`,
        );
        const trigger = page.getByTestId("execution-activity-trigger");
        async function expectOpen(value) {
          await page.waitForFunction(
            (value) =>
              document
                .querySelector('[data-testid="execution-activity-trigger"]')
                ?.getAttribute("aria-expanded") === String(value),
            value,
          );
        }
        await expectOpen(true);
        const toggle = page.getByRole("button", {
          name: "Toggle auto expand",
          exact: true,
        });
        await toggle.click();
        await expectOpen(false);
        await toggle.click();
        await expectOpen(true);
        await trigger.click();
        await expectOpen(false);
        await toggle.click();
        await toggle.click();
        await expectOpen(false);
        const key = await page
          .locator("[data-execution-activity]")
          .getAttribute("data-execution-activity");
        await page.getByRole("button", { name: "Append running tool", exact: true }).click();
        await expectOpen(false);
        assert.equal(
          await page.locator("[data-execution-activity]").getAttribute("data-execution-activity"),
          key,
        );

        await page.getByRole("button", { name: "Remount", exact: true }).click();
        await expectOpen(true);
        await page.getByRole("button", { name: "Finish reasoning", exact: true }).click();
        await expectOpen(true);
        await page.getByRole("button", { name: "Finish tool", exact: true }).click();
        await expectOpen(true);
        await trigger.click();
        await expectOpen(false);
        await trigger.click();
        await expectOpen(true);
        await page.getByRole("button", { name: "Append running tool", exact: true }).click();
        await expectOpen(true);
        await page.getByRole("button", { name: "Finish tool", exact: true }).click();
        await expectOpen(true);
        await page.getByTestId("chat-reasoning-trigger").waitFor({ state: "visible" });
        await page.locator('[data-tool-call-id="auto-expand-bash"]').waitFor({ state: "visible" });
        await page.waitForFunction(() =>
          document
            .querySelector("[data-execution-activity]")
            ?.getAnimations({ subtree: true })
            .every((animation) => animation.playState !== "running"),
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({ path: join(artifacts, `auto-${mode}-${mobile}-manual-open.png`) });
        await page.getByRole("button", { name: "Finish turn", exact: true }).click();
        await page.getByText("E2E_TIMING_DONE", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Remount", exact: true }).click();
        const history = page.locator('[data-testid^="chat-assistant-history-trigger"]');
        if ((await history.count()) && (await history.getAttribute("aria-expanded")) !== "true")
          await history.click();
        await expectOpen(false);
      } finally {
        await page.close();
      }
    });

for (const mobile of [false, true])
  for (const mode of ["main", "background", "timeline"])
    test(`EA-PHASE-01 ${mode}/${mobile ? "mobile" : "desktop"}`, { timeout: 30000 }, async () => {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1200, height: 900 } });
      try {
        await page.goto(
          `${origin}fixture?scenario=timing&autoExpand=true&mobile=${mobile}&mode=${mode}`,
        );
        const triggers = page.getByTestId("execution-activity-trigger");
        const expectStates = async (states) =>
          page.waitForFunction(
            (states) =>
              JSON.stringify(
                [...document.querySelectorAll('[data-testid="execution-activity-trigger"]')].map(
                  (e) => e.getAttribute("aria-expanded"),
                ),
              ) === JSON.stringify(states.map(String)),
            states,
          );
        await expectStates([true]);
        const key = await page
          .locator("[data-execution-activity]")
          .getAttribute("data-execution-activity");
        await page.getByRole("button", { name: "Finish reasoning", exact: true }).click();
        await expectStates([true]);
        for (let i = 0; i < 3; i++) {
          await page.getByRole("button", { name: "Append another tool", exact: true }).click();
          await expectStates([true]);
          await page.getByRole("button", { name: "Finish tool", exact: true }).click();
          await expectStates([true]);
          assert.equal(
            await page.locator("[data-execution-activity]").getAttribute("data-execution-activity"),
            key,
          );
        }
        await page.getByRole("button", { name: "Next stage", exact: true }).click();
        await expectStates([false]);
        await page.getByRole("button", { name: "Start next activity", exact: true }).click();
        await expectStates([false, true]);
        await triggers.first().click();
        await triggers.last().click();
        await expectStates([true, false]);
        await page.getByRole("button", { name: "Finish turn", exact: true }).click();
        await expectStates([true, false]);
        await page.getByRole("button", { name: "Remount", exact: true }).click();
        const history = page.locator('[data-testid^="chat-assistant-history-trigger"]');
        if ((await history.count()) && (await history.getAttribute("aria-expanded")) !== "true")
          await history.click();
        await expectStates([false, false]);
        await page.screenshot({ path: join(artifacts, `phase-${mode}-${mobile}.png`) });
      } finally {
        await page.close();
      }
    });
