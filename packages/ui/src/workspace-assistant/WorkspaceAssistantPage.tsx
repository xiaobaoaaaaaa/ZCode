import { useRef, useState } from "react";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListTodo,
  LoaderCircle,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
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
  const tree = useOptionalProjectDirectory()?.tree;
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
  const editor = useRef<HTMLTextAreaElement>(null);
  const titles = new Map(state?.items.map((item) => [item.taskId, item.title]));
  const statuses = new Map(progress.map((result) => [result.taskId, result]));
  const messages = state?.messages ?? [];
  const [visibleCount, setVisibleCount] = useState(60);
  const firstVisible = Math.max(0, messages.length - visibleCount);
  const pendingVisible = pending && !messages.some((message) => message.id === pending.id);
  const targetDeleted = Boolean(target && deletedIds.has(target));
  const handleSubmit = () => {
    const prompt = text.trim();
    if (!prompt || !state || pending || targetDeleted) return;
    void send({ id: crypto.randomUUID(), text: prompt, targetTaskId: target });
    setText("");
    setTarget(undefined);
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
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
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
              {messages.slice(firstVisible).map((message, offset) => {
                const index = offset + firstVisible;
                const source = messages[index - 1];
                const taskDeleted = Boolean(message.taskId && deletedIds.has(message.taskId));
                const showChoices =
                  index === messages.length - 1 &&
                  source?.role === "user" &&
                  message.choiceRequestId &&
                  message.choices?.length;
                return (
                  <div
                    key={message.id}
                    data-testid="workspace-assistant-message"
                    data-role={message.role}
                    data-task-id={message.taskId}
                    className={
                      message.role === "user"
                        ? "max-w-[90%] self-end rounded-xl bg-surface px-3 py-2"
                        : "min-w-0"
                    }
                  >
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap text-ui-base [overflow-wrap:anywhere]">
                        {message.text}
                      </p>
                    ) : (
                      <MessageResponse>{message.text}</MessageResponse>
                    )}
                    {message.taskId && titles.has(message.taskId) && (
                      <Button
                        variant="link"
                        size="sm"
                        disabled={taskDeleted}
                        onClick={() => onOpenTask(message.taskId!)}
                      >
                        {message.role === "assistant" && message.text === titles.get(message.taskId)
                          ? t("open")
                          : titles.get(message.taskId)}
                        {taskDeleted ? t("status.deleted") : <ExternalLink />}
                      </Button>
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
                                  text: source.text,
                                  targetTaskId: id,
                                })
                              }
                            >
                              {titles.get(id)} {deletedIds.has(id) && t("status.deleted")}
                            </Button>
                          ))}
                      </div>
                    ) : null}
                    {message.retryable && message.role === "user" && (
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
                <p className="max-w-[90%] self-end whitespace-pre-wrap rounded-xl bg-surface px-3 py-2 text-ui-base [overflow-wrap:anywhere]">
                  {pending.text}
                </p>
              )}
              {pending && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-ui-caption text-foreground-subtle"
                >
                  <LoaderCircle className="size-4 animate-spin" />
                  {t("sending")}
                </p>
              )}
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
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleSubmit();
              }}
              className="rounded-xl border border-border bg-input p-2 focus-within:border-border-hover"
            >
              {target && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  title={t("clearTarget")}
                  onClick={() => setTarget(undefined)}
                >
                  {titles.get(target)} {targetDeleted && t("status.deleted")} <X />
                </Button>
              )}
              <div className="flex items-end gap-2">
                <Textarea
                  ref={editor}
                  maxLength={32000}
                  value={text}
                  rows={2}
                  placeholder={t("prompt")}
                  aria-label={t("prompt")}
                  data-testid="workspace-assistant-input"
                  className="min-h-11 max-h-40 border-0 bg-transparent focus-visible:ring-0"
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!state || !!pending || targetDeleted || !text.trim()}
                  aria-label={t("send")}
                  title={t("send")}
                  data-testid="workspace-assistant-send"
                >
                  <ArrowUp />
                </Button>
              </div>
            </form>
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
                        onClick={() => {
                          setTarget(item.taskId);
                          editor.current?.focus();
                        }}
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
