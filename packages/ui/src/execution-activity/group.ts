import {
  EXECUTION_ACTIVITY_TOOL_CATEGORIES,
  type ExecutionActivityDescriptor,
  type ExecutionActivityItem,
} from "./contract.js";

export function groupExecutionActivities<T>(
  items: readonly T[],
  describe: (item: T) => ExecutionActivityDescriptor | null,
): ExecutionActivityItem<T>[] {
  const result: ExecutionActivityItem<T>[] = [];
  for (const item of items) {
    const activity = describe(item);
    if (!activity) {
      result.push({ kind: "item", item });
      continue;
    }
    const previous = result.at(-1);
    if (previous?.kind === "activity") {
      previous.items.push(item);
      previous.reasoningCount += activity.reasoningCount;
      const toolCounts = { ...previous.toolCounts };
      for (const category of EXECUTION_ACTIVITY_TOOL_CATEGORIES) {
        const count = activity.toolCounts[category];
        if (count) toolCounts[category] = (toolCounts[category] ?? 0) + count;
      }
      previous.toolCounts = toolCounts;
      previous.running ||= activity.running;
    } else {
      result.push({
        kind: "activity",
        ...activity,
        toolCounts: { ...activity.toolCounts },
        items: [item],
      });
    }
  }
  return result;
}
