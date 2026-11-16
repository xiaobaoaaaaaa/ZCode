import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/diff-wrap.fixture.tsx";
const artifacts =
  process.env.DIFF_WRAP_ARTIFACTS ??
  join(root, "packages/desktop/.e2e-artifacts/diff-wrap-browser");
const surfaces = [
  "git-full",
  "git-patch",
  "git-fallback",
  "preview-full",
  "preview-patch",
  "preview-fallback",
];
let server, browser, origin;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, "node_modules/.vite-diff-wrap"),
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "diff-wrap-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
          });
        },
      },
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

// 同时检查 Shadow DOM 的真实行几何和轻量行，不把 options 值当作换行已生效的证据。
async function measure(page, id) {
  return page.getByTestId(id).evaluate((section) => {
    const shadow = section.querySelector("diffs-container")?.shadowRoot;
    const root = shadow ?? section;
    const lines = Array.from(root.querySelectorAll(shadow ? "[data-line]" : "code")).filter(
      (line) => line.textContent?.includes("export const"),
    );
    return {
      lineCount: lines.length,
      rows: lines.map((line) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        const tops = new Set(
          Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top)),
        );
        return { text: line.textContent, visualLines: tops.size };
      }),
      horizontal: Array.from(root.querySelectorAll("*")).some(
        (el) =>
          ["auto", "scroll"].includes(getComputedStyle(el).overflowX) &&
          el.scrollWidth > el.clientWidth + 2,
      ),
      outside: section.scrollWidth > section.clientWidth + 2,
      // 分支证据：完整 diff 与轻量回退均须被真实挂载。
      rich: Boolean(shadow),
      theme: shadow?.querySelector("pre")?.getAttribute("data-theme-type"),
    };
  });
}

for (const width of [390, 1200])
  for (const theme of ["light", "dark"]) {
    test(`DV-WRAP-01 ${width}px ${theme}`, async (t) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      t.after(async () => {
        const final = await Promise.all(
          surfaces.map(async (id) => ({ id, ...(await measure(page, id)) })),
        ).catch(() => []);
        await writeFile(
          join(artifacts, `${width}-${theme}-final.json`),
          JSON.stringify({ errors, final }, null, 2),
        );
        await page.screenshot({
          path: join(artifacts, `${width}-${theme}-final.png`),
          fullPage: true,
        });
        await page.close();
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `${origin}fixture?theme=${theme}&locale=${width === 390 ? "zh-CN" : "en-US"}`,
        { timeout: 120_000 },
      );
      const toggle = page.getByRole("checkbox", { name: "Wrap long lines" });
      await toggle.waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.classList.contains("dark")),
        theme === "dark",
      );
      const samples = [];
      for (const wrap of [false, true, false, true]) {
        await toggle.setChecked(wrap);
        for (const id of surfaces) {
          await page
            .getByTestId(id)
            .getByText("export const message", { exact: false })
            .first()
            .waitFor();
          // 异步高亮和 options 更新完成后再读取几何，不依赖固定 sleep。
          await page.waitForFunction(
            ({ id, wrap }) => {
              const section = document.querySelector(`[data-testid="${id}"]`);
              const shadow = section?.querySelector("diffs-container")?.shadowRoot;
              if (shadow)
                return (
                  shadow.querySelector("pre")?.getAttribute("data-overflow") ===
                  (wrap ? "wrap" : "scroll")
                );
              const code = section?.querySelector("code");
              return code && getComputedStyle(code).whiteSpace === (wrap ? "pre-wrap" : "pre");
            },
            { id, wrap },
            { timeout: 5000 },
          );
          const sample = await measure(page, id);
          samples.push({ id, wrap, ...sample });
          assert.equal(sample.rich, !id.endsWith("fallback"), `${id}: unexpected renderer`);
          assert.ok(sample.lineCount >= 4, `${id}: missing additions/deletions`);
          assert.ok(
            sample.rows.every((row) => (wrap ? row.visualLines > 1 : row.visualLines === 1)),
            `${id}: long line geometry ${JSON.stringify(sample.rows)}`,
          );
          assert.equal(sample.horizontal, !wrap, `${id}: horizontal scroll must match wrapping`);
          assert.equal(sample.outside, false, `${id}: content escapes pane`);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
          false,
        );
        if (wrap)
          await page.screenshot({
            path: join(artifacts, `${width}-${theme}-wrapped.png`),
            fullPage: true,
          });
      }
      await page.reload();
      assert.equal(
        await toggle.isChecked(),
        true,
        "global wrapping preference must survive reload",
      );
      for (const id of surfaces) {
        const sample = await measure(page, id);
        assert.equal(sample.horizontal, false, `${id}: reloaded diff must keep wrapping`);
        assert.ok(sample.lineCount >= 4 && sample.rows.every((row) => row.visualLines > 1));
      }
      assert.deepEqual(errors, []);
      await writeFile(join(artifacts, `${width}-${theme}.json`), JSON.stringify(samples, null, 2));
    });
  }
