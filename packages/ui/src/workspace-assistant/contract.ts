export interface WorkspaceAssistantPageProps {
  visible: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  activeTaskId: string | null;
  draftProjectId?: string | null;
  onOpenTask(taskId: string): void;
}
