import { CheckIcon, MoreHorizontalIcon, RefreshCwIcon } from "lucide-react";
import type { CodexAccountCardProps } from "./contract.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Progress } from "@/components/ui/progress.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { PlanStatusCardSurface } from "@/settings/model-provider-section/StatusCards.js";

export function CodexAccountCard({
  account,
  busy,
  synced,
  onRefresh,
  onSync,
  onRelogin,
  onRemove,
}: CodexAccountCardProps) {
  const { intl, locale } = useZCodeIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `codex.${id}` }, values);
  const plan = account.plan?.replace(/[_-]/g, " ");
  const title = plan ? `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : "ChatGPT";
  const credits = account.quota?.credits;
  return (
    <div className="min-w-0 space-y-4" data-testid="codex-account">
      <PlanStatusCardSurface
        planTitle={title}
        statusMeta={
          <ControlHintTooltip title={account.email} description={account.workspaceId}>
            <span
              tabIndex={0}
              className="min-w-0 max-w-full truncate text-ui-base text-foreground-subtle"
            >
              {account.email}
            </span>
          </ControlHintTooltip>
        }
        trailingAction={
          <div className="flex items-center gap-1">
            <ControlHintTooltip title={t("refresh")}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("refresh")}
                disabled={busy}
                onClick={onRefresh}
                data-testid="codex-refresh"
              >
                <RefreshCwIcon className="size-4" />
              </Button>
            </ControlHintTooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("more")}
                  disabled={busy}
                  data-testid="codex-more"
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onRelogin}>{t("relogin")}</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  {t("remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
        usageContent={
          <div className="space-y-2">
            <p className="text-ui-base text-foreground-subtle">{t("quota")}</p>
            {account.needsLogin && (
              <p role="alert" className="text-ui-base text-warning">
                {t("required")}
              </p>
            )}
            {account.stale && <p className="text-ui-caption text-warning">{t("stale")}</p>}
            {account.quota?.windows.length ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
                {account.quota.windows.map((window, index) => {
                  const label =
                    window.windowSeconds === 604800
                      ? t("weekly")
                      : window.windowSeconds
                        ? t("window", {
                            hours: Math.round((window.windowSeconds / 3600) * 10) / 10,
                          })
                        : t("quota");
                  const remaining = Math.max(0, Math.min(100, window.remainingPercent));
                  const reset = window.resetsAt ? new Date(window.resetsAt) : null;
                  return (
                    <div
                      key={index}
                      className="min-w-0 rounded-lg bg-surface p-3"
                      data-testid="codex-quota-meter"
                    >
                      <p className="text-ui-base font-medium">{label}</p>
                      <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
                        <span className="text-ui-lg font-semibold leading-none">
                          {Math.round(remaining)}%
                        </span>
                        {reset && (
                          <ControlHintTooltip
                            title={t("reset", { time: reset.toLocaleString(locale) })}
                          >
                            <span tabIndex={0} className="text-ui-sm text-foreground-subtle">
                              {reset.toLocaleDateString(locale, { month: "short", day: "numeric" })}
                            </span>
                          </ControlHintTooltip>
                        )}
                      </div>
                      <Progress
                        value={remaining}
                        aria-valuenow={remaining}
                        aria-label={label}
                        className="mt-2 h-1.5 rounded-full bg-secondary"
                        indicatorClassName="bg-usage-chart-1"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-ui-caption text-foreground-subtle">{t("unknown")}</p>
            )}
            {account.quota?.unlimitedCredits ? (
              <p className="text-ui-caption text-foreground-subtle" data-testid="codex-credits">
                {t("unlimited")}
              </p>
            ) : credits !== undefined && Number(credits) > 0 ? (
              <p className="text-ui-caption text-foreground-subtle" data-testid="codex-credits">
                {t("credits", { value: credits })}
              </p>
            ) : null}
          </div>
        }
      />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-ui-base text-foreground-subtle">{t("availableModels")}</h4>
          <div className="flex items-center gap-2">
            {synced && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-ui-caption text-success"
              >
                <CheckIcon className="size-3.5" />
                {t("connected")}
              </span>
            )}
            <Button
              variant="secondary"
              disabled={busy || account.needsLogin || !account.models.length}
              onClick={onSync}
              data-testid="codex-connect"
            >
              <RefreshCwIcon className="size-3.5" />
              {t("connect")}
            </Button>
          </div>
        </div>
        {account.models.length ? (
          <ul
            className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border"
            aria-label={t("availableModels")}
          >
            {account.models.map((model) => (
              <li
                key={model}
                className="break-all px-3 py-2 font-mono text-ui-base"
                data-testid="codex-model-row"
              >
                {model}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui-caption text-foreground-subtle">{t("noModels")}</p>
        )}
      </div>
    </div>
  );
}
