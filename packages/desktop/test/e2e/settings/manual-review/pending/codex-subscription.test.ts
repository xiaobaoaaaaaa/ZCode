import assert from "node:assert/strict";
import { createCodexSubscription } from "@zcode/services/codex-subscription";
import type { IProviderSettingsService } from "@zcode/services";
import {
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_BACK_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  setCurrentElectronRendererContentSize,
} from "../../../helpers/desktop-app.js";
import { dismissOccupationOnboarding } from "../../../helpers/occupation-onboarding.js";

describe("Codex subscription account integration", () => {
  it("CS-01: authorization, quota, refresh rotation, manual binding and cancellation", async () => {
    let clock = 1_000_000;
    let stored: string | null = null;
    let tail = Promise.resolve();
    const withLock = async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    };
    const jwt = (claims: object) =>
      `synthetic.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
    let workspace = "test-workspace";
    let pollPending = true;
    let quotaFails = false;
    let refreshes = 0;
    let refreshRejected = false;
    let releaseExchange: (() => void) | undefined;
    let exchangeBarrier: Promise<void> | undefined;
    let exchangeStarted: (() => void) | undefined;
    const token = () => ({
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      expires_in: 120,
      id_token: jwt({
        sub: "test-user",
        email: "account@example.test",
        "https://api.openai.com/auth": { chatgpt_account_id: workspace },
      }),
    });
    const response = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      assert.equal(init?.redirect, "error");
      const url = String(input);
      if (url.endsWith("/usercode"))
        return response({ device_auth_id: "device", user_code: "TEST-CODE", interval: "5" });
      if (url.endsWith("/deviceauth/token"))
        return pollPending
          ? response({}, 403)
          : response({ authorization_code: "synthetic-code", code_verifier: "synthetic-verifier" });
      if (url.endsWith("/oauth/token")) {
        if (String(init?.body).includes("grant_type=refresh_token")) {
          refreshes++;
          if (refreshRejected) return response({}, 400);
        } else {
          exchangeStarted?.();
          await exchangeBarrier;
        }
        return response(token());
      }
      if (url.includes("/codex/models?")) return response({ models: [{ slug: "gpt-test" }] });
      if (url.endsWith("/wham/usage"))
        return quotaFails
          ? response({}, 503)
          : response({
              plan_type: "plus",
              rate_limit: {
                primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 2000 },
              },
              credits: { balance: "12.5" },
            });
      throw new Error("Unexpected test endpoint");
    };
    const providers: Array<{
      providerId: string;
      effectiveConfig: any;
      models: Array<{ modelId: string }>;
    }> = [];
    const providerService = {
      async getView() {
        return { providers };
      },
      async createPersonalProvider(input: any) {
        const providerId = providers.length ? "codex-provider-2" : "codex-provider";
        providers.push({
          providerId,
          effectiveConfig: input.initialConfig,
          models: [],
        });
        return { providerId };
      },
      async savePersonalProviderOverlay(id: string, config: any) {
        providers.find((p) => p.providerId === id)!.effectiveConfig = config;
      },
      async deletePersonalProvider(id: string) {
        const index = providers.findIndex((p) => p.providerId === id);
        if (index >= 0) providers.splice(index, 1);
      },
      async addPersonalModel(id: string, modelId: string) {
        providers.find((p) => p.providerId === id)!.models.push({ modelId });
      },
    } as unknown as IProviderSettingsService;
    const deps = {
      credentials: {
        async load() {
          return stored;
        },
        async save(_key: string, value: string, guard?: () => void) {
          guard?.();
          stored = value;
        },
        async delete() {
          stored = null;
        },
      },
      fetch,
      providers: providerService,
      withLock,
      now: () => clock,
    };
    const host = createCodexSubscription(deps);
    const login = await host.service.startLogin();
    assert.equal(login.userCode, "TEST-CODE");
    assert.deepEqual(await host.service.pollLogin(login.id), { status: "pending" });
    clock += 5000;
    pollPending = false;
    const success = await host.service.pollLogin(login.id);
    assert.equal(success.status, "complete");
    const account = (await host.service.listAccounts())[0]!;
    assert.equal(JSON.stringify(account).includes("synthetic-access"), false);
    assert.equal(JSON.stringify(account).includes("synthetic-refresh"), false);
    const refreshed = await host.service.refreshAccount(account.id);
    assert.equal(refreshed.quota?.windows[0]?.remainingPercent, 75);
    assert.equal(refreshed.quota?.windows[0]?.resetsAt, 2_000_000);
    assert.equal(refreshed.quota?.credits, "12.5");
    assert.deepEqual(refreshed.models, ["gpt-test"]);
    await host.service.connectAccount(account.id);
    await host.service.connectAccount(account.id);
    assert.equal(providers.length, 1);
    assert.equal(providers[0]!.models.length, 1);
    assert.equal(JSON.stringify(providers).includes("synthetic-access"), false);
    quotaFails = true;
    const stale = await host.service.refreshAccount(account.id);
    assert.equal(stale.stale, true);
    assert.equal(stale.quota?.windows[0]?.remainingPercent, 75);
    clock += 120_000;
    const otherHost = createCodexSubscription(deps);
    await Promise.all([
      host.resolveRequestAuth(account.id, "codex-provider"),
      otherHost.resolveRequestAuth(account.id, "codex-provider"),
    ]);
    assert.equal(refreshes, 1);
    clock += 120_000;
    refreshRejected = true;
    assert.equal((await host.service.refreshAccount(account.id)).needsLogin, true);
    assert.equal((await host.service.listAccounts()).length, 1);
    refreshRejected = false;
    const restored = await host.service.startLogin(account.id);
    await host.service.pollLogin(restored.id);
    assert.equal((await host.service.listAccounts())[0]!.needsLogin, false);
    workspace = "wrong-workspace";
    const relogin = await host.service.startLogin(account.id);
    await assert.rejects(host.service.pollLogin(relogin.id), /does not match/);
    assert.equal((await host.service.listAccounts())[0]!.workspaceId, "test-workspace");
    exchangeBarrier = new Promise((resolve) => {
      releaseExchange = resolve;
    });
    const cancelled = await host.service.startLogin();
    const entered = new Promise<void>((resolve) => {
      exchangeStarted = resolve;
    });
    const result = host.service.pollLogin(cancelled.id);
    await entered;
    await host.service.cancelLogin(cancelled.id);
    releaseExchange!();
    await assert.rejects(result, /cancelled/);
    assert.equal((await host.service.listAccounts()).length, 1);
    exchangeBarrier = undefined;
    const secondLogin = await host.service.startLogin();
    const secondResult = await host.service.pollLogin(secondLogin.id);
    assert.equal(secondResult.status, "complete");
    const second = (await host.service.listAccounts()).find((a) => a.id !== account.id)!;
    assert.equal(second.workspaceId, "wrong-workspace");
    await host.service.refreshAccount(second.id);
    const secondProvider = await host.service.connectAccount(second.id);
    const secondAuth = await host.resolveRequestAuth(second.id, secondProvider.providerId);
    assert.equal(secondAuth.headers["ChatGPT-Account-Id"], second.workspaceId);
    assert.equal(
      (await host.resolveRequestAuth(account.id, "codex-provider")).headers["ChatGPT-Account-Id"],
      account.workspaceId,
    );
    await host.service.removeAccount(account.id);
    assert.deepEqual(
      (await host.service.listAccounts()).map((a) => a.id),
      [second.id],
    );
    assert.equal(providers.length, 1);
    await host.service.removeAccount(second.id);
    assert.deepEqual(await host.service.listAccounts(), []);
    await assert.rejects(
      host.resolveRequestAuth(account.id, "codex-provider"),
      /removed|binding changed/,
    );
    assert.equal(providers.length, 0);
  });

  it("CS-02: settings device code, cancellation, account usage and narrow layout", async function () {
    this.timeout(180_000);
    await browser.waitUntil(
      async () => !(await $('[data-testid="root-startup-loading"]').isExisting()),
      { timeout: 30_000 },
    );
    await dismissOccupationOnboarding();
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"));
    await $('[data-testid="codex-accounts"]').waitForExist({ timeout: 30_000 });
    // UI fixture replaces the public service contract only; no real account or OAuth network is used.
    await browser.execute(() => {
      const element = document.querySelector('[data-testid="codex-accounts"]')!;
      let fiber = (element as any)[
        Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
      ];
      while (fiber) {
        const services = fiber.memoizedProps?.value ?? fiber.memoizedProps?.services;
        if (services?.codexSubscriptionService) {
          const account = {
            id: "ui-account",
            email: "ui@example.test",
            workspaceId: "workspace-test",
            needsLogin: false,
            models: ["gpt-test"],
            stale: false,
            quota: {
              windows: [
                { remainingPercent: 75, windowSeconds: 18000, resetsAt: Date.now() + 3600000 },
              ],
              updatedAt: Date.now(),
            },
          };
          const mock: any = {};
          mock.listAccounts = async () => [account];
          mock.startLogin = async () => ({
            id: "ui-login",
            userCode: "TEST-CODE",
            verificationUrl: "https://auth.openai.com/codex/device",
            expiresAt: Date.now() + 600000,
            intervalMs: 5000,
          });
          mock.pollLogin = async () => ({ status: "pending" });
          mock.cancelLogin = async () => {
            (window as any).__codexCancelCount = ((window as any).__codexCancelCount ?? 0) + 1;
          };
          mock.refreshAccount = async () => account;
          mock.connectAccount = async () => ({ providerId: "test-provider" });
          mock.removeAccount = async () => {};
          services.codexSubscriptionService = mock;
          return;
        }
        fiber = fiber.return;
      }
      throw new Error("Missing Codex service context");
    });
    // ProxyChannel 的 get trap 不读取逐方法赋值；替换整份 contract 后重挂载页面。
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"));
    // Browser open is stubbed at the Electron boundary, preserving the product click path.
    await browser.electron
      .mock("shell", "openExternal")
      .then((mock) => mock.mockResolvedValue(undefined));
    await $('[data-testid="codex-login"]').click();
    await $('[data-testid="codex-user-code"]').waitForExist();
    assert.equal(await $('[data-testid="codex-user-code"]').getText(), "TEST-CODE");
    const cancel = await $('[data-testid="codex-device-login"] button:last-child');
    await cancel.click();
    await browser.waitUntil(
      async () => !(await $('[data-testid="codex-device-login"]').isExisting()),
    );
    assert.ok(await browser.execute(() => (window as any).__codexCancelCount > 0));
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"));
    await $('[data-testid="codex-account"]').waitForExist();
    assert.match(await $('[data-testid="codex-account"]').getText(), /75%/);
    await $('[data-testid="codex-refresh"]').click();
    await $('[data-testid="codex-connect"]').click();
    await browser.waitUntil(async () =>
      /模型已就绪|Models are ready/.test(await $('[data-testid="codex-accounts"]').getText()),
    );
    await browser.execute(() => (window as any).__testActions?.setTheme("dark"));
    await browser.waitUntil(() =>
      browser.execute(() => document.documentElement.classList.contains("dark")),
    );
    await browser.saveScreenshot(`${process.env.ZCODE_E2E_ARTIFACT_DIR}/codex-settings.png`);
    await setCurrentElectronRendererContentSize(480, 844);
    await browser.execute(() => (window as any).__testActions?.setTheme("light"));
    assert.ok(await browser.execute(() => window.innerWidth <= 480));
    assert.equal(await $('[data-testid="codex-login"]').isDisplayed(), true);
    assert.equal(await $('[data-testid="codex-refresh"]').isDisplayed(), true);
    await browser.saveScreenshot(`${process.env.ZCODE_E2E_ARTIFACT_DIR}/codex-settings-narrow.png`);
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
});
