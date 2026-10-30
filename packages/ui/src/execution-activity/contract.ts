/** 摘要的固定展示顺序；每个原始工具调用只计入其中一个类别。 */
export const EXECUTION_ACTIVITY_TOOL_CATEGORIES = [
  "read",
  "edit",
  "terminal",
  "browser",
  "search",
  "web",
  "script",
  "app",
  "other",
] as const;
export type ExecutionActivityToolCategory = (typeof EXECUTION_ACTIVITY_TOOL_CATEGORIES)[number];
export type ExecutionActivityToolCounts = Partial<Record<ExecutionActivityToolCategory, number>>;

/** 已通过现有可见性投影的过程项；key 必须锚定原始首行，不能包含数量/状态/类别。 */
export interface ExecutionActivityDescriptor {
  key: string;
  reasoningCount: number;
  toolCounts: Readonly<ExecutionActivityToolCounts>;
  running: boolean;
}

export interface ExecutionActivityRun<T> extends ExecutionActivityDescriptor {
  kind: "activity";
  items: T[];
}

/** null 描述符是分组边界，原项保留在折叠外，不重排、不修改输入。 */
export type ExecutionActivityItem<T> = ExecutionActivityRun<T> | { kind: "item"; item: T };
