import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServices } from "@/hooks/useServices.js";

import {
  useWorkspaceAssistantDraft,
  emptyAssistantDraft,
  type AssistantInput,
} from "@/store/workspaceAssistantDraft.js";

type AssistantService = NonNullable<ReturnType<typeof useServices>["workspaceAssistantService"]>;
type AssistantState = NonNullable<Awaited<ReturnType<AssistantService["read"]>>>;
type Progress = Awaited<ReturnType<AssistantService["progress"]>>;
const ITEMS_PER_PAGE = 10;
const assistantErrorCodes = new Set([
  "model-unavailable",
  "invalid-decision",
  "invalid-target",
  "deleted",
  "unavailable",
  "unconfirmed-input",
  "unknown-task",
  "input-conflict",
]);

// RPC 异常可能携带服务端原文，仅保留已知业务原因、HTTP 状态和常见系统错误码。
function diagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const business = /workspace-assistant\.([a-z-]+)/.exec(message)?.[1];
  if (business && assistantErrorCodes.has(business)) return business;
  const http = /\b(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?)\s*[:=]?\s*([45]\d\d)\b/i.exec(
    message,
  )?.[1];
  if (http) return `HTTP ${http}`;
  return (
    /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|SQLITE_BUSY|SQLITE_ERROR|SQLITE_READONLY|ENOENT)\b/.exec(
      message,
    )?.[0] ?? "RPC"
  );
}
export function isAssistantErrorCode(code: string) {
  return assistantErrorCodes.has(code);
}
function itemsOnPage(items: AssistantState["items"], page: number) {
  const end = Math.max(0, items.length - page * ITEMS_PER_PAGE);
  return items.slice(Math.max(0, end - ITEMS_PER_PAGE), end).reverse();
}

export function useAssistantConversation(
  visible: boolean,
  workspacePath: string,
  workspaceIdentity?: string,
  projectId?: string,
) {
  const service = useServices().workspaceAssistantService;
  const scope = useMemo(
    () => ({ workspacePath, workspaceIdentity }),
    [workspaceIdentity, workspacePath],
  );
  const [state, setState] = useState<AssistantState | null>(null);
  const latestState = useRef<AssistantState | null>(null);
  const [progress, setProgress] = useState<Progress>([]);
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(0);
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const draft = useWorkspaceAssistantDraft((s) => s.drafts[workspaceKey] ?? emptyAssistantDraft);
  const updateDraft = useWorkspaceAssistantDraft.getState().update;

  const [readFailed, setReadFailed] = useState<string>();
  const latestRead = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const sending = Boolean(draft.pending);
  const target = draft.target;
  const refresh = useCallback(async () => {
    if (!service) return;
    const version = Symbol();
    latestRead.current = version;
    const current = () => mounted.current && version === latestRead.current;
    try {
      const changed = await service.read(scope, latestState.current?.revision);
      if (!current()) return;
      if (changed) {
        latestState.current = changed;
        setState(changed);
        const failed = useWorkspaceAssistantDraft.getState().drafts[workspaceKey]?.failedInput;
        // 回执丢失或另一窗口重试后，以 Host 已结算的提交消除本地重试提示。
        if (
          failed &&
          changed.messages.some(
            (message) =>
              message.id === failed.id &&
              message.text === failed.text &&
              message.taskId === failed.targetTaskId &&
              !message.retryable,
          )
        ) {
          updateDraft(workspaceKey, { failedInput: undefined, errorCode: undefined });
        }
      }
      const next = latestState.current;
      if (!next) return;
      setReadFailed(undefined);
      const taskIds = [
        ...new Set([
          ...itemsOnPage(next.items, page).map((item) => item.taskId),
          ...(next.messages.at(-1)?.choices ?? []),
          ...(target ? [target] : []),
        ]),
      ];
      const rows = taskIds.length ? await service.progress(scope, { taskIds }) : [];
      if (current()) {
        setProgress(rows);
        setDeletedIds((known) => {
          const updates = rows.filter(
            (row) =>
              row.status !== "unavailable" && known.has(row.taskId) !== (row.status === "deleted"),
          );
          if (!updates.length) return known;
          const latest = new Set(known);
          for (const row of updates) {
            if (row.status === "deleted") latest.add(row.taskId);
            else latest.delete(row.taskId);
          }
          return latest;
        });
      }
    } catch (error) {
      if (current()) {
        setReadFailed(diagnosticCode(error));
        setProgress([]);
      }
    }
  }, [service, scope, page, workspaceKey, updateDraft, target]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cycle = 0;
    async function update() {
      const current = ++cycle;
      clearTimeout(timer);
      if (!visible || document.visibilityState === "hidden") return;
      await refresh();
      if (!disposed && current === cycle) timer = setTimeout(() => void update(), 4000);
    }
    void update();
    document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      mounted.current = false;
      latestRead.current = null;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh, sending, visible]);

  const send = async (input: AssistantInput) => {
    if (!service || useWorkspaceAssistantDraft.getState().drafts[workspaceKey]?.pending) return;
    latestRead.current = null;
    updateDraft(workspaceKey, { pending: input, failedInput: undefined, errorCode: undefined });
    try {
      const next = await service.send({ ...scope, projectId }, input);
      if (mounted.current) {
        latestRead.current = null;
        latestState.current = next;
        setState(next);
      }
    } catch (error) {
      updateDraft(workspaceKey, { failedInput: input, errorCode: diagnosticCode(error) });
    } finally {
      updateDraft(workspaceKey, { pending: undefined });
    }
  };
  return {
    state,
    progress,
    deletedIds,
    ...draft,
    readFailed,
    send,
    refresh,
    setText: (text: string) => updateDraft(workspaceKey, { text }),
    setTarget: (target?: string) => updateDraft(workspaceKey, { target }),
    visibleItems: itemsOnPage(state?.items ?? [], page),
    page,
    setPage,
    pageCount: Math.ceil((state?.items.length ?? 0) / ITEMS_PER_PAGE),
  };
}
