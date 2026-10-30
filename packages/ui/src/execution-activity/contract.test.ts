import { describe, expect, it } from "vitest";

import { groupExecutionActivities } from "./group.js";
import type { ExecutionActivityDescriptor } from "./contract.js";

describe("execution-activity contract", () => {
  const thought = Object.freeze({ key: "1", reasoningCount: 1, toolCount: 0, running: false });
  const tool = Object.freeze({ key: "2", reasoningCount: 0, toolCount: 2, running: true });
  const boundary = Object.freeze({ text: "正文或交互" });
  const describeItem = (item: ExecutionActivityDescriptor | { text: string }) =>
    "key" in item ? item : null;

  it("combines adjacent activity, preserves boundaries and the original item references", () => {
    const input = Object.freeze([thought, tool, boundary, thought, boundary]);
    const grouped = groupExecutionActivities(input, describeItem);
    expect(grouped).toEqual([
      {
        kind: "activity",
        key: "1",
        reasoningCount: 1,
        toolCount: 2,
        running: true,
        items: [thought, tool],
      },
      { kind: "item", item: boundary },
      { kind: "activity", ...thought, items: [thought] },
      { kind: "item", item: boundary },
    ]);
    expect(
      grouped.flatMap((group) => (group.kind === "activity" ? group.items : [group.item])),
    ).toEqual(input);
    const first = grouped[0];
    expect(first?.kind === "activity" && first.items[0]).toBe(thought);
    expect(thought.toolCount).toBe(0);
  });

  it("anchors identity to the first original item as counts and status change", () => {
    expect(groupExecutionActivities([thought], describeItem)[0]).toMatchObject({
      key: "1",
      running: false,
    });
    expect(groupExecutionActivities([thought, tool], describeItem)[0]).toMatchObject({
      key: "1",
      running: true,
    });
    expect(groupExecutionActivities([{ ...thought, toolCount: 3 }], describeItem)[0]).toMatchObject(
      { key: "1" },
    );
  });

  it("does not create empty groups", () => {
    expect(groupExecutionActivities([], describeItem)).toEqual([]);
    expect(groupExecutionActivities([boundary], describeItem)).toEqual([
      { kind: "item", item: boundary },
    ]);
  });
});
