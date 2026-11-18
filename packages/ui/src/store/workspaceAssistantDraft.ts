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
