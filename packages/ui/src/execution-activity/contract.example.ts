import { groupExecutionActivities } from "./index.js";

export const exampleExecutionActivities = groupExecutionActivities(
  [
    { id: "row-1", kind: "reasoning" },
    { id: "row-2", kind: "tool" },
    { id: "row-3", kind: "text" },
  ],
  (item) =>
    item.kind === "text"
      ? null
      : {
          key: item.id,
          reasoningCount: item.kind === "reasoning" ? 1 : 0,
          toolCounts: item.kind === "tool" ? { read: 1 } : {},
          running: false,
        },
);
