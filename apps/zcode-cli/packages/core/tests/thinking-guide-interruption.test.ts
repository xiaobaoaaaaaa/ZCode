import { describe, expect, it } from "vitest";
import {
  createSessionId,
  SessionEventType,
  type ModelEvent,
  type ModelRequest,
} from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import {
  createRecordingMessageStore,
  requestText,
  registerReadOnlyTool,
} from "./runtime-output-token-continuation-test-helpers.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { hydrateMessageHistoryFromSession } from "../src/agent/session-history-hydrator.js";
import { MessageHistoryImpl } from "../src/agent/message-history.js";

function scenario(
  prefix: ModelEvent[],
  options: { lateTool?: boolean; holdShutdown?: boolean } = {},
) {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const shutdown = Promise.withResolvers<void>();
  const requests: ModelRequest[] = [];
  const store = createRecordingMessageStore();
  const events = createTestSessionEventStore();
  const registry = createToolRegistry();
  let toolExecutions = 0;
  registerReadOnlyTool(registry, "ReadBoundary", "read completed");
  registry.register({
    inputSchema: {},
    metadata: {
      name: "LateWrite",
      readOnly: false,
      concurrentSafe: false,
      destructive: true,
      needsApproval: false,
      riskLevel: "low",
      sideEffectScope: "workspace",
    },
    handler: async () => {
      toolExecutions += 1;
      return "unexpected";
    },
  });
  const runtime = createTestAgentRuntime(
    createSessionId("thinking-guide"),
    {
      mode: "yolo",
      modelStreaming: "on",
      titleGeneration: { enabled: false },
    },
    {
      sessionStore: store as never,
      eventStore: events,
      toolRegistry: registry,
      modelFactory: createTestModelFactory({
        async *streamText(request) {
          requests.push(request);
          if (requests.length === 1) {
            request.abortSignal?.addEventListener("abort", () => release.resolve(), { once: true });
            for (const event of prefix) yield event;
            ready.resolve();
            await release.promise;
            if (options.holdShutdown) await shutdown.promise;
            // 故意模拟不遵守 abort 的 adapter：旧流尾包不得写入历史或调度工具。
            if (options.lateTool)
              yield {
                type: "tool_call",
                toolCall: { id: "late-write", name: "LateWrite", input: {} },
              };
            else yield { type: "text_delta", text: "OLD_RESPONSE" };
          } else {
            yield { type: "text_delta", text: "GUIDE_APPLIED" };
          }
          yield {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 2 },
          };
        },
      }),
    },
  );
  const completion = runtime.executeTurn("ORIGINAL_TASK");
  void completion.catch(() => undefined);
  // 失败断言也会释放受控请求，避免把下一个用例变成遗留任务测试。
  const cleanup = async () => {
    release.resolve();
    shutdown.resolve();
    await completion.catch(() => undefined);
  };
  const guide = (input = "NEW_GUIDE", delivery: "guide" | "queue" = "guide") =>
    runtime.steerTurn({
      input,
      delivery,
      inputPresentation: "user_steer",
      expectedTurnId: runtime.getActiveTurnInfo()?.turnId,
    });
  return {
    runtime,
    events,
    store,
    requests,
    ready: ready.promise,
    release,
    shutdown,
    completion,
    cleanup,
    guide,
    executions: () => toolExecutions,
  };
}

const thinking: ModelEvent[] = [
  { type: "reasoning_start", id: "r1" },
  { type: "reasoning_delta", id: "r1", text: "UNCOMMITTED_REASONING" },
];

