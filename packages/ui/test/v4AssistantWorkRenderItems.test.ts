import { describe, expect, it } from "vitest";
import type {
  ConversationRow,
  ReasoningRow,
  SubagentRow,
  ToolCallRow,
} from "@zcode/shared/zcode-protocol-v4";
import {
  buildAssistantWorkRenderItems,
  describeAssistantWorkActivity,
} from "@/v4/conversationAssistantWorkItems.js";
import { groupExecutionActivities } from "@/execution-activity/index.js";

const SHOW_ALL_REASONING = { messageStreamShowReasoning: true } as const;
const BROWSER_CODE =
  "const { setupBrowserRuntime } = await import('/plugin/scripts/browser-client.mjs'); await setupBrowserRuntime({ globals: globalThis });";

describe("execution activity projection", () => {
  const screenshotDisplay = {
    kind: "node_repl_images" as const,
    images: [{ base64: "AAAA", mimeType: "image/png" }],
  };

  it.each([
    ["Read", "read"],
    ["Write", "edit"],
    ["Edit", "edit"],
    ["Bash", "terminal"],
    ["Grep", "search"],
    ["Glob", "search"],
    ["WebFetch", "web"],
    ["mcp__node_repl__js", "script"],
    ["Skill", "other"],
    ["mcp__custom__lookup", "other"],
  ])("classifies %s by its tool identity", (name, category) => {
    const item = buildRenderItems([toolCall(1, name!, {})])[0]!;
    expect(describeAssistantWorkActivity(item)?.toolCounts).toEqual({ [category!]: 1 });
  });

  it("does not mistake ordinary image generation or a browser mention for browser automation", () => {
    const row = toolCall(
      1,
      "mcp__node_repl__js",
      { code: "console.log('browser-client.mjs setupBrowserRuntime')" },
      { display: screenshotDisplay },
    );
    expect(describeAssistantWorkActivity(buildRenderItems([row])[0]!)?.toolCounts).toEqual({
      script: 1,
    });
  });

  it("reclassifies streaming input without duplicating the call or changing its anchor", () => {
    const row = toolCall(1, "mcp__node_repl__js", undefined, {
      inputText: '{"code":',
      status: "inputStreaming",
    });
    const initial = describeAssistantWorkActivity(buildRenderItems([row])[0]!);
    const updated = describeAssistantWorkActivity(
      buildRenderItems([{ ...row, inputText: JSON.stringify({ code: BROWSER_CODE }) }])[0]!,
    );
    expect(initial).toMatchObject({ key: "1", toolCounts: { script: 1 } });
    expect(updated).toMatchObject({ key: "1", toolCounts: { browser: 1 } });
    expect(Object.values(updated!.toolCounts).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("counts original calls consistently with inner grouping enabled or disabled", () => {
    const rows = [
      toolCall(1, "Read", { file_path: "a.ts" }),
      toolCall(2, "Read", { file_path: "a.ts" }),
      toolCall(3, "Write", { file_path: "a.ts", content: "one" }),
      toolCall(4, "Write", { file_path: "a.ts", content: "two" }),
      toolCall(5, "Bash", { command: "node -v" }),
      toolCall(6, "Bash", { command: "pnpm -v" }),
    ];
    for (const enabled of [true, false]) {
      const items = buildRenderItems(rows, SHOW_ALL_REASONING, {
        enableExploreGrouping: enabled,
        enableChangesGrouping: enabled,
        enableTerminalGrouping: enabled,
      });
      const groups = groupExecutionActivities(items, describeAssistantWorkActivity);
      expect(groups).toMatchObject([{ key: "1", toolCounts: { read: 2, edit: 2, terminal: 2 } }]);
      expect(groups).toHaveLength(1);
    }
  });

  it.each(["row", "output"] as const)(
    "keeps browser screenshot results in the same activity (%s display)",
    (channel) => {
      const pending = toolCall(
        2,
        "mcp__node_repl__js",
        { code: BROWSER_CODE },
        { status: "running" },
      );
      const result = {
        ...pending,
        status: "success" as const,
        output: {
          text: "BROWSER_EXECUTION_LOG",
          ...(channel === "output" ? { display: screenshotDisplay } : {}),
        },
        ...(channel === "row" ? { display: screenshotDisplay } : {}),
      };
      const project = (row: ToolCallRow) =>
        groupExecutionActivities(
          buildRenderItems([row, toolCall(3, "Read", { file_path: "result.txt" })]),
          describeAssistantWorkActivity,
        );
      expect(project(pending)).toMatchObject([
        { kind: "activity", key: "2", toolCounts: { browser: 1, read: 1 } },
      ]);
      const updated = project(result);
      expect(updated).toMatchObject([
        { kind: "activity", key: "2", toolCounts: { browser: 1, read: 1 } },
      ]);
      const activity = updated[0];
      expect(activity?.kind === "activity" && activity.items[0]).toMatchObject({
        row: result,
      });
    },
  );

  it("keeps an app-only Node REPL result inside and honors canonical display precedence", () => {
    const row = toolCall(
      1,
      "mcp__node_repl__js",
      {},
      {
        display: { ...screenshotDisplay, source: "browser_turn_end" },
        output: { display: { kind: "node_repl_images", app: { appKey: "test-app" } } },
      },
    );
    expect(describeAssistantWorkActivity(buildRenderItems([row])[0]!)).toMatchObject({
      toolCounts: { app: 1 },
    });
  });

  it.each(["row", "output"] as const)(
    "leaves the final screenshot outside (%s display)",
    (channel) => {
      const display = { ...screenshotDisplay, source: "browser_turn_end" as const };
      const row = toolCall(
        1,
        "mcp__node_repl__js",
        {},
        channel === "row" ? { display } : { output: { display } },
      );
      expect(describeAssistantWorkActivity(buildRenderItems([row])[0]!)).toBeNull();
    },
  );

  it.each(["pendingApproval", "error", "cancelled"] as const)(
    "keeps a screenshot tool outside when %s requires attention",
    (status) => {
      const row = toolCall(1, "mcp__node_repl__js", {}, { status, display: screenshotDisplay });
      expect(describeAssistantWorkActivity(buildRenderItems([row])[0]!)).toBeNull();
    },
  );

  it("counts visible thoughts and mixed tools without replacing the existing render items", () => {
    const items = buildRenderItems([
      reasoning(1),
      toolCall(2, "Read", { file_path: "a.ts" }),
      toolCall(3, "Read", { file_path: "b.ts" }),
      toolCall(4, "Write", { file_path: "c.ts", content: "hello" }),
      toolCall(5, "Bash", { command: "pwd" }, { status: "running" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["row", "exploreGroup", "row", "row"]);
    expect(groupExecutionActivities(items, describeAssistantWorkActivity)).toEqual([
      {
        kind: "activity",
        key: "1",
        reasoningCount: 1,
        toolCounts: { read: 2, edit: 1, terminal: 1 },
        running: true,
        items,
      },
    ]);
  });

  it("keeps identity when a single tool becomes an existing Explore group", () => {
    const first = toolCall(2, "Read", { file_path: "a.ts" });
    const single = buildRenderItems([first]);
    const grouped = buildRenderItems([first, toolCall(3, "Read", { file_path: "b.ts" })]);
    expect(describeAssistantWorkActivity(single[0]!)).toMatchObject({
      key: "2",
      toolCounts: { read: 1 },
    });
    expect(describeAssistantWorkActivity(grouped[0]!)).toMatchObject({
      key: "2",
      toolCounts: { read: 2 },
    });
  });

  it.each(["pendingApproval", "error", "cancelled"] as const)(
    "keeps %s tools outside the new fold",
    (status) => {
      const items = buildRenderItems([
        reasoning(1),
        toolCall(2, "Bash", { command: "pwd" }, { status }),
        reasoning(3),
      ]);
      expect(
        groupExecutionActivities(items, describeAssistantWorkActivity).map((item) => item.kind),
      ).toEqual(["activity", "item", "activity"]);
    },
  );

  it("does not hide a failed child inside an existing Explore group", () => {
    const items = buildRenderItems([
      toolCall(1, "Read", { file_path: "a.ts" }),
      toolCall(2, "Read", { file_path: "missing.ts" }, { status: "error" }),
    ]);
    expect(items[0]?.kind).toBe("exploreGroup");
    expect(describeAssistantWorkActivity(items[0]!)).toBeNull();
  });

  it.each(["AskUserQuestion", "TodoWrite", "Agent", "EnterPlanMode", "CronCreate"])(
    "leaves special %s tools outside the fold",
    (name) => {
      const items = buildRenderItems([toolCall(1, name, {})]);
      expect(describeAssistantWorkActivity(items[0]!)).toBeNull();
    },
  );

  it("respects the reasoning visibility setting before counting", () => {
    const items = buildRenderItems(
      [reasoning(1), reasoning(2), toolCall(3, "Read", { file_path: "a.ts" })],
      {
        messageStreamShowReasoning: false,
        messageStreamFirstReasoningRowId: 1,
      },
    );
    expect(groupExecutionActivities(items, describeAssistantWorkActivity)).toMatchObject([
      { reasoningCount: 1, toolCounts: { read: 1 } },
    ]);
  });

  it("collapses ordinary MCP calls but keeps plugin UI visible using canonical output display", () => {
    const display = { kind: "mcp_tool", serverName: "example", toolName: "lookup" } as const;
    const row = toolCall(1, "mcp__example__lookup", {}, { display });
    expect(describeAssistantWorkActivity(buildRenderItems([row])[0]!)).toMatchObject({
      toolCounts: { other: 1 },
    });
    const withUi = {
      ...row,
      output: {
        display: {
          ...display,
          ui: { pluginId: "example", resourceUri: "ui://example/panel", showInline: true as const },
        },
      },
    };
    expect(describeAssistantWorkActivity(buildRenderItems([withUi])[0]!)).toBeNull();
  });

  it("keeps pending interaction IDs and interrupted thoughts outside even with stale status", () => {
    const tool = toolCall(
      1,
      "Bash",
      { command: "pwd" },
      { approvalInteractionId: "approval-1", status: "running" },
    );
    expect(describeAssistantWorkActivity(buildRenderItems([tool])[0]!)).toBeNull();
    expect(
      describeAssistantWorkActivity(
        buildRenderItems([{ ...reasoning(2), state: "interrupted" }])[0]!,
      ),
    ).toBeNull();
  });
});

function buildRenderItems(
  rows: Parameters<typeof buildAssistantWorkRenderItems>[0],
  reasoningVisibility: Parameters<typeof buildAssistantWorkRenderItems>[1] = SHOW_ALL_REASONING,
  options?: Parameters<typeof buildAssistantWorkRenderItems>[2],
) {
  return buildAssistantWorkRenderItems(rows, reasoningVisibility, {
    ...options,
    enableChangesGrouping: options?.enableChangesGrouping ?? true,
  });
}

function toolCall(
  rowId: number,
  toolName: string,
  input: unknown,
  overrides: Partial<ToolCallRow> = {},
): ToolCallRow {
  return {
    rowId,
    turnId: "turn-1",
    createdAt: 1_700_000_000_000 + rowId,
    createdAtSeq: rowId,
    kind: "toolCall",
    toolCallId: `tool-${rowId}`,
    toolName,
    status: "success",
    input,
    inputText: JSON.stringify(input),
    ...overrides,
  };
}

function subagent(rowId: number, overrides: Partial<SubagentRow> = {}): SubagentRow {
  return {
    rowId,
    turnId: "turn-1",
    createdAt: 1_700_000_000_000 + rowId,
    createdAtSeq: rowId,
    kind: "subagent",
    subagentType: "Explore",
    status: "running",
    summaryText: "正在分析工作区",
    childSessionId: `child-session-${rowId}`,
    ...overrides,
  };
}

function reasoning(rowId: number): ReasoningRow {
  return {
    rowId,
    turnId: "turn-1",
    createdAt: 1_700_000_000_000 + rowId,
    createdAtSeq: rowId,
    kind: "reasoning",
    state: "complete",
    text: `reasoning-${rowId}`,
  };
}

describe("buildAssistantWorkRenderItems", () => {
  it("keeps a single Explore, Terminal, or Changes tool ungrouped", () => {
    expect(buildRenderItems([toolCall(1, "Read", { path: "package.json" })])).toMatchObject([
      { kind: "row", row: { rowId: 1 } },
    ]);
    expect(buildRenderItems([toolCall(2, "Bash", { command: "pnpm test" })])).toMatchObject([
      { kind: "row", row: { rowId: 2 } },
    ]);
    expect(
      buildRenderItems([toolCall(3, "Edit", { path: "package.json", newText: "{}" })]),
    ).toMatchObject([{ kind: "row", row: { rowId: 3 } }]);
  });

  it("groups two consecutive tools of the same display family", () => {
    expect(
      buildRenderItems([
        toolCall(1, "Read", { path: "package.json" }),
        toolCall(2, "Grep", { pattern: "group" }),
      ]),
    ).toMatchObject([{ kind: "exploreGroup", rows: [{ rowId: 1 }, { rowId: 2 }] }]);
    expect(
      buildRenderItems([
        toolCall(3, "Bash", { command: "pnpm test" }),
        toolCall(4, "Bash", { command: "pnpm lint" }),
      ]),
    ).toMatchObject([{ kind: "executeGroup", rows: [{ rowId: 3 }, { rowId: 4 }] }]);
    expect(
      buildRenderItems([
        toolCall(5, "Write", { file_path: "src/a.ts", content: "a" }),
        toolCall(6, "Edit", {
          file_path: "src/b.ts",
          old_string: "b",
          new_string: "c",
        }),
      ]),
    ).toMatchObject([{ kind: "changesGroup", rows: [{ rowId: 5 }, { rowId: 6 }] }]);
  });

  it("marks a terminal Explore group as stopped when a child was cancelled", () => {
    const items = buildRenderItems([
      toolCall(1, "Read", { path: "package.json" }),
      toolCall(2, "Grep", { pattern: "group" }, { status: "cancelled" }),
    ]);

    expect(items).toMatchObject([
      {
        kind: "exploreGroup",
        node: { toolCall: { status: "stopped" } },
        rows: [{ rowId: 1 }, { rowId: 2 }],
      },
    ]);
  });

  it("does not group same-family tools across a visible tool boundary", () => {
    const items = buildRenderItems([
      toolCall(1, "Read", { path: "src/a.ts" }),
      toolCall(2, "Edit", { path: "src/a.ts", newText: "a" }),
      toolCall(3, "Read", { path: "src/b.ts" }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["row", "row", "row"]);
  });

  it("keeps reasoning outside without closing and lets an uncorrelated message close", () => {
    const rows = [
      toolCall(1, "mcp__computer-use__get_app_state", { app_ref: { pid: 691 } }),
      reasoning(2),
      {
        rowId: 3,
        turnId: "turn-1",
        createdAt: 1_700_000_000_003,
        createdAtSeq: 3,
        kind: "assistantText",
        text: "更新数据……",
        state: "complete",
      } satisfies ConversationRow,
      toolCall(4, "mcp__computer-use__left_click", {
        target: { type: "element", state_id: "s-1", index: 59 },
      }),
      toolCall(5, "Bash", { command: "pnpm test" }),
    ];

    const items = buildRenderItems(rows);

    expect(items.map((item) => item.kind)).toEqual(["cuaGroup", "row", "row", "cuaGroup", "row"]);
    const group = items[0];
    expect(group?.kind).toBe("cuaGroup");
    if (group?.kind !== "cuaGroup") throw new Error("expected CUA group");
    expect(group.key).toBe("cua:1");
    expect(group.node.toolCall.toolId).toBe("cua:tool-1");
    expect(group.node.toolCall.status).toBe("completed");
    expect(group.rows.map((row) => row.rowId)).toEqual([1]);
    expect(group.events.map((event) => event.row.rowId)).toEqual([1]);
  });

  it("keeps a tail CUA group active across reasoning and starts a new group after a tool boundary", () => {
    const first = buildRenderItems(
      [toolCall(1, "mcp__computer-use__list_apps", {}, { status: "running" })],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const grown = buildRenderItems(
      [
        toolCall(1, "mcp__computer-use__list_apps", {}),
        reasoning(2),
        toolCall(3, "mcp__computer-use__get_app_state", {}, { status: "running" }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const bounded = buildRenderItems([
      toolCall(1, "mcp__computer-use__list_apps", {}),
      toolCall(2, "Read", { path: "package.json" }),
      toolCall(3, "mcp__computer-use__screenshot", {}),
    ]);

    const firstGroup = first[0];
    const grownGroup = grown[0];
    expect(firstGroup?.kind).toBe("cuaGroup");
    expect(grown.map((item) => item.kind)).toEqual(["cuaGroup", "row"]);
    expect(grownGroup?.kind).toBe("cuaGroup");
    if (firstGroup?.kind !== "cuaGroup" || grownGroup?.kind !== "cuaGroup") {
      throw new Error("expected stable CUA groups");
    }
    expect(grownGroup.key).toBe(firstGroup.key);
    expect(grownGroup.node.toolCall.toolId).toBe(firstGroup.node.toolCall.toolId);
    expect(grownGroup.node.toolCall.status).toBe("in_progress");
    expect(grownGroup.rows.map((row) => row.rowId)).toEqual([1, 3]);
    expect(bounded.map((item) => item.kind)).toEqual(["cuaGroup", "row", "cuaGroup"]);
  });

  it("does not group third-party computer-use names and honors the release gate", () => {
    const official = toolCall(1, "mcp__computer-use__wait", {});
    const thirdParty = toolCall(2, "mcp__third-party-computer-use__wait", {});

    expect(buildRenderItems([thirdParty]).map((item) => item.kind)).toEqual(["row"]);
    expect(
      buildAssistantWorkRenderItems([official], SHOW_ALL_REASONING, {
        enableCuaGrouping: false,
      }).map((item) => item.kind),
    ).toEqual(["row"]);
  });

  it("keeps Explore-compatible tools as individual rows when Explore grouping is disabled", () => {
    const rows = [
      toolCall(1, "Read", { path: "src/a.ts" }),
      toolCall(2, "Grep", { pattern: "test" }),
      toolCall(3, "Bash", { command: "rg test src" }),
    ];

    expect(
      buildAssistantWorkRenderItems(rows, SHOW_ALL_REASONING, {
        enableExploreGrouping: false,
      }).map((item) => item.kind),
    ).toEqual(["row", "row", "row"]);
  });

  it("keeps mutating Shell tools as individual rows when Terminal grouping is disabled", () => {
    const rows = [
      toolCall(1, "Bash", { command: "pnpm test" }),
      toolCall(2, "Bash", { command: "mkdir -p tmp/output" }),
    ];

    expect(
      buildAssistantWorkRenderItems(rows, SHOW_ALL_REASONING, {
        enableTerminalGrouping: false,
      }).map((item) => item.kind),
    ).toEqual(["row", "row"]);
  });

  it("keeps file-write tools as individual rows when Changes grouping uses the release default", () => {
    const rows = [
      toolCall(1, "Write", { file_path: "src/a.ts", content: "a" }),
      toolCall(2, "Edit", {
        file_path: "src/b.ts",
        old_string: "b",
        new_string: "c",
      }),
      toolCall(3, "ApplyPatch", {
        patch: "*** Begin Patch\n*** Add File: src/c.ts\n+c\n*** End Patch",
      }),
    ];

    expect(
      buildAssistantWorkRenderItems(rows, SHOW_ALL_REASONING).map((item) => item.kind),
    ).toEqual(["row", "row", "row"]);
  });

  it.each(["inputStreaming", "running"] as const)(
    "defers unclassified shell-family tools with status %s",
    (status) => {
      for (const toolName of ["Bash", "execute", "shell"]) {
        const pending = toolCall(
          1,
          toolName,
          {},
          {
            input: undefined,
            inputText: "",
            status,
          },
        );

        expect(buildRenderItems([pending])).toEqual([]);
      }
    },
  );

  it("classifies a deferred shell tool after its command arrives", () => {
    const readonly = toolCall(
      1,
      "Bash",
      { command: "rg test packages/ui" },
      { status: "inputStreaming" },
    );
    const executable = toolCall(2, "Bash", { command: "pnpm test" }, { status: "running" });

    expect(buildRenderItems([readonly])).toMatchObject([{ kind: "row", row: { rowId: 1 } }]);
    expect(buildRenderItems([executable])).toMatchObject([{ kind: "row", row: { rowId: 2 } }]);
  });

  it("keeps a running Explore tail stable while a later shell awaits its command", () => {
    const explore = toolCall(1, "Grep", { pattern: "renderer" });
    const pendingShell = toolCall(2, "Bash", undefined, {
      inputText: "",
      status: "inputStreaming",
    });

    const pendingItems = buildRenderItems([explore, pendingShell], SHOW_ALL_REASONING, {
      stageTailIsRunning: true,
    });
    expect(pendingItems).toHaveLength(1);
    expect(pendingItems[0]).toMatchObject({ kind: "row", row: { rowId: 1 } });

    const readonlyItems = buildRenderItems(
      [
        explore,
        toolCall(
          2,
          "Bash",
          { command: "ls packages/ui/src/ToolCallBlocks/renderers" },
          { status: "running" },
        ),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const readonlyExplore = readonlyItems[0];
    expect(readonlyExplore?.kind).toBe("exploreGroup");
    if (readonlyExplore?.kind !== "exploreGroup") {
      throw new Error("expected readonly shell to join Explore");
    }
    expect(readonlyExplore.rows.map((row) => row.rowId)).toEqual([1, 2]);
    expect(readonlyExplore.node.toolCall.status).toBe("in_progress");

    const executeItems = buildRenderItems(
      [explore, toolCall(2, "Bash", { command: "pnpm test" }, { status: "running" })],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    expect(executeItems.map((item) => item.kind)).toEqual(["row", "row"]);
  });

  it("upgrades consecutive non-explore shell calls to a stable group", () => {
    const initialItems = buildRenderItems([
      toolCall(1, "Bash", { command: "pnpm install" }, { status: "running" }),
    ]);
    const grownItems = buildRenderItems(
      [
        toolCall(1, "Bash", { command: "pnpm install" }),
        toolCall(2, "Bash", { command: "pnpm test" }, { status: "running" }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const extendedItems = buildRenderItems(
      [
        toolCall(1, "Bash", { command: "pnpm install" }),
        toolCall(2, "Bash", { command: "pnpm test" }),
        toolCall(3, "Bash", { command: "pnpm lint" }, { status: "running" }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const initialExecute = initialItems[0];
    const grownExecute = grownItems[0];
    const extendedExecute = extendedItems[0];

    expect(initialExecute?.kind).toBe("row");
    expect(grownExecute?.kind).toBe("executeGroup");
    expect(extendedExecute?.kind).toBe("executeGroup");
    if (grownExecute?.kind !== "executeGroup" || extendedExecute?.kind !== "executeGroup") {
      throw new Error("expected stable execute groups");
    }

    expect(extendedExecute.key).toBe(grownExecute.key);
    expect(extendedExecute.node.toolCall.toolId).toBe(grownExecute.node.toolCall.toolId);
    expect(grownExecute.rows.map((row) => row.rowId)).toEqual([1, 2]);
    expect(grownExecute.node.toolCall.status).toBe("in_progress");
  });

  it("keeps child failures on execute children and stops at explore boundaries", () => {
    const items = buildRenderItems([
      toolCall(1, "Bash", { command: "pnpm install" }),
      toolCall(2, "Bash", { command: "pnpm build" }, { status: "error" }),
      toolCall(3, "Bash", { command: "git status" }),
      toolCall(4, "Bash", { command: "pnpm test" }, { status: "cancelled" }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["executeGroup", "row", "row"]);
    const firstExecute = items[0];
    if (firstExecute?.kind !== "executeGroup") throw new Error("expected execute group");
    expect(firstExecute.node.toolCall.status).toBe("completed");
    expect(firstExecute.node.childToolCalls[1]?.toolCall.status).toBe("failed");
    expect(items[2]).toMatchObject({ kind: "row", row: { status: "cancelled" } });
  });

  it("merges execute calls across hidden later reasoning only", () => {
    const rows = [
      reasoning(1),
      toolCall(2, "Bash", { command: "pnpm install" }),
      reasoning(3),
      toolCall(4, "Bash", { command: "pnpm test" }),
    ];

    const hiddenItems = buildRenderItems(rows, {
      messageStreamShowReasoning: false,
      messageStreamFirstReasoningRowId: 1,
    });
    expect(hiddenItems.map((item) => item.kind)).toEqual(["row", "executeGroup"]);
    const hiddenExecute = hiddenItems[1];
    if (hiddenExecute?.kind !== "executeGroup") {
      throw new Error("expected merged execute group");
    }
    expect(hiddenExecute.rows.map((row) => row.rowId)).toEqual([2, 4]);

    expect(buildRenderItems(rows).map((item) => item.kind)).toEqual(["row", "row", "row", "row"]);
  });

  it("keeps an unclassified failed shell tool visible", () => {
    const failed = toolCall(
      1,
      "Bash",
      {},
      {
        error: { message: "Permission denied" },
        input: undefined,
        inputText: "",
        status: "error",
      },
    );

    expect(buildRenderItems([failed])).toMatchObject([
      { kind: "row", row: { rowId: 1, status: "error" } },
    ]);
  });

  it("groups consecutive read-only tool calls into one explore item", () => {
    const rows = [
      toolCall(1, "Read", { path: "package.json" }),
      toolCall(2, "Bash", { command: "rg test packages/ui" }),
    ];

    const items = buildRenderItems(rows);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "exploreGroup",
      rowId: 1,
    });
    const first = items[0];
    expect(first?.kind).toBe("exploreGroup");
    if (first?.kind !== "exploreGroup") {
      throw new Error("expected explore group");
    }
    expect(first.rows).toHaveLength(2);
  });

  it("upgrades read-only tools to an Explore group with stable identity", () => {
    const initialItems = buildRenderItems([
      toolCall(1, "Read", { path: "package.json" }, { status: "running" }),
    ]);
    const grownItems = buildRenderItems([
      toolCall(1, "Read", { path: "package.json" }, { status: "success" }),
      toolCall(2, "Bash", { command: "rg test packages/ui" }, { status: "running" }),
    ]);
    const extendedItems = buildRenderItems([
      toolCall(1, "Read", { path: "package.json" }),
      toolCall(2, "Bash", { command: "rg test packages/ui" }),
      toolCall(3, "Grep", { pattern: "renderer" }, { status: "running" }),
    ]);
    const initialExplore = initialItems[0];
    const grownExplore = grownItems[0];
    const extendedExplore = extendedItems[0];

    expect(initialExplore?.kind).toBe("row");
    expect(grownExplore?.kind).toBe("exploreGroup");
    expect(extendedExplore?.kind).toBe("exploreGroup");
    if (grownExplore?.kind !== "exploreGroup" || extendedExplore?.kind !== "exploreGroup") {
      throw new Error("expected stable explore groups");
    }

    expect(extendedExplore.key).toBe(grownExplore.key);
    expect(extendedExplore.node.toolCall.toolId).toBe(grownExplore.node.toolCall.toolId);
    expect(grownExplore.rows).toHaveLength(2);
  });

  it("derives Explore parent status from the running stage tail", () => {
    const completedItems = buildRenderItems(
      [
        toolCall(1, "Read", { path: "package.json" }),
        toolCall(2, "Grep", { pattern: "missing" }, { status: "error" }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const boundedItems = buildRenderItems([
      toolCall(1, "Read", { path: "missing.json" }, { status: "error" }),
      toolCall(2, "Grep", { pattern: "still-running" }, { status: "running" }),
      toolCall(3, "Bash", { command: "pnpm test" }, { status: "running" }),
    ]);
    const runningExplore = completedItems[0];
    const boundedExplore = boundedItems[0];

    expect(runningExplore?.kind).toBe("exploreGroup");
    expect(boundedExplore?.kind).toBe("exploreGroup");
    if (runningExplore?.kind !== "exploreGroup" || boundedExplore?.kind !== "exploreGroup") {
      throw new Error("expected explore groups");
    }

    expect(runningExplore.node.toolCall.status).toBe("in_progress");
    expect(runningExplore.node.childToolCalls[1]?.toolCall.status).toBe("failed");
    expect(boundedExplore.node.toolCall.status).toBe("completed");
    expect(boundedExplore.node.childToolCalls[1]?.toolCall.status).toBe("in_progress");
  });

  it("derives Execute parent status from the running stage tail", () => {
    const tailItems = buildRenderItems(
      [
        toolCall(1, "Bash", { command: "pnpm test" }),
        toolCall(2, "Bash", { command: "pnpm lint" }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const boundedItems = buildRenderItems(
      [
        toolCall(1, "Bash", { command: "pnpm test" }, { status: "running" }),
        toolCall(2, "Bash", { command: "pnpm lint" }),
        toolCall(3, "Read", { path: "package.json" }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const terminalItems = buildRenderItems([
      toolCall(1, "Bash", { command: "pnpm test" }, { status: "running" }),
      toolCall(2, "Bash", { command: "pnpm lint" }),
    ]);
    const tailExecute = tailItems[0];
    const boundedExecute = boundedItems[0];
    const terminalExecute = terminalItems[0];

    expect(tailExecute?.kind).toBe("executeGroup");
    expect(boundedExecute?.kind).toBe("executeGroup");
    expect(terminalExecute?.kind).toBe("executeGroup");
    if (
      tailExecute?.kind !== "executeGroup" ||
      boundedExecute?.kind !== "executeGroup" ||
      terminalExecute?.kind !== "executeGroup"
    ) {
      throw new Error("expected execute groups");
    }

    expect(tailExecute.node.toolCall.status).toBe("in_progress");
    expect(boundedExecute.node.toolCall.status).toBe("completed");
    expect(boundedExecute.node.childToolCalls[0]?.toolCall.status).toBe("in_progress");
    expect(terminalExecute.node.toolCall.status).toBe("completed");
  });

  it("merges explore calls across hidden later reasoning only", () => {
    const rows = [
      reasoning(1),
      toolCall(2, "Read", { path: "package.json" }),
      reasoning(3),
      toolCall(4, "Bash", { command: "rg test packages/ui" }),
    ];

    const hiddenReasoningItems = buildRenderItems(
      rows,
      {
        messageStreamShowReasoning: false,
        messageStreamFirstReasoningRowId: 1,
      },
      { stageTailIsRunning: true },
    );
    expect(hiddenReasoningItems.map((item) => item.kind)).toEqual(["row", "exploreGroup"]);
    const hiddenExplore = hiddenReasoningItems[1];
    expect(hiddenExplore?.kind).toBe("exploreGroup");
    if (hiddenExplore?.kind !== "exploreGroup") {
      throw new Error("expected merged explore group");
    }
    expect(hiddenExplore.rows.map((row) => row.rowId)).toEqual([2, 4]);
    expect(hiddenExplore.node.toolCall.status).toBe("in_progress");

    const visibleReasoningItems = buildRenderItems(rows, SHOW_ALL_REASONING, {
      stageTailIsRunning: true,
    });
    expect(visibleReasoningItems.map((item) => item.kind)).toEqual(["row", "row", "row", "row"]);
  });

  it("ends Explore and starts a Changes group for write tools", () => {
    const rows = [
      toolCall(1, "Read", { path: "package.json" }),
      toolCall(2, "Edit", { path: "package.json", newText: "{}" }),
      {
        rowId: 3,
        turnId: "turn-1",
        createdAt: 1_700_000_003,
        createdAtSeq: 3,
        kind: "assistantText",
        text: "done",
        state: "complete",
      } satisfies ConversationRow,
    ];

    const items = buildRenderItems(rows);

    expect(items.map((item) => item.kind)).toEqual(["row", "row", "row"]);
  });

  it("upgrades consecutive Write/Edit rows to a stable group", () => {
    const initial = buildRenderItems([
      toolCall(1, "Write", { file_path: "src/a.ts", content: "a" }),
    ]);
    const grown = buildRenderItems(
      [
        toolCall(1, "Write", { file_path: "src/a.ts", content: "a" }),
        toolCall(2, "Edit", {
          file_path: "src/b.ts",
          old_string: "b",
          new_string: "c",
        }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const extended = buildRenderItems(
      [
        toolCall(1, "Write", { file_path: "src/a.ts", content: "a" }),
        toolCall(2, "Edit", {
          file_path: "src/b.ts",
          old_string: "b",
          new_string: "c",
        }),
        toolCall(3, "Write", { file_path: "src/c.ts", content: "c" }),
      ],
      SHOW_ALL_REASONING,
      { stageTailIsRunning: true },
    );
    const first = initial[0];
    const next = grown[0];
    const last = extended[0];
    expect(first?.kind).toBe("row");
    expect(next?.kind).toBe("changesGroup");
    expect(last?.kind).toBe("changesGroup");
    if (next?.kind !== "changesGroup" || last?.kind !== "changesGroup")
      throw new Error("expected Changes groups");
    expect(last.key).toBe(next.key);
    expect(last.node.toolCall.toolId).toBe(next.node.toolCall.toolId);
    expect(next.rows.map((row) => row.rowId)).toEqual([1, 2]);
    expect(next.node.toolCall.status).toBe("in_progress");
  });

  it("completes Changes at visible boundaries without inheriting child cancellation", () => {
    const items = buildRenderItems([
      toolCall(
        1,
        "Edit",
        { file_path: "src/a.ts", old_string: "a", new_string: "b" },
        { status: "cancelled" },
      ),
      toolCall(2, "Write", { file_path: "src/b.ts", content: "b" }),
      toolCall(3, "Read", { path: "src/a.ts" }),
    ]);
    const changes = items[0];
    expect(changes?.kind).toBe("changesGroup");
    if (changes?.kind !== "changesGroup") throw new Error("expected Changes group");
    expect(changes.node.toolCall.status).toBe("completed");
    expect(changes.node.childToolCalls[0]?.toolCall.status).toBe("stopped");
  });

  it("merges Changes across hidden later reasoning but splits at visible reasoning", () => {
    const rows = [
      reasoning(1),
      toolCall(2, "Write", { file_path: "src/a.ts", content: "a" }),
      reasoning(3),
      toolCall(4, "Edit", { file_path: "src/b.ts", old_string: "b", new_string: "c" }),
    ];
    const hidden = buildRenderItems(rows, {
      messageStreamShowReasoning: false,
      messageStreamFirstReasoningRowId: 1,
    });
    expect(hidden.map((item) => item.kind)).toEqual(["row", "changesGroup"]);
    expect(buildRenderItems(rows).map((item) => item.kind)).toEqual(["row", "row", "row", "row"]);
  });

  it("pairs agent tool calls with subagent rows by parentToolCallId", () => {
    const rows = [
      toolCall(1, "Agent", {
        prompt: "分析当前工作区",
        subagent_type: "Explore",
      }),
      subagent(2, { parentToolCallId: "tool-1" }),
      toolCall(3, "Read", { path: "package.json" }),
    ];

    const items = buildRenderItems(rows);

    expect(items.map((item) => item.kind)).toEqual(["agentToolCall", "row"]);
    const agentItem = items[0];
    expect(agentItem?.kind).toBe("agentToolCall");
    if (agentItem?.kind !== "agentToolCall") {
      throw new Error("expected paired agent item");
    }
    expect(agentItem.row.rowId).toBe(1);
    expect(agentItem.subagentRow.rowId).toBe(2);
    expect(agentItem).not.toHaveProperty("showSubagentOutputPreview");
    expect(items.some((item) => item.kind === "row" && item.row.rowId === 2)).toBe(false);
  });

  it("keeps concurrent agent details bound when subagents spawn in reverse order", () => {
    const rows = [
      toolCall(1, "Agent", { description: "测试 general-purpose agent" }),
      toolCall(2, "Agent", { description: "测试 Explore agent" }),
      toolCall(3, "Agent", { description: "测试 test-hello2 agent" }),
      subagent(4, {
        childSessionId: "child-test-hello2",
        parentToolCallId: "tool-3",
        subagentType: "test-hello2",
      }),
      subagent(5, {
        childSessionId: "child-explore",
        parentToolCallId: "tool-2",
        subagentType: "Explore",
      }),
      subagent(6, {
        childSessionId: "child-general-purpose",
        parentToolCallId: "tool-1",
        subagentType: "general-purpose",
      }),
    ];

    const items = buildRenderItems(rows);
    const pairs = items.flatMap((item) =>
      item.kind === "agentToolCall" ? [[item.row.toolCallId, item.subagentRow.childSessionId]] : [],
    );

    expect(pairs).toEqual([
      ["tool-1", "child-general-purpose"],
      ["tool-2", "child-explore"],
      ["tool-3", "child-test-hello2"],
    ]);
  });

  it("only falls back for one unambiguous legacy pair", () => {
    const onePair = buildRenderItems([
      toolCall(1, "Agent", { description: "旧 Agent" }),
      subagent(2),
    ]);
    expect(onePair).toMatchObject([
      {
        kind: "agentToolCall",
        row: { rowId: 1 },
        subagentRow: { rowId: 2 },
      },
    ]);

    const ambiguous = buildRenderItems([
      toolCall(1, "Agent", { description: "旧 Agent A" }),
      toolCall(2, "Agent", { description: "旧 Agent B" }),
      subagent(3),
      subagent(4),
    ]);
    expect(ambiguous.some((item) => item.kind === "agentToolCall")).toBe(false);
    expect(ambiguous.map((item) => item.kind)).toEqual(["row", "row", "row", "row"]);
  });

  it("keeps background subagents paired without requesting an inline output preview", () => {
    const rows = [
      toolCall(1, "Agent", {
        prompt: "后台分析当前工作区",
        run_in_background: true,
        subagent_type: "Explore",
      }),
      subagent(2, { backgrounded: true, parentToolCallId: "tool-1" }),
    ];

    const items = buildRenderItems(rows);

    expect(items).toHaveLength(1);
    const agentItem = items[0];
    expect(agentItem?.kind).toBe("agentToolCall");
    if (agentItem?.kind !== "agentToolCall") {
      throw new Error("expected paired agent item");
    }
    expect(agentItem.subagentRow.backgrounded).toBe(true);
    expect(agentItem).not.toHaveProperty("showSubagentOutputPreview");
  });
});
