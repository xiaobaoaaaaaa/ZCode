import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { createCodexSubscription } from "../../../../../services/src/codex-subscription/index.ts";
import {
  ProviderConfigService,
  ProviderConfigMap,
  ModelConfigRules,
  parseProviderConfig,
  ModelConfig,
} from "../../../../../provider/src/index.ts";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const artifacts = join(root, "packages/desktop/.e2e-artifacts/codex-subscription-compact-ui");
let server, browser, origin;
const empty = () => ({
  revision: "0",
  providers: ProviderConfigMap.empty(),
  models: ModelConfigRules.empty(),
});
let personal = empty();
const configService = new ProviderConfigService({
  zcodeBuiltinSource: { read: async () => empty(), onDidChange: () => () => {} },
  personalRepository: {
    read: async () => personal,
    onDidChange: () => () => {},
    update: async (transform) =>
      (personal = { ...transform(personal), revision: String(Number(personal.revision) + 1) }),
  },
});
const stored = [
  {
    id: "fixture-account",
    subject: "fixture-user",
    workspaceId: "fixture-workspace",
    email: "account@example.test",
    accessToken: "synthetic",
    refreshToken: "synthetic",
    expiresAt: 9999999999999,
    needsLogin: false,
    models: ["gpt-test", "gpt-test-mini"],
    plan: "plus",
  },
];
const host = createCodexSubscription({
  credentials: {
    load: async () => JSON.stringify(stored),
    save: async () => {},
    delete: async () => {},
  },
  fetch: async () => {
    throw Error("Sync must not require network authorization");
  },
  withLock: async (operation) => operation(),
  providers: {
    getView: async () => ({
      providers: personal.providers.entries().map(([providerId, config]) => ({
        providerId,
        personalConfig: config.toJSON(),
        effectiveConfig: config.toJSON(),
        models: (config.personalModelIds ?? []).map((modelId) => ({ modelId })),
      })),
    }),
    createPersonalProvider: (input) =>
      configService.createPersonalProvider({
        ...input,
        initialConfig: parseProviderConfig(input.initialConfig),
      }),
    savePersonalProviderOverlay: (id, config) =>
      configService.savePersonalProviderOverlay(id, parseProviderConfig(config)),
    addPersonalModel: (id, modelId, config, recommended) =>
      configService.addPersonalModel(id, modelId, new ModelConfig(config), undefined, recommended),
  },
});

