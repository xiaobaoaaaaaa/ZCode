/** 已通过现有可见性投影的过程项；key 必须锚定原始首行，不能包含数量/状态。 */
export interface ExecutionActivityDescriptor {
  key: string;
  reasoningCount: number;
  toolCount: number;
  running: boolean;
}

export interface ExecutionActivityRun<T> extends ExecutionActivityDescriptor {
  kind: "activity";
  items: T[];
}

/** null 描述符是分组边界，原项保留在折叠外，不重排、不修改输入。 */
export type ExecutionActivityItem<T> = ExecutionActivityRun<T> | { kind: "item"; item: T };
