import { useCallback, useMemo, useSyncExternalStore } from "react";
import { logger } from "@/logger.js";
import { modelSelectionSchema, type ModelSelection } from "@zcode/shared/model-selection";
import { submissionModeSchema, type SubmissionMode } from "@zcode/shared/zcode-protocol-v4";
import { create } from "zustand";
import type { useServices } from "@/hooks/useServices.js";

type AssistantService = NonNullable<ReturnType<typeof useServices>["workspaceAssistantService"]>;
export type AssistantInput = Parameters<AssistantService["send"]>[1];

interface AssistantDraft {
  text: string;
  target?: string;
  pending?: AssistantInput;
  failedInput?: AssistantInput;
  errorCode?: string;
}
interface DraftState {
  drafts: Record<string, AssistantDraft>;
  update(key: string, fields: Partial<AssistantDraft>): void;
}
export const emptyAssistantDraft: AssistantDraft = { text: "" };

// 仅持有本窗口未提交草稿和 RPC 反馈。离开页面不撤销已派发请求；历史仍由 Host 读取。
export const useWorkspaceAssistantDraft = create<DraftState>((set) => ({
  drafts: {},
  update(key, fields) {
    set((state) => {
      const drafts = { ...state.drafts };
      const draft = { ...(drafts[key] ?? emptyAssistantDraft), ...fields };
      if (draft.text || draft.target || draft.pending || draft.failedInput) drafts[key] = draft;
      else delete drafts[key];
      return { drafts };
    });
  },
}));

interface AssistantPreferences {
  modelSelection?: ModelSelection;
  permissionMode?: SubmissionMode;
}
const preferenceChangeEvent = "zcode:workspace-assistant-preferences";
function readPreferenceText(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function decodePreferences(text: string | null): AssistantPreferences {
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    const model = modelSelectionSchema.safeParse(data?.modelSelection);
    const mode = submissionModeSchema.safeParse(data?.permissionMode);
    return {
      modelSelection: model.success ? model.data : undefined,
      permissionMode: mode.success ? mode.data : undefined,
    };
  } catch {
    return {};
  }
}
/** 模型和权限属于本助手的输入偏好，冷恢复不读取或持久化 RPC 状态与凭据。 */
export function useAssistantPreferences(workspaceKey: string, projectId?: string) {
  const key =
    "zcode:workspace-assistant-options:v1:" + JSON.stringify([workspaceKey, projectId ?? null]);
  const subscribe = useCallback(
    (update: () => void) => {
      const changed = (event: Event) => {
        if (
          event instanceof StorageEvent
            ? event.key === null || event.key === key
            : (event as CustomEvent).detail === key
        )
          update();
      };
      window.addEventListener("storage", changed);
      window.addEventListener(preferenceChangeEvent, changed);
      return () => {
        window.removeEventListener("storage", changed);
        window.removeEventListener(preferenceChangeEvent, changed);
      };
    },
    [key],
  );
  const text = useSyncExternalStore(
    subscribe,
    () => readPreferenceText(key),
    () => null,
  );
  const values = useMemo(() => decodePreferences(text), [text]);
  const update = useCallback(
    (fields: AssistantPreferences) => {
      try {
        const next = { ...decodePreferences(readPreferenceText(key)), ...fields };
        window.localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent(preferenceChangeEvent, { detail: key }));
      } catch (error) {
        logger.warn("[workspace-assistant] 无法保存助手输入偏好", { error });
      }
    },
    [key],
  );
  return { values, update };
}
