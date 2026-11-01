import { useCallback, useEffect, useRef, useState } from "react";
import type { CodexAccount, CodexDeviceLogin } from "./contract.js";
import { useCodexSubscriptionService } from "@/hooks/useModelProviders.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { CodexAccountCard } from "./AccountCard.js";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";
import type { CodexAccountsPanelProps } from "./contract.js";

export function CodexAccountsPanel({ className }: CodexAccountsPanelProps) {
  const service = useCodexSubscriptionService();
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `codex.${id}` }, values);
  const [accounts, setAccounts] = useState<CodexAccount[]>([]);
  const [login, setLogin] = useState<CodexDeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"error" | "syncError" | null>(null);
  const [syncedAccountId, setSyncedAccountId] = useState<string | null>(null);
  const generation = useRef(0);
  const run = useCallback(
    async (operation: () => Promise<void>, failure: "error" | "syncError" = "error") => {
      const version = generation.current;
      setBusy(true);
      setError(null);
      setSyncedAccountId(null);
      try {
        await operation();
      } catch {
        if (version === generation.current) setError(failure);
      } finally {
        if (version === generation.current) setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    const version = ++generation.current;
    setAccounts([]);
    setSyncedAccountId(null);
    setLogin(null);
    setError(null);
    setBusy(false);
    if (service)
      void service
        .listAccounts()
        .then((value) => {
          if (version === generation.current) setAccounts(value);
        })
        .catch(() => {
          if (version === generation.current) setError("error");
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
          setError("error");
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
    <section data-testid="codex-accounts" className={`min-w-0 space-y-4 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderLogo logo={{ type: "builtin", key: "openai" }} className="size-5" />
          <h3 className="text-ui-lg font-medium">{t("title")}</h3>
        </div>
        <Button
          variant="outline"
          disabled={busy || !!login}
          onClick={() => void startLogin()}
          data-testid="codex-login"
        >
          <PlusIcon className="size-3.5" />
          {t("login")}
        </Button>
      </div>
      {accounts.length === 0 && !login && (
        <p className="text-ui-base text-foreground-subtle">{t("description")}</p>
      )}
      {error && (
        <p role="alert" className="text-ui-base text-destructive">
          {t(error)}
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
        <CodexAccountCard
          key={account.id}
          account={account}
          busy={busy || !!login}
          synced={syncedAccountId === account.id}
          onRefresh={() =>
            void run(async () => {
              const version = generation.current;
              await service.refreshAccount(account.id);
              await reload(version);
            })
          }
          onSync={() =>
            void run(async () => {
              const version = generation.current;
              await service.connectAccount(account.id);
              if (version === generation.current) setSyncedAccountId(account.id);
            }, "syncError")
          }
          onRelogin={() => void startLogin(account.id)}
          onRemove={() =>
            void run(async () => {
              const version = generation.current;
              await service.removeAccount(account.id);
              await reload(version);
            })
          }
        />
      ))}
    </section>
  );
}
