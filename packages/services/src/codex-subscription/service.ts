import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ICredentialService } from "../credential/credential.js";
import type { IProviderSettingsService } from "../model-provider/providerFacadeServices.js";
import type {
  CodexAccount,
  CodexDeviceLogin,
  CodexQuotaWindow,
  ICodexSubscriptionService,
} from "./contract.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH = "https://auth.openai.com";
const BACKEND = "https://chatgpt.com/backend-api";
const VERSION = "0.159.0";
const STORE_KEY = "codex-subscription-accounts-v1";
const TIMEOUT_MS = 30_000;
const REFRESH_MARGIN_MS = 60_000;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
});
const accountSchema = z.object({
  id: z.string(),
  subject: z.string(),
  workspaceId: z.string(),
  email: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  needsLogin: z.boolean(),
  models: z.array(z.string()),
  plan: z.string().optional(),
});
type StoredAccount = z.infer<typeof accountSchema>;
type Token = z.infer<typeof tokenSchema>;
interface Dependencies {
  credentials: ICredentialService & {
    save(key: string, value: string, assertCurrent?: () => void): Promise<void>;
  };
  fetch: typeof globalThis.fetch;
  /** Serializes load/refresh/save across all Host processes sharing this store. */
  withLock<T>(operation: () => Promise<T>): Promise<T>;
  providers: IProviderSettingsService;
  now?: () => number;
}
interface PendingLogin {
  view: CodexDeviceLogin;
  deviceId: string;
  accountId?: string;
  nextPoll: number;
  flight?: ReturnType<ICodexSubscriptionService["pollLogin"]>;
}

class CodexHttpError extends Error {
  constructor(readonly status: number) {
    super(`Codex HTTP ${status}`);
  }
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function claims(token: string | undefined): Record<string, unknown> {
  if (!token) return {};
  try {
    return object(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()));
  } catch {
    return {};
  }
}
function identity(token: Token) {
  const id = claims(token.id_token);
  const access = claims(token.access_token);
  const auth = {
    ...object(access["https://api.openai.com/auth"]),
    ...object(id["https://api.openai.com/auth"]),
  };
  const workspaceId = auth.chatgpt_account_id ?? id.chatgpt_account_id;
  const subject = id.sub ?? auth.chatgpt_user_id ?? access.sub;
  const email = id.email ?? object(access["https://api.openai.com/profile"]).email;
  if (typeof workspaceId !== "string" || typeof subject !== "string")
    throw new Error("Codex account identity is missing");
  return {
    workspaceId,
    subject,
    email: typeof email === "string" ? email : subject,
    ...(typeof auth.chatgpt_plan_type === "string" ? { plan: auth.chatgpt_plan_type } : {}),
  };
}
function expiresAt(token: Token, now: number): number {
  const exp = claims(token.access_token).exp;
  return token.expires_in
    ? now + token.expires_in * 1000
    : typeof exp === "number"
      ? exp * 1000
      : now;
}
function headers(account: StoredAccount): Record<string, string> {
  return {
    Authorization: `Bearer ${account.accessToken}`,
    "ChatGPT-Account-Id": account.workspaceId,
    originator: "codex_cli_rs",
    version: VERSION,
  };
}

