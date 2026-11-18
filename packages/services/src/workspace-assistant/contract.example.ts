import type { AssistantScope, IWorkspaceAssistantService } from "./contract.js";

export function continueTask(
  service: IWorkspaceAssistantService,
  scope: AssistantScope,
  taskId: string,
  text: string,
) {
  return service.send(scope, { id: crypto.randomUUID(), text, targetTaskId: taskId });
}
