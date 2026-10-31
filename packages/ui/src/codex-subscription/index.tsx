import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexAccount, CodexDeviceLogin } from "./contract.js";
import { useCodexSubscriptionService } from "@/hooks/useModelProviders.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import type { CodexAccountsPanelProps } from "./contract.js";

export function CodexAccountsPanel({ className }: CodexAccountsPanelProps) {
  const service = useCodexSubscriptionService();
  const platform = usePlatform();
  const { intl, locale } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `codex.${id}` }, values);
  const [accounts, setAccounts] = useState<CodexAccount[]>([]);
  const [login, setLogin] = useState<CodexDeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [connected, setConnected] = useState(false);
  const generation = useRef(0);
  const run = useCallback(async (operation: () => Promise<void>) => {
    const version = generation.current;
    setBusy(true);
    setError(false);
    setConnected(false);
    try {
      await operation();
    } catch {
      if (version === generation.current) setError(true);
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    setAccounts([]);
    setLogin(null);
    setError(false);
    setBusy(false);
    if (service)
      void service
        .listAccounts()
        .then((value) => {
          if (version === generation.current) setAccounts(value);
        })
        .catch(() => {
          if (version === generation.current) setError(true);
        });
    return () => {
      generation.current++;
    };
  }, [service]);
  useEffect(() => {
    if (!login || !service) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await service.pollLogin(login.id);
        if (cancelled) return;
        if (result.status === "pending") {
          timer = setTimeout(() => void poll(), login.intervalMs);
          return;
        }
        await service.refreshAccount(result.account.id);
        const value = await service.listAccounts();
        if (!cancelled) {
          setAccounts(value);
          setLogin(null);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLogin(null);
        }
      }
    };
    timer = setTimeout(() => void poll(), login.intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void service.cancelLogin(login.id).catch(() => {});
    };
  }, [login, service]);
  if (!service) return null;
  const reload = async (version: number) => {
    const value = await service.listAccounts();
    if (version === generation.current) setAccounts(value);
  };
  const startLogin = (accountId?: string) =>
    run(async () => {
      const version = generation.current;
      const value = await service.startLogin(accountId);
      if (version !== generation.current) {
        await service.cancelLogin(value.id);
        return;
      }
      setLogin(value);
      platform.openExternal(value.verificationUrl);
    });
  return (
    <section
      data-testid="codex-accounts"
      className={`space-y-3 rounded-xl border border-border bg-card p-4 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui-lg font-medium">{t("title")}</h3>
        <Button
          variant="outline"
          disabled={busy || !!login}
          onClick={() => void startLogin()}
          data-testid="codex-login"
        >
          {t("login")}
        </Button>
      </div>
      <p className="text-ui-base text-foreground-subtle">{t("description")}</p>
      {error && (
        <p role="alert" className="text-ui-base text-destructive">
          {t("error")}
        </p>
      )}
      {connected && (
        <p role="status" className="text-ui-base text-success">
          {t("connected")}
        </p>
      )}
      {login && (
        <div className="space-y-2 rounded-lg bg-surface p-3" data-testid="codex-device-login">
          <p className="text-ui-base">{t("code")}</p>
          <code className="select-all text-ui-xl font-semibold" data-testid="codex-user-code">
            {login.userCode}
          </code>
          <p role="status" className="text-ui-caption text-foreground-subtle">
            {t("waiting")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => platform.openExternal(login.verificationUrl)}>
              {t("open")}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void run(async () => {
                  const version = generation.current;
                  await service.cancelLogin(login.id);
                  if (version === generation.current) setLogin(null);
                })
              }
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {accounts.length === 0 && <p className="text-ui-base text-foreground-subtle">{t("empty")}</p>}
      {accounts.map((account) => (
        <div
          key={account.id}
          className="space-y-2 border-t border-border pt-3"
          data-testid="codex-account"
        >
          <div className="flex flex-wrap items-center gap-2 text-ui-base">
            <span className="break-all font-medium">{account.email}</span>
            <span className="text-foreground-subtle">
              {account.plan} · {t("models", { count: account.models.length })}
            </span>
          </div>
          <p className="break-all text-ui-caption text-foreground-subtle">{account.workspaceId}</p>
          {account.needsLogin && (
            <p role="alert" className="text-ui-base text-warning">
              {t("required")}
            </p>
          )}
          {!account.quota?.windows.length && (
            <p className="text-ui-caption text-foreground-subtle">{t("unknown")}</p>
          )}
          {account.quota?.windows.map((window, index) => (
            <div key={index} className="flex flex-wrap gap-x-3 gap-y-1 text-ui-caption">
              {window.windowSeconds && (
                <span>
                  {t("window", { hours: Math.round((window.windowSeconds / 3600) * 10) / 10 })}
                </span>
              )}
              <span>{t("remaining", { percent: Math.round(window.remainingPercent) })}</span>
              {window.resetsAt && (
                <span className="text-foreground-subtle">
                  {t("reset", { time: new Date(window.resetsAt).toLocaleString(locale) })}
                </span>
              )}
            </div>
          ))}
          {account.quota?.unlimitedCredits ? (
            <p className="text-ui-caption">{t("unlimited")}</p>
          ) : (
            account.quota?.credits !== undefined && (
              <p className="text-ui-caption">{t("credits", { value: account.quota.credits })}</p>
            )
          )}
          {account.stale && <p className="text-ui-caption text-foreground-subtle">{t("stale")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="codex-refresh"
              variant="outline"
              disabled={busy || !!login}
              onClick={() =>
                void run(async () => {
                  const version = generation.current;
                  await service.refreshAccount(account.id);
                  await reload(version);
                })
              }
            >
              {t("refresh")}
            </Button>
            <Button
              data-testid="codex-connect"
              variant="outline"
              disabled={busy || account.needsLogin || !account.models.length}
              onClick={() =>
                void run(async () => {
                  const version = generation.current;
                  await service.connectAccount(account.id);
                  if (version === generation.current) setConnected(true);
                })
              }
            >
              {t("connect")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !!login}
              onClick={() => void startLogin(account.id)}
            >
              {t("relogin")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !!login}
              onClick={() =>
                void run(async () => {
                  const version = generation.current;
                  await service.removeAccount(account.id);
                  await reload(version);
                })
              }
            >
              {t("remove")}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
