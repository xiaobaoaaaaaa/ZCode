import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface AssistantScope {
  workspacePath: string;
  workspaceIdentity?: string;
  projectId?: string;
}
export interface AssistantItem {
  taskId: string;
  title: string;
}
export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  taskId?: string;
  choices?: string[];
  choiceRequestId?: string;
  retryable?: boolean;
}
export type AssistantDecision =
  | { kind: "answer"; text: string }
  | { kind: "clarify"; text: string; choices?: string[] }
  | { kind: "new"; title: string; brief?: string }
  | { kind: "continue"; taskId: string; brief?: string };

export interface AssistantProgress {
  taskId: string;
  status: string;
  summary: string;
}
export interface AssistantHistory {
  revision: string;
  items: AssistantItem[];
  messages: AssistantMessage[];
}
export interface AssistantInput {
  id: string;
  text: string;
  targetTaskId?: string;
}
export interface IWorkspaceAssistantService {
  read(scope: AssistantScope, knownRevision?: string): Promise<AssistantHistory | null>;
  send(scope: AssistantScope, input: AssistantInput): Promise<AssistantHistory>;
  progress(scope: AssistantScope, input: { taskIds: string[] }): Promise<AssistantProgress[]>;
}
export const IWorkspaceAssistantService = createServiceDescriptor<IWorkspaceAssistantService>(
  ServiceChannels.WorkspaceAssistant,
);
