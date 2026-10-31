import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const artifacts = join(root, "packages/desktop/.e2e-artifacts/personal-update-ui");
let server, browser, origin;
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ZCodeIntlProvider } from '/packages/ui/src/i18n/IntlProvider.tsx';
import { UpdateStatusDialogController } from '/packages/ui/src/UpdateStatusDialogController.tsx';
import { shouldShowDesktopUpdateEntry } from '/packages/ui/src/desktop-update-menu/contract.ts';
import '/packages/ui/src/styles.css';
const params = new URLSearchParams(location.search);
localStorage.setItem('zcode-locale-preference', params.get('locale'));
document.documentElement.className = params.get('theme') === 'dark' ? 'theme-zai-dark dark' : 'theme-zai-light light';
window.entryVisibility = ['production', 'personal', 'preview'].map(shouldShowDesktopUpdateEntry);
window.downloadCalls = 0;
const manualDownload = params.get('manual') === '1';
function Fixture() {
  const [state, setState] = useState({kind:'update-available', enabled:true, version:'3.17.1-personal.4', manualDownload});
  const [platform] = useState(() => ({
    getAutoUpdatePreferences: async () => ({ autoDownloadAndInstallUpdates: true }),
    downloadUpdate: () => { window.downloadCalls++; return new Promise(resolve => {
      window.completeDownload = () => {
        if (!manualDownload) setState({kind:'download-progress', enabled:true, version:'3.17.1-personal.4', progress:'25', transferredBytes:1024, totalBytes:4096});
        resolve();
      };
    }); },
    openExternal: () => { throw Error('Renderer must use the Main download command'); },
  }));
  return React.createElement(UpdateStatusDialogController, {platform, version:null, updateState:state, open:true, onOpenChange:()=>{}});
}
createRoot(document.getElementById('root')).render(React.createElement(ZCodeIntlProvider, null, React.createElement(Fixture)));
`;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      {
        name: "personal-update-fixture",
        resolveId(id) {
          if (id === "/fixture.js") return "\0personal-update-fixture";
        },
        load(id) {
          if (id === "\0personal-update-fixture") return fixture;
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith("/fixture?")) {
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
                ),
              );
            } else next();
          });
        },
      },
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { "@": join(root, "packages/ui/src") } },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime"] },
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
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

for (const [width, locale, theme] of [
  [1200, "zh-CN", "light"],
  [390, "en-US", "dark"],
]) {
  for (const manual of [true, false]) {
    test(
      `update ${manual ? "manual" : "native"} ${width}/${locale}/${theme}`,
      { timeout: 60000 },
      async () => {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(
            `${origin}fixture?locale=${locale}&theme=${theme}&manual=${Number(manual)}`,
          );
          const button = page.getByRole("button", {
            name: manual
              ? locale === "zh-CN"
                ? "打开下载页"
                : "Open download page"
              : locale === "zh-CN"
                ? "下载更新"
                : "Download update",
            exact: true,
          });
          await button.waitFor();
          assert.deepEqual(await page.evaluate(() => window.entryVisibility), [true, true, false]);
          assert.equal(await page.getByRole("checkbox").count(), manual ? 0 : 1);
          await page.screenshot({
            path: join(artifacts, `${manual}-${width}-${locale}-${theme}.png`),
          });
          await button.click();
          assert.equal(await button.isDisabled(), true);
          assert.equal(await page.evaluate(() => window.downloadCalls), 1);
          await page.evaluate(() => window.completeDownload());
          if (manual) {
            // ACK 后没有下载进度事件，必须立即释放锁，不能依赖 1500ms 超时。
            await page.waitForFunction(
              () =>
                [...document.querySelectorAll("button")].some(
                  (b) => /打开下载页|Open download page/.test(b.textContent) && !b.disabled,
                ),
              {},
              { timeout: 1000 },
            );
            await button.click();
            assert.equal(await page.evaluate(() => window.downloadCalls), 2);
            await page.evaluate(() => window.completeDownload());
          } else {
            await page
              .getByRole("button", { name: locale === "zh-CN" ? "取消下载" : "Cancel download" })
              .waitFor();
          }
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      },
    );
  }
}
