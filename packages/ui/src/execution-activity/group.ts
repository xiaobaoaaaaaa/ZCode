import type { ExecutionActivityDescriptor, ExecutionActivityItem } from "./contract.js";

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
      previous.toolCount += activity.toolCount;
      previous.running ||= activity.running;
    } else {
      result.push({ kind: "activity", ...activity, items: [item] });
    }
  }
  return result;
}
