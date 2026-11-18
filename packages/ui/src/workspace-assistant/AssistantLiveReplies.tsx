import { FileText, LoaderCircle, Search } from "lucide-react";
import { ToolSummaryRow } from "@/ToolCallBlocks/ToolSummaryRow.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning.js";
import { useWorkspaceAssistantGenerations } from "./useWorkspaceAssistantGenerations.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function AssistantLiveReplies({
  visible,
  workspacePath,
  workspaceIdentity,
  pendingId,
  messages,
  titles,
  refresh,
}: {
  visible: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  pendingId?: string;
  messages: ReadonlySet<string>;
  titles: ReadonlyMap<string, string>;
  refresh: () => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const generating = useWorkspaceAssistantGenerations(
    visible,
    workspacePath,
    workspaceIdentity,
    refresh,
  );
  const replies = generating.filter(
    (row) => (row.text || row.reasoning || row.toolActivity) && !messages.has(row.id),
  );
  return (
    <>
      {replies.map((row) => (
        <div
          key={row.id}
          data-testid="workspace-assistant-live-reply"
          data-message-id={row.id}
          data-task-id={row.taskId}
          className="min-w-0"
        >
          {row.kind !== "router" && (
            <div className="mb-1 text-ui-caption font-medium text-foreground-subtle">
              {intl.formatMessage({
                id: `workspaceAssistant.${row.kind === "report" && !row.taskId ? "batchReport" : row.kind}`,
              })}
              {row.taskId && titles.get(row.taskId) && ` · ${titles.get(row.taskId)}`}
            </div>
          )}
          {row.reasoning && (
            <Reasoning isStreaming={!row.text}>
              <ReasoningTrigger
                streamingText={row.reasoning}
                getThinkingMessage={
                  row.text ? () => intl.formatMessage({ id: "chat.reasoning.thought" }) : undefined
                }
              />
              <ReasoningContent>{row.reasoning}</ReasoningContent>
            </Reasoning>
          )}
          {row.toolActivity && (
            <div
              data-testid="workspace-assistant-tool-activity"
              data-tool-name={row.toolActivity.name}
              data-tool-status={row.toolActivity.status}
            >
              <ToolSummaryRow
                toolId={row.id}
                canToggle={false}
                forceOpen={false}
                isExpanded={false}
                animateContent={false}
                disableContentAnimation
                contentKey={row.toolActivity.name}
                icon={
                  row.toolActivity.name === "Read" ? (
                    <FileText className="size-4" />
                  ) : (
                    <Search className="size-4" />
                  )
                }
                showIcon
                kindLabel={row.toolActivity.name}
                kindLabelClassName="text-foreground-subtle"
                primaryText={intl.formatMessage({
                  id: `chat.toolCall.status.${row.toolActivity.status}`,
                })}
                toggleAriaLabel={row.toolActivity.name}
              />
            </div>
          )}
          {row.text && <MessageResponse streaming>{row.text}</MessageResponse>}
        </div>
      ))}
      {pendingId &&
        !messages.has(`reply:${pendingId}`) &&
        !replies.some((row) => row.requestId === pendingId) && (
          <p
            role="status"
            className="flex items-center gap-2 text-ui-caption text-foreground-subtle"
          >
            <LoaderCircle className="size-4 animate-spin" />
            {intl.formatMessage({ id: "workspaceAssistant.sending" })}
          </p>
        )}
    </>
  );
}