export function createCodexSubscription(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const pending = new Map<string, PendingLogin>();
  const projections = new Map<string, Pick<CodexAccount, "quota" | "stale" | "error">>();
  const read = async () => {
    const raw = await deps.credentials.load(STORE_KEY);
    // 损坏的凭据不能被当成空列表覆盖；schema 失败向调用方报告，不输出原始内容。
    let value: unknown;
    try {
      value = raw === null ? [] : JSON.parse(raw);
    } catch {
      throw new Error("Codex credential store is invalid");
    }
    const parsed = z.array(accountSchema).safeParse(value);
    if (!parsed.success) throw new Error("Codex credential store is invalid");
    return parsed.data;
  };
  const save = (accounts: StoredAccount[], assertCurrent?: () => void) =>
    deps.credentials.save(STORE_KEY, JSON.stringify(accounts), assertCurrent);
  const publicAccount = (a: StoredAccount): CodexAccount => ({
    id: a.id,
    email: a.email,
    workspaceId: a.workspaceId,
    plan: a.plan,
    needsLogin: a.needsLogin,
    models: [...a.models],
    stale: true,
    ...projections.get(a.id),
  });
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    // OAuth 与 backend 地址由服务固定，拒绝 redirect，避免令牌跟随到其他源。
    try {
      return await deps.fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error("Codex network request failed");
    }
  }
  async function json(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await request(url, init);
    if (!response.ok) throw new CodexHttpError(response.status);
    try {
      return await response.json();
    } catch {
      throw new Error("Codex response is invalid");
    }
  }
  async function exchange(fields: Record<string, string>): Promise<Token> {
    const parsed = tokenSchema.safeParse(
      await json(`${AUTH}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }).toString(),
      }),
    );
    if (!parsed.success) throw new Error("Codex token response is invalid");
    return parsed.data;
  }
  async function withAccount<T>(
    id: string,
    action: (a: StoredAccount, all: StoredAccount[]) => Promise<T>,
  ): Promise<T> {
    return deps.withLock(async () => {
      const all = await read();
      const account = all.find((a) => a.id === id);
      if (!account) throw new Error("Codex account was removed");
      return action(account, all);
    });
  }
  async function ensureToken(a: StoredAccount, all: StoredAccount[]) {
    if (a.needsLogin) throw new Error("Codex account requires login");
    if (a.expiresAt - now() > REFRESH_MARGIN_MS) return;
    try {
      const token = await exchange({ grant_type: "refresh_token", refresh_token: a.refreshToken });
      a.accessToken = token.access_token;
      a.refreshToken = token.refresh_token ?? a.refreshToken;
      a.expiresAt = expiresAt(token, now());
      await save(all);
    } catch (error) {
      if (error instanceof CodexHttpError && [400, 401, 403].includes(error.status)) {
        a.needsLogin = true;
        await save(all);
      }
      throw error;
    }
  }
  function assertPending(login: PendingLogin) {
    if (pending.get(login.view.id) !== login || login.view.expiresAt <= now()) {
      pending.delete(login.view.id);
      throw new Error("Codex login expired or cancelled");
    }
  }
  async function poll(login: PendingLogin): ReturnType<ICodexSubscriptionService["pollLogin"]> {
    assertPending(login);
    if (now() < login.nextPoll) return { status: "pending" };
    login.nextPoll = now() + login.view.intervalMs;
    const response = await request(`${AUTH}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id: login.deviceId, user_code: login.view.userCode }),
    });
    assertPending(login);
    if ([403, 404, 429].includes(response.status)) return { status: "pending" };
    if (!response.ok) {
      pending.delete(login.view.id);
      throw new CodexHttpError(response.status);
    }
    const parsed = z
      .object({ authorization_code: z.string(), code_verifier: z.string() })
      .safeParse(
        await response.json().catch(() => {
          throw new Error("Codex device response is invalid");
        }),
      );
    if (!parsed.success) throw new Error("Codex device response is invalid");
    const token = await exchange({
      grant_type: "authorization_code",
      code: parsed.data.authorization_code,
      code_verifier: parsed.data.code_verifier,
      redirect_uri: `${AUTH}/deviceauth/callback`,
    });
    assertPending(login);
    const info = identity(token);
    if (!token.refresh_token) throw new Error("Codex refresh token is missing");
    return deps.withLock(async () => {
      const all = await read();
      assertPending(login);
      const target = login.accountId ? all.find((a) => a.id === login.accountId) : undefined;
      if (
        login.accountId &&
        (!target || target.subject !== info.subject || target.workspaceId !== info.workspaceId)
      ) {
        pending.delete(login.view.id);
        throw new Error("Codex re-login account does not match");
      }
      const previous =
        target ?? all.find((a) => a.subject === info.subject && a.workspaceId === info.workspaceId);
      const account: StoredAccount = {
        ...info,
        id: previous?.id ?? randomUUID(),
        accessToken: token.access_token,
        refreshToken: token.refresh_token!,
        expiresAt: expiresAt(token, now()),
        needsLogin: false,
        models: previous?.models ?? [],
      };
      await save([...all.filter((a) => a.id !== account.id), account], () => assertPending(login));
      projections.set(account.id, { ...projections.get(account.id), stale: true });
      pending.delete(login.view.id);
      return { status: "complete", account: publicAccount(account) };
    });
  }
  const service: ICodexSubscriptionService = {
    async listAccounts() {
      return (await read()).map(publicAccount);
    },
    async startLogin(accountId) {
      if (accountId && !(await read()).some((a) => a.id === accountId))
        throw new Error("Codex account was removed");
      // 一个 Host 只保留最新登录流程；重新点击不能让旧授权覆盖新授权。
      pending.clear();
      const id = randomUUID();
      const login: PendingLogin = {
        deviceId: "",
        accountId,
        nextPoll: 0,
        view: {
          id,
          userCode: "",
          verificationUrl: `${AUTH}/codex/device`,
          expiresAt: now() + 900_000,
          intervalMs: 5000,
        },
      };
      pending.set(id, login);
      try {
        const result = z
          .object({
            device_auth_id: z.string(),
            user_code: z.string(),
            interval: z.union([z.string(), z.number()]).optional(),
            expires_in: z.number().positive().optional(),
          })
          .safeParse(
            await json(`${AUTH}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ client_id: CLIENT_ID }),
            }),
          );
        if (!result.success) throw new Error("Codex device response is invalid");
        assertPending(login);
        login.deviceId = result.data.device_auth_id;
        const interval = Number(result.data.interval ?? 5);
        login.view = {
          ...login.view,
          userCode: result.data.user_code,
          intervalMs: (Number.isFinite(interval) ? Math.max(5, interval) : 5) * 1000,
          expiresAt: now() + (result.data.expires_in ?? 900) * 1000,
        };
        return login.view;
      } catch (error) {
        pending.delete(id);
        throw error;
      }
    },
    async pollLogin(id) {
      const login = pending.get(id);
      if (!login) throw new Error("Codex login expired or cancelled");
      login.flight ??= poll(login).finally(() => {
        login.flight = undefined;
      });
      return login.flight;
    },
    async cancelLogin(id) {
      pending.delete(id);
    },
    async removeAccount(id) {
      for (const login of pending.values())
        if (login.accountId === id) pending.delete(login.view.id);
      await deps.withLock(async () => {
        await save((await read()).filter((a) => a.id !== id));
        // 退出后保留可选模型会让下一次请求才暴露失效账号；按绑定清理，绝不切到其他账号。
        const view = await deps.providers.getView();
        for (const provider of view.providers) {
          if (
            provider.effectiveConfig.access?.type === "codex-account" &&
            provider.effectiveConfig.access.accountId === id
          ) {
            await deps.providers.deletePersonalProvider(provider.providerId);
          }
        }
      });
      projections.delete(id);
    },
    async refreshAccount(id) {
      return withAccount(id, async (a, all) => {
        try {
          await ensureToken(a, all);
          const [modelResult, quotaResult] = await Promise.allSettled([
            json(`${BACKEND}/codex/models?client_version=${VERSION}`, { headers: headers(a) }),
            json(`${BACKEND}/wham/usage`, { headers: headers(a) }),
          ]);
          if (modelResult.status === "fulfilled") {
            const data = object(modelResult.value);
            const items = data.models ?? data.data ?? data.items;
            if (!Array.isArray(items)) throw new Error("Codex models response is invalid");
            a.models = [
              ...new Set(
                items.flatMap((item) => {
                  const model =
                    typeof item === "string" ? item : (object(item).slug ?? object(item).id);
                  return typeof model === "string" && model.length > 0 ? [model] : [];
                }),
              ),
            ];
            await save(all);
          }
          if (quotaResult.status === "fulfilled") {
            const data = object(quotaResult.value);
            const limits = object(data.rate_limit);
            const windows: CodexQuotaWindow[] = [
              limits.primary_window,
              limits.secondary_window,
            ].flatMap((value) => {
              const w = object(value);
              if (typeof w.used_percent !== "number" || !Number.isFinite(w.used_percent)) return [];
              return [
                {
                  remainingPercent: Math.max(0, Math.min(100, 100 - w.used_percent)),
                  ...(typeof w.limit_window_seconds === "number"
                    ? { windowSeconds: w.limit_window_seconds }
                    : {}),
                  ...(typeof w.reset_at === "number" ? { resetsAt: w.reset_at * 1000 } : {}),
                },
              ];
            });
            const credits = object(data.credits);
            projections.set(id, {
              stale: false,
              quota: {
                windows,
                updatedAt: now(),
                ...(typeof credits.balance === "string" || typeof credits.balance === "number"
                  ? { credits: String(credits.balance) }
                  : {}),
                ...(credits.unlimited === true ? { unlimitedCredits: true } : {}),
              },
            });
            if (typeof data.plan_type === "string") {
              a.plan = data.plan_type;
              await save(all);
            }
          }
          const failed = [modelResult, quotaResult].find((r) => r.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        } catch (error) {
          if (error instanceof CodexHttpError && [401, 403].includes(error.status)) {
            a.needsLogin = true;
            await save(all);
          }
          projections.set(id, {
            ...projections.get(id),
            stale: true,
            error: a.needsLogin ? "login_required" : "refresh_failed",
          });
        }
        return publicAccount(a);
      });
    },
    async connectAccount(id) {
      return withAccount(id, async (a) => {
        if (a.needsLogin || a.models.length === 0)
          throw new Error("Refresh Codex account models before connecting");
        const view = await deps.providers.getView();
        const existing = view.providers.find(
          (p) =>
            p.effectiveConfig.access?.type === "codex-account" &&
            p.effectiveConfig.access.accountId === id,
        );
        const initialConfig = {
          group: "standard-personal" as const,
          access: { type: "codex-account" as const, accountId: id },
          api: { type: "openai-responses" as const, baseUrl: `${BACKEND}/codex` },
        };
        const providerId =
          existing?.providerId ??
          (
            await deps.providers.createPersonalProvider({
              providerName: `Codex · ${a.email} · ${a.workspaceId.slice(0, 8)}`,
              initialConfig,
            })
          ).providerId;
        if (existing)
          await deps.providers.savePersonalProviderOverlay(providerId, {
            ...existing.personalConfig,
            ...initialConfig,
          });
        for (const modelId of a.models) {
          if (!existing?.models.some((m) => m.modelId === modelId))
            await deps.providers.addPersonalModel(providerId, modelId, {}, true);
        }
        return { providerId };
      });
    },
  };
  return {
    service,
    /** Host-only port: not registered on the RPC service. */
    async resolveRequestAuth(accountId: string, providerId: string) {
      const provider = (await deps.providers.getView()).providers.find(
        (p) => p.providerId === providerId,
      );
      if (
        provider?.effectiveConfig.access?.type !== "codex-account" ||
        provider.effectiveConfig.access.accountId !== accountId
      ) {
        throw new Error("Codex provider account binding changed");
      }
      return withAccount(accountId, async (a, all) => {
        await ensureToken(a, all);
        return {
          apiKey: a.accessToken,
          headers: {
            "ChatGPT-Account-Id": a.workspaceId,
            originator: "codex_cli_rs",
            version: VERSION,
          },
        };
      });
    },
  };
}
