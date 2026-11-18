import type { WorkspaceAssistantPageProps } from "./contract.js";

export const assistantPageExample: WorkspaceAssistantPageProps = {
  visible: true,
  workspacePath: "/workspace/project",
  activeTaskId: null,
  onOpenTask: (taskId) => void taskId,
};
