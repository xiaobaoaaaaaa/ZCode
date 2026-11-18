import type { Event } from "@zcode/rpc";
import type { SubmissionMode } from "@zcode/shared/zcode-protocol-v4";
import {
  ServiceChannels,
  type ModelSelection,
  type ZCodeWorkspaceGenerateTextProgress,
} from "@zcode/shared";
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
  kind?: "worker" | "reply" | "report";
  reasoning?: string;
}
export type AssistantDecision = { reasoning?: string } & (
  | { kind: "answer"; text: string }
  | { kind: "clarify"; text: string; choices?: string[] }
  | { kind: "new"; title: string; brief?: string }
  | { kind: "batch"; tasks: { title: string; request: string; brief?: string }[] }
  | { kind: "continue"; taskId: string; brief?: string }
);

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
  modelSelection?: ModelSelection;
  permissionMode?: SubmissionMode;
}
export interface AssistantGeneration {
  id: string;
  requestId: string;
  kind: "router" | "report" | "reply";
  taskId?: string;
  text: string;
  reasoning: string;
  toolActivity?: ZCodeWorkspaceGenerateTextProgress["toolActivity"];
}
export interface IWorkspaceAssistantService {
  onDynamicGeneration(scope: AssistantScope): Event<AssistantGeneration[]>;
  read(scope: AssistantScope, knownRevision?: string): Promise<AssistantHistory | null>;
  send(scope: AssistantScope, input: AssistantInput): Promise<AssistantHistory>;
  progress(scope: AssistantScope, input: { taskIds: string[] }): Promise<AssistantProgress[]>;
}
export const IWorkspaceAssistantService = createServiceDescriptor<IWorkspaceAssistantService>(
  ServiceChannels.WorkspaceAssistant,
);
