import { describe, expect, it } from "vitest";

import { groupExecutionActivities } from "./group.js";
import type { ExecutionActivityDescriptor } from "./contract.js";

describe("execution-activity contract", () => {
  const thought = Object.freeze({
    key: "1",
    reasoningCount: 1,
    toolCounts: Object.freeze({}),
    running: false,
  });
  const tool = Object.freeze({
    key: "2",
    reasoningCount: 0,
    toolCounts: Object.freeze({ read: 1, terminal: 1 }),
    running: true,
  });
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
        toolCounts: { read: 1, terminal: 1 },
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
    expect(thought.toolCounts).toEqual({});
    expect(tool.toolCounts).toEqual({ read: 1, terminal: 1 });
    expect(first?.kind === "activity" && first.toolCounts).not.toBe(tool.toolCounts);
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
    expect(
      groupExecutionActivities([{ ...thought, toolCounts: { browser: 3 } }], describeItem)[0],
    ).toMatchObject({ key: "1" });
  });

  it("merges each category without mutating shared descriptors or splitting the run", () => {
    const result = groupExecutionActivities([tool, tool, thought], describeItem);
    expect(result).toMatchObject([
      { key: "2", reasoningCount: 1, toolCounts: { read: 2, terminal: 2 } },
    ]);
    expect(result).toHaveLength(1);
    expect(tool.toolCounts).toEqual({ read: 1, terminal: 1 });
  });

  it("does not create empty groups", () => {
    expect(groupExecutionActivities([], describeItem)).toEqual([]);
    expect(groupExecutionActivities([boundary], describeItem)).toEqual([
      { kind: "item", item: boundary },
    ]);
  });
});
