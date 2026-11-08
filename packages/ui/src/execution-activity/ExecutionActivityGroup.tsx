import { useState, type ReactNode } from "react";
import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  EXECUTION_ACTIVITY_TOOL_CATEGORIES,
  type ExecutionActivityDescriptor,
} from "./contract.js";

export function ExecutionActivityGroup({
  activity,
  children,
  autoExpandRunning = false,
}: {
  activity: ExecutionActivityDescriptor;
  children: ReactNode;
  autoExpandRunning?: boolean;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  // 自动展开是运行事实的派生值；用户手动选择后，流式更新不能抢回开合状态。
  const open = manualOpen ?? (autoExpandRunning && activity.running);
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "chat.executionActivity.title" });
  const summaries = [
    activity.reasoningCount > 0
      ? intl.formatMessage(
          { id: "chat.executionActivity.thinking" },
          { count: activity.reasoningCount },
        )
      : null,
    ...EXECUTION_ACTIVITY_TOOL_CATEGORIES.map((category) => {
      const count = activity.toolCounts[category] ?? 0;
      return count > 0
        ? intl.formatMessage({ id: `chat.executionActivity.${category}` }, { count })
        : null;
    }),
  ].filter((summary): summary is string => summary !== null);
  const counts = summaries.join(" · ");
  const status = intl.formatMessage({
    id: activity.running ? "chat.executionActivity.running" : "chat.executionActivity.completed",
  });
  return (
    <Collapsible
      open={open}
      onOpenChange={setManualOpen}
      data-execution-activity={activity.key}
      data-activity-running={String(activity.running)}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto min-h-7 max-w-full justify-start gap-2 px-1 py-1 text-left text-ui-sm text-foreground-subtle focus-visible:ring-2 focus-visible:ring-input-border-focused"
          data-testid="execution-activity-trigger"
          aria-label={`${label} · ${counts} · ${status}`}
        >
          <ChevronRightIcon
            aria-hidden
            className={
              open
                ? "size-4 shrink-0 rotate-90 transition-transform"
                : "size-4 shrink-0 transition-transform"
            }
          />
          <span className="flex min-w-0 flex-wrap gap-x-1.5 text-foreground-subtle">
            <span className="mr-0.5 whitespace-nowrap">{label}</span>
            {summaries.map((summary, index) => (
              // 类别和次数应作为一个短语换行，防止手机宽度把“搜索”拆成两行。
              <span className="whitespace-nowrap" key={summary}>
                {summary}
                {index < summaries.length - 1 && (
                  <span aria-hidden className="ml-1.5">
                    ·
                  </span>
                )}
              </span>
            ))}
          </span>
          {activity.running ? (
            <Loader2Icon
              aria-hidden
              className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
            />
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent data-testid="execution-activity-content">
        <div className="flex min-w-0 flex-col gap-4 pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
