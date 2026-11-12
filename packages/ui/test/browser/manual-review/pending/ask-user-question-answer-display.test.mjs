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
  "/packages/ui/test/browser/manual-review/pending/ask-user-question-answer-display.fixture.tsx";
const artifacts = join(root, "packages/desktop/.e2e-artifacts/ask-user-question-answer-display");
let server, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, "node_modules/.vite-ask-user-question-answer-display"),
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "ask-answer-fixture",
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
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : {},
  );
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function inspectAnswers(page) {
  const cards = page.locator("[data-case]");
  await cards.first().waitFor();
  assert.equal(await cards.count(), 15);
  const evidence = [];
  for (const card of await cards.all()) {
    const trigger = card.locator("[aria-expanded]").first();
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await card.locator("p").first().waitFor();
    const expected = JSON.parse(await card.getAttribute("data-expected"));
    const questions = JSON.parse(await card.getAttribute("data-questions"));
    const rows = await card.locator("p").allTextContents();
    const id = await card.getAttribute("data-case");
    assert.deepEqual(
      rows,
      questions.flatMap((question, index) => [question, expected[index]]),
      id,
    );
    evidence.push({ id, rows });
  }
  return evidence;
}

for (const width of [390, 1200])
  for (const theme of ["light", "dark"])
    for (const locale of ["zh-CN", "en-US"]) {
      test(`Q27 ${width}/${theme}/${locale}`, { timeout: 60000 }, async () => {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          isMobile: width === 390,
          hasTouch: width === 390,
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const evidence = {};
        try {
          await page.goto(`${origin}fixture?theme=${theme}&locale=${locale}`);
          evidence.initial = await inspectAnswers(page);
          await page.getByRole("button", { name: "Remount snapshot", exact: true }).click();
          await page.locator('[data-revision="1"]').waitFor();
          evidence.remount = await inspectAnswers(page);
          await page.reload();
          evidence.reload = await inspectAnswers(page);
          assert.deepEqual(errors, []);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
            false,
          );
          await page.screenshot({
            path: join(artifacts, `${width}-${theme}-${locale}.png`),
            fullPage: true,
          });
          await writeFile(
            join(artifacts, `${width}-${theme}-${locale}.json`),
            JSON.stringify(evidence, null, 2),
          );
        } finally {
          await page.close();
        }
      });
    }
