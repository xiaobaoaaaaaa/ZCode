import { activeClarification } from "./activeClarification.js";
import { useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListTodo,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { Button } from "@/components/ui/button.js";
import { ChatPromptEditor } from "@/prompt-editor/ChatPromptEditor.js";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import { ConversationUserInputBubble } from "@/v4/ConversationUserInputBubble.js";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning.js";
import { useAssistantSubmissionControls } from "./useAssistantSubmissionControls.js";
import { AssistantLiveReplies } from "./AssistantLiveReplies.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getPathLeaf } from "@/lib/path.js";
import { useOptionalProjectDirectory } from "@/project-sidebar/index.js";
import type { WorkspaceAssistantPageProps } from "./contract.js";
import { useAssistantConversation, isAssistantErrorCode } from "./useAssistantConversation.js";

export function WorkspaceAssistantPage({
  visible,
  workspacePath,
  workspaceIdentity,
  activeTaskId,
  draftProjectId,
  onOpenTask,
}: WorkspaceAssistantPageProps) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `workspaceAssistant.${key}` });
  const directory = useOptionalProjectDirectory();
  const tree = directory?.tree;
  // 项目树尚未水合时不能按“未分类”读取近期完全访问权限，避免将别处的模式带入此项目。
  const scopeFailed = Boolean(
    directory?.hostReadErrors.has("local") ||
    (directory?.error && !directory.onlineHostIds.has("local")),
  );
  const scopeReady =
    !(activeTaskId || draftProjectId) || Boolean(directory && !directory.loading && !scopeFailed);
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const selectedProjectId = activeTaskId
    ? tree?.tasks.find(
        (row) =>
          row.hostId === "local" &&
          row.taskId === activeTaskId &&
          (row.workspaceIdentity?.trim() || row.workspacePath) === workspaceKey,
      )?.projectId
    : draftProjectId;
  const projectId = tree?.projects.find(
    (project) => project.id === selectedProjectId && project.hostId === "local" && !project.deleted,
  )?.id;
  const {
    state,
    progress,
    deletedIds,
    pending,
    failedInput,
    errorCode,
    readFailed,
    send,
    refresh,
    text,
    target,
    setText,
    setTarget,
    page,
    setPage,
    pageCount,
    visibleItems,
  } = useAssistantConversation(visible, workspacePath, workspaceIdentity, projectId);
  const editor = useRef<LexicalChatInputHandle>(null);
  const configuration = useAssistantSubmissionControls(
    workspacePath,
    workspaceIdentity,
    projectId,
    Boolean(pending) || !visible || !scopeReady,
  );
  const followUp = (taskId: string) => {
    setTarget(taskId);
    editor.current?.focus();
  };
  const titles = useMemo(
    () => new Map(state?.items.map((item) => [item.taskId, item.title])),
    [state?.items],
  );
  const statuses = new Map(progress.map((result) => [result.taskId, result]));
  const messages = state?.messages ?? [];
  const storedIds = useMemo(
    () => new Set(state?.messages.map((message) => message.id)),
    [state?.messages],
  );
  const clarification = activeClarification(messages);
  const [visibleCount, setVisibleCount] = useState(60);
  const firstVisible = Math.max(0, messages.length - visibleCount);
  const pendingVisible = pending && !messages.some((message) => message.id === pending.id);
  const targetDeleted = Boolean(target && deletedIds.has(target));
  const handleSubmit = (value: string) => {
    const prompt = value.trim();
    if (
      !prompt ||
      prompt.length > 32000 ||
      !state ||
      pending ||
      targetDeleted ||
      (!target && (!scopeReady || !configuration.modelReady))
    )
      return false;
    void send(
      {
        id: crypto.randomUUID(),
        text: prompt,
        targetTaskId: target,
        ...(configuration.modelReady && configuration.modelSelection
          ? { modelSelection: configuration.modelSelection }
          : {}),
        permissionMode: configuration.permissionMode,
      },
      target ? undefined : configuration.prepareAcceptedPreference(),
    );
    setText("");
    setTarget(undefined);
    editor.current?.clear();
    return true;
  };
  const errorDetail = (code?: string) =>
    code &&
    (isAssistantErrorCode(code) ? (
      <span>{t("error." + code)}</span>
    ) : (
      <details className="mt-1">
        <summary className="cursor-pointer">{t("details")}</summary>
        <code>{code}</code>
      </details>
    ));
  return (
    <main
      data-testid="workspace-assistant-page"
      className="@container flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5 [app-region:drag]">
        <h1 className="text-ui-lg font-semibold">{t("title")}</h1>
        <span
          className="min-w-0 truncate text-ui-caption text-foreground-subtle"
          title={workspacePath}
        >
          {getPathLeaf(workspacePath)}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
        <section className="@container/conversation flex min-h-0 min-w-0 flex-1 flex-col">
          <Conversation>
            <ConversationContent className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
              {!messages.length && !pending && (
                <p className="py-8 text-center text-ui-base text-foreground-subtle">
                  {state ? t("empty") : readFailed ? null : t("loading")}
                </p>
              )}
              {firstVisible > 0 && (
                <Button
                  className="self-center"
                  variant="ghost"
                  onClick={() => setVisibleCount((n) => n + 60)}
                >
                  {t("earlier")}
                </Button>
              )}
              {messages.slice(firstVisible).map((message) => {
                const taskDeleted = Boolean(message.taskId && deletedIds.has(message.taskId));
                const showChoices = clarification?.reply.id === message.id;
                const userMessage = message.role === "user" && !message.kind;
                return (
                  <div
                    key={message.id}
                    data-testid="workspace-assistant-message"
                    data-role={message.role}
                    data-kind={message.kind}
                    data-task-id={message.taskId}
                    className={
                      userMessage ? "flex max-w-full flex-col items-end self-end" : "min-w-0"
                    }
                  >
                    {message.kind && (
                      <div className="mb-1 text-ui-caption font-medium text-foreground-subtle">
                        {t(
                          message.kind === "report" && !message.taskId
                            ? "batchReport"
                            : message.kind,
                        )}
                        {message.taskId &&
                          titles.has(message.taskId) &&
                          ` · ${titles.get(message.taskId)}`}
                      </div>
                    )}
                    {message.reasoning && (
                      <Reasoning defaultOpen={false}>
                        <ReasoningTrigger
                          getThinkingMessage={() =>
                            intl.formatMessage({ id: "chat.reasoning.thought" })
                          }
                        />
                        <ReasoningContent>{message.reasoning}</ReasoningContent>
                      </Reasoning>
                    )}
                    {userMessage ? (
                      <ConversationUserInputBubble text={message.text} rowId={message.id} />
                    ) : (
                      <MessageResponse>{message.text}</MessageResponse>
                    )}
                    {message.taskId && titles.has(message.taskId) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Button
                          variant="link"
                          size="sm"
                          disabled={taskDeleted}
                          onClick={() => onOpenTask(message.taskId!)}
                        >
                          {message.role === "assistant" &&
                          message.text === titles.get(message.taskId)
                            ? t("open")
                            : titles.get(message.taskId)}
                          {taskDeleted ? t("status.deleted") : <ExternalLink />}
                        </Button>
                        {!taskDeleted && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!pending}
                            data-testid="workspace-assistant-message-continue"
                            onClick={() => followUp(message.taskId!)}
                          >
                            <MessageSquarePlus />
                            {t("continue")}
                          </Button>
                        )}
                      </div>
                    )}
                    {showChoices ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message
                          .choices!.filter((id) => titles.has(id))
                          .map((id) => (
                            <Button
                              key={id}
                              variant="outline"
                              size="sm"
                              disabled={!!pending || deletedIds.has(id)}
                              data-testid="workspace-assistant-choice"
                              data-task-id={id}
                              onClick={() =>
                                void send({
                                  id: message.choiceRequestId!,
                                  text: clarification.source.text,
                                  targetTaskId: id,
                                })
                              }
                            >
                              {titles.get(id)} {deletedIds.has(id) && t("status.deleted")}
                            </Button>
                          ))}
                      </div>
                    ) : null}
                    {message.retryable && message.role === "user" && message.id !== pending?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!pending || taskDeleted}
                        onClick={() =>
                          void send({
                            id: message.id,
                            text: message.text,
                            targetTaskId: message.taskId,
                          })
                        }
                      >
                        {t("retry")}
                      </Button>
                    )}
                  </div>
                );
              })}
              {pendingVisible && (
                <div className="self-end">
                  <ConversationUserInputBubble text={pending.text} rowId={pending.id} />
                </div>
              )}
              <AssistantLiveReplies
                visible={visible}
                workspacePath={workspacePath}
                workspaceIdentity={workspaceIdentity}
                pendingId={pending?.id}
                messages={storedIds}
                titles={titles}
                refresh={refresh}
              />
            </ConversationContent>
          </Conversation>
          <div className="mx-auto w-full max-w-3xl px-4 pb-4">
            {readFailed && (
              <div role="alert" className="mb-2 text-ui-caption">
                {t("readError")} {errorDetail(readFailed)}{" "}
                <Button variant="link" onClick={() => void refresh()}>
                  {t("refresh")}
                </Button>
              </div>
            )}
            {failedInput && (
              <div role="alert" className="mb-2 text-ui-caption">
                {t("sendError")} {errorDetail(errorCode)}{" "}
                {errorCode !== "input-conflict" &&
                  errorCode !== "deleted" &&
                  !messages.some((m) => m.id === failedInput.id && m.retryable) && (
                    <Button
                      disabled={!!pending}
                      variant="link"
                      onClick={() => void send(failedInput)}
                    >
                      {t("retry")}
                    </Button>
                  )}
              </div>
            )}
            {text.length > 32000 && (
              <p role="alert" className="text-ui-caption text-warning">
                {t("tooLong")}
              </p>
            )}
            {!target && (!scopeReady || !configuration.modelReady) && (
              <p className="mb-1 text-ui-caption text-foreground-subtle">
                {t(scopeReady ? "selectModel" : scopeFailed ? "scopeError" : "scopeLoading")}
                {!scopeReady && scopeFailed && (
                  <Button variant="link" onClick={() => void directory?.refresh()}>
                    {t("retry")}
                  </Button>
                )}
              </p>
            )}
            <p className="mb-1 text-ui-caption text-foreground-subtle">
              {t(target ? "targetOptions" : "newOptions")}
            </p>
            <ChatPromptEditor
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              taskId={null}
              initialValue={text}
              placeholder={t("prompt")}
              submitLabel={t("send")}
              submitDisabled={
                !text.trim() ||
                !state ||
                !!pending ||
                targetDeleted ||
                text.length > 32000 ||
                (!target && (!scopeReady || !configuration.modelReady))
              }
              inputTestId="workspace-assistant-input"
              submitTestId="workspace-assistant-send"
              inputApiRef={editor}
              enableMentionPanel={false}
              onChange={setText}
              onSubmit={handleSubmit}
              leadingActions={configuration.controls}
              topContent={
                target ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    title={t("clearTarget")}
                    onClick={() => setTarget(undefined)}
                  >
                    {titles.get(target)} {targetDeleted && t("status.deleted")} <X />
                  </Button>
                ) : undefined
              }
            />
          </div>
        </section>
        {state?.items.length ? (
          <aside
            aria-label={t("items")}
            className="max-h-[34%] shrink-0 overflow-y-auto border-t border-border p-3 @2xl:max-h-full @2xl:w-64 @2xl:border-t-0 @2xl:border-l"
          >
            <h2 className="mb-3 flex items-center gap-2 text-ui-base font-medium">
              <ListTodo className="size-4" />
              {t("items")}
            </h2>
            <ul className="space-y-2">
              {visibleItems.map((item) => {
                const result = statuses.get(item.taskId);
                const deleted = deletedIds.has(item.taskId);
                return (
                  <li
                    key={item.taskId}
                    data-testid="workspace-assistant-item"
                    data-task-id={item.taskId}
                    className="rounded-lg border border-border bg-surface p-2.5"
                  >
                    <div className="break-words text-ui-base font-medium">{item.title}</div>
                    <span
                      data-testid="workspace-assistant-status"
                      className="text-ui-caption text-foreground-subtle"
                    >
                      {t(`status.${result?.status ?? (readFailed ? "unavailable" : "loading")}`)}
                    </span>
                    {result?.summary && (
                      <p className="mt-1 whitespace-pre-wrap text-ui-caption [overflow-wrap:anywhere]">
                        {result.summary}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleted}
                        data-testid="workspace-assistant-open-task"
                        onClick={() => onOpenTask(item.taskId)}
                      >
                        <ExternalLink />
                        {t("open")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleted || !!pending}
                        data-testid="workspace-assistant-continue-task"
                        onClick={() => followUp(item.taskId)}
                      >
                        <MessageSquarePlus />
                        {t("continue")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {pageCount > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={page === 0}
                  aria-label={t("previous")}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-ui-caption">
                  {page + 1} / {pageCount}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={page + 1 === pageCount}
                  aria-label={t("next")}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </main>
  );
}
