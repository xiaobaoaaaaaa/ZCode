import { memo } from "react";
import { GaugeIcon } from "lucide-react";
import type { TurnPerformance } from "@zcode/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export interface TurnPerformanceSummaryProps {
  turnId: string;
  performance?: TurnPerformance;
  running: boolean;
}

/** 只读 CLI turnHeader；Popover 开关由现有组件拥有，没有第二份统计状态。 */
export const TurnPerformanceSummary = memo(function TurnPerformanceSummary({
  turnId,
  performance,
  running,
}: TurnPerformanceSummaryProps) {
  const { intl, locale } = useZCodeIntl();
  if (!performance || performance.requestCount === 0) return null;
  const label = (key: string) => intl.formatMessage({ id: `chat.performance.${key}` });
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const count = (value: number | null) => (value === null ? "—" : number(value));
  const duration = (value: number | null) => (value === null ? "—" : `${number(value / 1000)} s`);
  const tps =
    performance.generationDurationMs > 0 && performance.timedRequestCount > 0
      ? performance.timedOutputTokens / (performance.generationDurationMs / 1000)
      : null;
  const first =
    performance.firstResponseCount > 0
      ? performance.firstResponseTotalMs / performance.firstResponseCount
      : null;
  const speedText = tps === null ? null : `${number(tps)} tok/s`;
  const scope = label(running ? "runningScope" : "scope");
  const readings: [string, string][] = [
    ["requests", count(performance.requestCount)],
    ["speed", speedText ?? "—"],
    ["first", duration(first)],
    ["modelTime", duration(performance.modelDurationMs)],
    [
      "generationTime",
      duration(performance.timedRequestCount > 0 ? performance.generationDurationMs : null),
    ],
    ["input", count(performance.inputTokens)],
    ["output", count(performance.outputTokens)],
    ["reasoning", count(performance.reasoningTokens)],
    ["cacheRead", count(performance.cacheReadTokens)],
    ["cacheWrite", count(performance.cacheWriteTokens)],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`turn-performance-${turnId}`}
          aria-label={`${label("title")} · ${scope}${speedText ? ` · ${speedText}` : ""}${first !== null ? ` · ${label("first")} ${duration(first)}` : ""}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-ui-sm text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GaugeIcon aria-hidden className="size-3.5 shrink-0" />
          <span>{scope}</span>
          {speedText ? <span className="whitespace-nowrap tabular-nums">· {speedText}</span> : null}
          {first !== null ? (
            <span className="hidden whitespace-nowrap tabular-nums @min-[480px]/conversation:inline">
              · {label("firstShort")} {duration(first)}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={12}
        className="w-80 max-w-[calc(100vw-24px)] p-3"
        data-testid={`turn-performance-details-${turnId}`}
        aria-label={label("title")}
      >
        <div className="mb-2 text-ui-sm font-medium">{label("title")}</div>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-ui-sm">
          {readings.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-foreground-subtle">{label(key)}</dt>
              <dd className="text-right font-mono tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-ui-xs leading-relaxed text-foreground-subtle">
          {intl.formatMessage(
            { id: "chat.performance.coverage" },
            {
              timed: performance.timedRequestCount,
              first: performance.firstResponseCount,
              total: performance.requestCount,
            },
          )}
        </p>
        <p className="mt-1 text-ui-xs leading-relaxed text-foreground-subtle">
          {label("description")}
        </p>
      </PopoverContent>
    </Popover>
  );
});