describe("thinking guide interruption", () => {
  it.each([{ prefix: [] }, { prefix: thinking }])(
    "GI01/GI02 interrupts only the request and continues the same turn ($prefix)",
    async ({ prefix }) => {
      const s = scenario(prefix);
      try {
        await s.ready;
        const turnId = s.runtime.getActiveTurnInfo()?.turnId;
        expect((await s.guide()).kind).toBe("queued");
        expect(s.requests[0]!.abortSignal?.aborted).toBe(true);
        const result = await s.completion;
        expect(result.response).toBe("GUIDE_APPLIED");
        expect(s.requests).toHaveLength(2);
        expect(requestText(s.requests[1]!.messages)).toContain("ORIGINAL_TASK");
        expect(requestText(s.requests[1]!.messages)).toContain("NEW_GUIDE");
        expect(requestText(s.requests[1]!.messages)).not.toContain("UNCOMMITTED_REASONING");
        expect(requestText(s.requests[1]!.messages)).not.toContain("OLD_RESPONSE");
        const events = await s.events.getEvents(s.runtime.sessionId);
        expect(events.filter((event) => event.type === SessionEventType.TurnStarted)).toHaveLength(
          1,
        );
        expect(
          events
            .filter((event) => event.type === SessionEventType.TurnSteerDrained)
            .map((event) => event.turnId),
        ).toEqual([turnId]);
        expect(
          events.some(
            (event) =>
              event.type === SessionEventType.TurnError ||
              event.type === SessionEventType.StreamRecoveryStarted,
          ),
        ).toBe(false);
        expect(
          events.filter((event) => event.type === SessionEventType.ModelComplete),
        ).toHaveLength(1);
        expect((await s.runtime.getProjection()).pendingSteerInputs).toEqual([]);
        expect(
          s.store.savedMessages.filter(
            (message) => message.role === "user" && message.metadata?.turnSteerDelivery === "guide",
          ),
        ).toHaveLength(1);
        const coldHistory = new MessageHistoryImpl();
        await hydrateMessageHistoryFromSession({
          history: coldHistory,
          messages: await s.store.messages(),
        });
        const cold = JSON.stringify(coldHistory.toRuntimeEntries());
        expect(cold).toContain("NEW_GUIDE");
        expect(cold).not.toContain("UNCOMMITTED_REASONING");
        expect(cold).not.toContain("OLD_RESPONSE");
      } finally {
        await s.cleanup();
      }
    },
  );

  it.each<ModelEvent>([
    { type: "text_start", id: "text" },
    { type: "tool_input_start", id: "tool", toolName: "ReadBoundary" },
    { type: "tool_input_start", id: "native", toolName: "web_search", providerExecuted: true },
    { type: "tool_call", toolCall: { id: "read", name: "ReadBoundary", input: {} } },
  ])("GI03 keeps the boundary closed after $type even when reasoning resumes", async (boundary) => {
    const s = scenario([boundary, ...thinking]);
    try {
      await s.ready;
      await s.guide();
      expect(s.requests[0]!.abortSignal?.aborted).toBe(false);
      expect(s.requests).toHaveLength(1);
      s.release.resolve();
      await s.completion;
      expect(requestText(s.requests[1]!.messages)).toContain("NEW_GUIDE");
    } finally {
      await s.cleanup();
    }
  });

  it("GI04 leaves ordinary queue delivery pending", async () => {
    const s = scenario(thinking);
    try {
      await s.ready;
      await s.guide("LATER_QUEUE", "queue");
      expect(s.requests[0]!.abortSignal?.aborted).toBe(false);
      s.release.resolve();
      await s.completion;
      expect(s.requests).toHaveLength(1);
      expect((await s.runtime.getProjection()).pendingSteerInputs).toHaveLength(1);
    } finally {
      await s.cleanup();
    }
  });

  it("GI05 waits for shutdown, drains multiple guides once and rejects a late tool", async () => {
    const s = scenario(thinking, { lateTool: true, holdShutdown: true });
    try {
      await s.ready;
      await s.guide("GUIDE_A");
      await s.guide("GUIDE_B");
      expect(s.requests[0]!.abortSignal?.aborted).toBe(true);
      expect(s.requests).toHaveLength(1);
      s.shutdown.resolve();
      await s.completion;
      expect(s.requests).toHaveLength(2);
      const text = requestText(s.requests[1]!.messages);
      expect(text.indexOf("GUIDE_A")).toBeLessThan(text.indexOf("GUIDE_B"));
      expect(text.match(/GUIDE_A/g)).toHaveLength(1);
      expect(text.match(/GUIDE_B/g)).toHaveLength(1);
      expect(s.executions()).toBe(0);
      expect(
        (await s.events.getEvents(s.runtime.sessionId)).filter(
          (event) => event.type === SessionEventType.TurnSteerDrained,
        ),
      ).toHaveLength(2);
    } finally {
      await s.cleanup();
    }
  });

  it("GI05 lets Stop win while the old request is shutting down", async () => {
    const s = scenario(thinking, { holdShutdown: true });
    try {
      await s.ready;
      await s.guide();
      s.runtime.stopActiveForegroundExecution({ reason: "user stop" });
      s.shutdown.resolve();
      await s.completion.catch(() => undefined);
      expect(s.requests).toHaveLength(1);
      const events = await s.events.getEvents(s.runtime.sessionId);
      expect(events.some((event) => event.type === SessionEventType.TurnSteerDrained)).toBe(false);
      expect((await s.runtime.getProjection()).pendingSteerInputs).toHaveLength(1);
    } finally {
      await s.cleanup();
    }
  });

  it("GI05 does not consume a guide withdrawn during shutdown", async () => {
    const s = scenario(thinking, { holdShutdown: true });
    try {
      await s.ready;
      const queued = await s.guide();
      if (queued.kind !== "queued") throw new Error("guide must queue");
      expect(
        await s.runtime.removePendingInputById({
          pendingInputId: queued.pendingInputId,
          reason: "user_removed",
          traceContext: { sessionId: s.runtime.sessionId, traceId: "guide-withdraw" as never },
        }),
      ).toBe(true);
      s.shutdown.resolve();
      await s.completion;
      expect(s.requests).toHaveLength(2);
      expect(requestText(s.requests[1]!.messages)).not.toContain("NEW_GUIDE");
      expect(
        (await s.events.getEvents(s.runtime.sessionId)).some(
          (event) => event.type === SessionEventType.TurnSteerDrained,
        ),
      ).toBe(false);
    } finally {
      await s.cleanup();
    }
  });

  it("GI05 leaves a reserved guide to its promotion owner", async () => {
    const s = scenario(thinking, { holdShutdown: true });
    try {
      await s.ready;
      const queued = await s.guide();
      if (queued.kind !== "queued") throw new Error("guide must queue");
      expect(
        await s.runtime.reservePendingInputById({
          pendingInputId: queued.pendingInputId,
          reservationId: "send-now-owner",
          traceContext: { sessionId: s.runtime.sessionId, traceId: "guide-reserve" as never },
        }),
      ).toBe(true);
      s.shutdown.resolve();
      await s.completion;
      expect(s.requests).toHaveLength(2);
      expect(requestText(s.requests[1]!.messages)).not.toContain("NEW_GUIDE");
      expect((await s.runtime.getProjection()).pendingSteerInputs).toHaveLength(1);
    } finally {
      await s.cleanup();
    }
  });
});