// Exercise actual config validation and persistence, not an accepting create-provider stub.
test("first sync, repeat sync and new model preserve provider and user model settings", async () => {
  const first = await host.service.connectAccount("fixture-account");
  assert.equal(personal.providers.get(first.providerId).group, "standard-personal");
  assert.deepEqual(personal.providers.get(first.providerId).personalModelIds, stored[0].models);
  assert.match(JSON.stringify(personal.models), /"enabled":true/);
  await configService.setPersonalModelEnabled(first.providerId, "gpt-test", false);
  const before = JSON.stringify(personal.models);
  assert.equal((await host.service.connectAccount("fixture-account")).providerId, first.providerId);
  assert.equal(personal.providers.entries().length, 1);
  assert.equal(JSON.stringify(personal.models), before);
  assert.equal(personal.models.getExact(first.providerId, "gpt-test").enabled, false);
  await configService.savePersonalProviderOverlay(
    first.providerId,
    parseProviderConfig({
      ...personal.providers.get(first.providerId).toJSON(),
      logo: { type: "builtin", key: "openai" },
    }),
  );
  stored[0].models.push("gpt-test-new");
  await host.service.connectAccount("fixture-account");
  assert.deepEqual(personal.providers.get(first.providerId).personalModelIds, stored[0].models);
  assert.equal(personal.providers.get(first.providerId).logo.key, "openai");
  assert.equal(personal.models.getExact(first.providerId, "gpt-test-new").enabled, true);
});

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ZCodeIntlProvider, useZCodeIntl } from '/packages/ui/src/i18n/IntlProvider.tsx';
import { ServiceProvider } from '/packages/ui/src/hooks/useServices.tsx';
import { PlatformProvider } from '/packages/ui/src/hooks/usePlatform.tsx';
import { TooltipProvider } from '/packages/ui/src/components/ui/tooltip.tsx';
import { ModelProviderSectionLayout } from '/packages/ui/src/settings/model-provider-section/SectionLayout.tsx';
import { useModelProviderNavigation } from '/packages/ui/src/settings/model-provider-section/useModelProviderNavigation.ts';
import { CodexAccountsPanel } from '/packages/ui/src/codex-subscription/index.tsx';
import '/packages/ui/src/styles.css';
const query = new URLSearchParams(location.search);
localStorage.setItem('zcode-locale-preference', query.get('locale'));
document.body.className = 'bg-background text-foreground';
document.documentElement.className = query.get('theme') === 'dark' ? 'theme-zai-dark dark' : 'theme-zai-light light';
window.syncCalls = 0; window.cancelCalls = 0; window.failSync = false; window.refreshCalls = 0;
const account = { id:'fixture-account', email:'account@example.test', workspaceId:'fixture-workspace', plan:'plus', models:['gpt-test', 'gpt-test-mini'], needsLogin:false, stale:false, quota:{windows:[{remainingPercent:75,windowSeconds:18000,resetsAt:1793570000000},{remainingPercent:0,windowSeconds:604800,resetsAt:1793570000000}],credits:'0'} };
const scenario = query.get('scenario');
if(scenario === 'unknown') {account.quota = undefined;account.models = [];account.stale = true;account.needsLogin = true;}
if(scenario === 'credits') account.quota.credits = '12.5';
if(scenario === 'unlimited') account.quota.unlimitedCredits = true;
const accounts = scenario === 'multi' ? [account, {...account,id:'second',email:'long-account-name-for-layout@example.test',workspaceId:'second-workspace'}] : scenario === 'empty' ? [] : [account];
const service = {
 listAccounts: async () => accounts, refreshAccount: async () => {window.refreshCalls++; return account;},
 connectAccount: async () => { window.syncCalls++; if(window.failSync) throw Error('fixture failure'); const res = await fetch('/sync', {method:'POST'}); if(!res.ok) throw Error('sync failed'); return res.json(); },
 startLogin: async () => ({id:'login',userCode:'TEST-CODE',verificationUrl:'https://example.test',intervalMs:5000}),
 pollLogin: async () => ({status:'pending'}), cancelLogin: async () => {window.cancelCalls++;}, removeAccount: async () => {},
};
function Fixture(){
 const {intl} = useZCodeIntl(); const [selectedNodeKey,setSelectedNodeKey] = useState('preset:bigmodel');
 const {navigationGroups,selectedNavItem} = useModelProviderNavigation({presetProviders:[{id:'bigmodel',displayName:'BigModel',provider:null}],modelProviders:[],codexAvailable:true,selectedNodeKey,setSelectedNodeKey,intl});
 return <main style={{background:'var(--color-background)',color:'var(--color-foreground)',minHeight:'100vh',padding:16}}><ModelProviderSectionLayout description="Model providers" refreshLabel="Refresh" loadingLabel="Loading" presetLoading={false} customLoading={false} onRefresh={()=>{}} addProviderLabel="Add" onAddProvider={()=>{}} navigationGroups={navigationGroups} selectedNodeKey={selectedNodeKey} onSelectNavItem={item=>setSelectedNodeKey(item.key)}>
 {selectedNavItem?.type === 'codex' ? <CodexAccountsPanel/> : <div data-testid="other-detail">BigModel</div>}
 </ModelProviderSectionLayout></main>;
}
createRoot(document.getElementById('root')).render(<ZCodeIntlProvider><TooltipProvider><PlatformProvider platform={{openExternal:()=>{}}}><ServiceProvider services={{codexSubscriptionService:service}}><Fixture/></ServiceProvider></PlatformProvider></TooltipProvider></ZCodeIntlProvider>);
`;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      {
        name: "codex-fixture",
        resolveId(id) {
          if (id === "/fixture.tsx") return join(root, "codex-fixture.tsx");
        },
        load(id) {
          if (id === join(root, "codex-fixture.tsx")) return fixture;
        },
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url === "/sync") {
              try {
                const result = await host.service.connectAccount("fixture-account");
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
              } catch {
                res.statusCode = 500;
                res.end("sync failed");
              }
            } else if (req.url?.startsWith("/fixture?")) {
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>',
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
  configService.dispose();
});
for (const [width, locale, theme] of [
  [1200, "zh-CN", "light"],
  [1200, "en-US", "dark"],
  [900, "zh-CN", "dark"],
  [390, "zh-CN", "dark"],
  [390, "en-US", "light"],
]) {
  test("Codex cards " + [width, locale, theme].join("/"), { timeout: 60000 }, async () => {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "fixture?" + new URLSearchParams({ locale, theme }));
    const nav = page.getByRole("button", { name: "ChatGPT / Codex", exact: true });
    await nav.waitFor();
    assert.equal(await page.getByTestId("codex-accounts").count(), 0);
    await nav.click();
    await page.getByTestId("codex-account").waitFor();
    assert.equal(await nav.getAttribute("aria-selected"), "true");
    const accountCard = page.getByTestId("codex-account");
    assert.equal((await accountCard.innerText()).includes("fixture-workspace"), false);
    assert.equal(await page.getByTestId("codex-quota-meter").count(), 2);
    const meters = page.getByRole("progressbar");
    assert.equal(await meters.nth(0).getAttribute("aria-valuenow"), "75");
    assert.equal(await meters.nth(1).getAttribute("aria-valuenow"), "0");
    assert.equal(await page.getByTestId("codex-model-row").count(), 2);
    assert.equal(await page.getByTestId("codex-credits").count(), 0);
    await page.getByTestId("codex-refresh").click();
    await page.waitForFunction(() => window.refreshCalls === 1);
    await page.getByTestId("codex-more").click();
    assert.equal(await page.getByRole("menuitem").count(), 2);
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator('[data-model-provider-detail-scroll] [data-testid="codex-accounts"]')
        .count(),
      1,
    );
    await page.evaluate(() => {
      window.failSync = true;
    });
    await page.getByTestId("codex-connect").click();
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /同步模型失败|Could not sync models/);
    await page.evaluate(() => {
      window.failSync = false;
    });
    await page.getByTestId("codex-connect").click();
    await page.getByRole("status").waitFor();
    await page.getByTestId("codex-connect").click();
    await page.waitForFunction(() => window.syncCalls === 3);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({
      path: join(artifacts, [width, locale, theme].join("-") + ".png"),
      fullPage: true,
    });
    await page.getByTestId("codex-login").click();
    await page.getByTestId("codex-user-code").waitFor();
    await page.getByRole("button", { name: "BigModel", exact: true }).click();
    await page.waitForFunction(() => window.cancelCalls > 0);
    assert.equal(await page.getByTestId("codex-accounts").count(), 0);
    await nav.click();
    await page.getByTestId("codex-account").waitFor();
    assert.equal(await page.getByTestId("codex-user-code").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

for (const scenario of ["unknown", "credits", "unlimited", "empty", "multi"]) {
  test("Codex compact card state " + scenario, { timeout: 60000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
    await page.goto(
      origin + "fixture?" + new URLSearchParams({ locale: "zh-CN", theme: "dark", scenario }),
    );
    await page.getByRole("button", { name: "ChatGPT / Codex", exact: true }).click();
    await page.getByTestId("codex-accounts").waitFor();
    if (scenario === "empty") {
      await page.getByText("尚未添加 ChatGPT 账号。").waitFor();
      assert.equal(await page.getByTestId("codex-account").count(), 0);
      await page.getByTestId("codex-login").click();
      await page.getByTestId("codex-user-code").waitFor();
    } else {
      await page.getByTestId("codex-account").first().waitFor();
      if (scenario === "unknown") {
        assert.equal(await page.getByRole("progressbar").count(), 0);
        assert.equal(await page.getByTestId("codex-connect").isDisabled(), true);
        assert.match(await page.getByTestId("codex-account").innerText(), /额度未知/);
        await page.getByTestId("codex-more").click();
        await page.getByRole("menuitem", { name: "重新登录" }).click();
        await page.getByTestId("codex-user-code").waitFor();
      } else if (scenario === "multi") {
        const cards = page.getByTestId("codex-account");
        assert.equal(await cards.count(), 2);
        await cards.nth(1).getByTestId("codex-connect").click();
        await cards.nth(1).getByRole("status").waitFor();
        assert.equal(await cards.nth(0).getByRole("status").count(), 0);
      } else {
        assert.match(
          await page.getByTestId("codex-credits").innerText(),
          scenario === "credits" ? /12.5/ : /不限量/,
        );
      }
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.close();
  });
}
