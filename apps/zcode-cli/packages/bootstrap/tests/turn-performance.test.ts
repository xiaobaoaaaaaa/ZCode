import { describe, expect, it } from "vitest";
import { SessionEventType, type SessionEvent, type MessageWithParts } from "@zcode/contracts";
import { ProductProjection } from "../src/zcode-protocol-v4/index.js";
import { synthesizeEventsFromMessages } from "../src/zcode-protocol-v4/transcript-hydration.js";
import {
  applyConversationDeltas,
  conversationSnapshotSchema,
  DELIVERY_PROFILES,
  filterConversationDeltasForProfile,
} from "@zcode/shared/zcode-protocol-v4";

const sample = (
  requestId: string,
  durationMs = 4000,
  firstResponseMs = 1000,
  outputTokens = 150,
) => ({
  requestId,
  durationMs,
  firstResponseMs,
  inputTokens: 600,
  outputTokens,
  cacheReadTokens: 300,
});
function harness() {
  const projection = new ProductProjection("s1", "epoch");
  let sequence = 0;
  const apply = (type: SessionEvent["type"], payload: unknown, turnId = "t1") => {
    const event = {
      id: `event-${++sequence}`,
      sessionId: "s1",
      turnId,
      type,
      payload,
      timestamp: new Date(1700000000000 + sequence * 1000),
      sequenceNumber: sequence,
      traceId: "trace",
    } as SessionEvent;
    return projection.applyEvent(event);
  };
  apply(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200000 });
  apply(SessionEventType.TurnStarted, { turnNumber: 1, input: "metrics" });
  return { projection, apply };
}
function performance(projection: ProductProjection) {
  return projection.getSnapshot().rows.window.find((row) => row.kind === "turnHeader")?.performance;
}
describe("PERF01–03 turn performance", () => {
  it("GI06 projects guide interruption to both delivery profiles without a stop or retry", () => {
    const { projection, apply } = harness();
    const before = structuredClone(projection.getSnapshot());
    const intent = {
      sourceCommandId: "guide-command",
      queueItemId: "guide-item",
      clientId: "mobile-client",
      kind: "sendText",
      text: "new guide",
      admissionSeq: 1,
      admittedAt: 1,
      requestedDelivery: "guide",
      admittedDelivery: "guide",
    };
    const deltas = [
      ...apply(SessionEventType.ModelStreaming, {
        kind: "reasoning_delta",
        delta: "unfinished",
        done: false,
        assistantMessageId: "discarded",
      }),
      ...apply(SessionEventType.TurnSteerQueued, {
        pendingInputId: "guide-item",
        input: "new guide",
        targetTurnId: "t1",
        queueLength: 1,
        delivery: "guide",
        intent,
      }),
      ...apply(SessionEventType.StreamRecoveryTailDiscarded, {
        attemptId: "attempt",
        anchorId: "anchor",
        assistantMessageId: "discarded",
        discardedTextBytes: 0,
        discardedReasoningBytes: 10,
        discardedToolCallIds: [],
      }),
      ...apply(SessionEventType.TurnSteerDrained, {
        targetTurnId: "t1",
        pendingInputIds: ["guide-item"],
        injectedMessageIds: ["guide-message"],
        drainedInputs: [
          {
            pendingInputId: "guide-item",
            messageId: "guide-message",
            text: "new guide",
            delivery: "guide",
            intent,
          },
        ],
      }),
      ...apply(SessionEventType.ModelStreaming, {
        kind: "text_delta",
        delta: "new response",
        done: false,
        assistantMessageId: "completed",
      }),
      ...apply(SessionEventType.ModelComplete, {
        querySource: "main_turn",
        stopReason: "end_turn",
        usage: {},
        requestPerformance: sample("completed"),
      }),
    ];
    const snapshot = projection.getSnapshot();
    expect(snapshot.rows.window.filter((row) => row.kind === "turnHeader")).toHaveLength(1);
    expect(snapshot.rows.window.find((row) => row.kind === "reasoning")).toMatchObject({
      state: "interrupted",
    });
    expect(snapshot.rows.window.filter((row) => row.kind === "userInput" && row.guided)).toEqual([
      expect.objectContaining({
        sourceCommandId: "guide-command",
        text: "new guide",
        clientId: "mobile-client",
      }),
    ]);
    expect(snapshot.queue.items).toHaveLength(0);
    expect(snapshot.control.apiRetry).toBeNull();
    expect(performance(projection)?.requestCount).toBe(1);
    for (const profile of Object.values(DELIVERY_PROFILES)) {
      const replay = conversationSnapshotSchema.parse(
        applyConversationDeltas(before, filterConversationDeltasForProfile(deltas, profile)),
      );
      expect(replay.rows.window).toEqual(snapshot.rows.window);
      expect(replay.queue).toEqual(snapshot.queue);
      expect(replay.control).toEqual(snapshot.control);
    }
  });
  it("rolls back request dedupe with a rejected atomic frame and commits it once", () => {
    const { projection } = harness();
    const event = {
      id: "atomic",
      sessionId: "s1",
      turnId: "t1",
      type: SessionEventType.ModelComplete,
      payload: {
        querySource: "main_turn",
        stopReason: "end_turn",
        usage: {},
        requestPerformance: sample("atomic"),
      },
      timestamp: new Date(1700000004000),
      sequenceNumber: 3,
      traceId: "trace",
    } as SessionEvent;
    expect(projection.applyEventAtomically(event, () => false)).toBeNull();
    expect(performance(projection)).toBeUndefined();
    projection.applyEventAtomically(event, () => true);
    expect(performance(projection)?.requestCount).toBe(1);
    projection.applyEventAtomically(event, () => true);
    expect(performance(projection)?.requestCount).toBe(1);
  });
  it("keeps interrupted metrics, rejects late events and isolates the next turn", () => {
    const { projection, apply } = harness();
    const payload = {
      querySource: "main_turn",
      stopReason: "end_turn",
      usage: {},
      requestPerformance: sample("first"),
    };
    apply(SessionEventType.ModelComplete, payload);
    apply(SessionEventType.TurnComplete, {
      resultType: "cancelled",
      duration: 5000,
      tokenCount: 0,
      toolCallCount: 0,
    });
    apply(SessionEventType.ModelComplete, { ...payload, requestPerformance: sample("late") });
    expect(performance(projection)?.requestCount).toBe(1);
    apply(SessionEventType.TurnStarted, { turnNumber: 2, input: "next" }, "t2");
    apply(SessionEventType.ModelComplete, { ...payload, requestPerformance: sample("stale") });
    apply(SessionEventType.ModelComplete, { ...payload, requestPerformance: sample("next") }, "t2");
    const headers = projection.getSnapshot().rows.window.filter((row) => row.kind === "turnHeader");
    expect(headers.map((row) => row.performance?.requestCount)).toEqual([1, 1]);
  });
  it("weights generation time, averages first response and does not count cache twice", () => {
    const { projection, apply } = harness();
    const complete = (requestPerformance: unknown, querySource = "main_turn", turnId = "t1") =>
      apply(
        SessionEventType.ModelComplete,
        { querySource, stopReason: "end_turn", usage: {}, requestPerformance },
        turnId,
      );
    complete(sample("a", 3000, 1000, 100));
    const before = projection.getSnapshot();
    const deltas = complete(sample("b", 7000, 1000, 500));
    expect(performance(projection)).toMatchObject({
      requestCount: 2,
      inputTokens: 1200,
      outputTokens: 600,
      cacheReadTokens: 600,
      modelDurationMs: 10000,
      firstResponseTotalMs: 2000,
      firstResponseCount: 2,
      generationDurationMs: 8000,
      timedOutputTokens: 600,
      timedRequestCount: 2,
    });
    expect(
      conversationSnapshotSchema.parse(applyConversationDeltas(before, deltas)).rows.window,
    ).toEqual(projection.getSnapshot().rows.window);
    for (const profile of Object.values(DELIVERY_PROFILES)) {
      expect(
        conversationSnapshotSchema.parse(
          applyConversationDeltas(before, filterConversationDeltasForProfile(deltas, profile)),
        ).rows.window,
      ).toEqual(projection.getSnapshot().rows.window);
    }
    complete(sample("a"));
    complete(sample("compact"), "compact");
    complete(sample("child"), "subagent");
    complete(sample("stale"), "main_turn", "old-turn");
    expect(performance(projection)?.requestCount).toBe(2);
  });
  it("does not invent timing or tokens when unavailable", () => {
    const { projection, apply } = harness();
    apply(SessionEventType.ModelComplete, {
      querySource: "main_turn",
      stopReason: "end_turn",
      usage: {},
      requestPerformance: { requestId: "a" },
    });
    expect(performance(projection)).toMatchObject({
      requestCount: 1,
      outputTokens: null,
      firstResponseCount: 0,
      timedRequestCount: 0,
    });
  });
  it("restores the same samples from assistant metadata without a live observer", () => {
    const messages: MessageWithParts[] = [
      {
        info: {
          id: "u1",
          sessionID: "s1",
          role: "user",
          time: { created: 1700000000000 },
          agent: "default",
          modelSelection: { providerId: "p", modelId: "m" },
        },
        parts: [{ id: "p1", sessionID: "s1", messageID: "u1", type: "text", text: "metrics" }],
      },
      {
        info: {
          id: "a1",
          sessionID: "s1",
          role: "assistant",
          parentID: "u1",
          time: { created: 1700000000001, completed: 1700000004001 },
          modelId: "m",
          providerId: "p",
          mode: "default",
          agent: "default",
          path: { cwd: "/fixture", root: "/fixture" },
          cost: 0,
          tokens: { input: 600, output: 150, reasoning: 0, cache: { read: 300, write: 0 } },
          finish: "stop",
          metadata: { requestPerformance: sample("a1") },
        },
        parts: [{ id: "p2", sessionID: "s1", messageID: "a1", type: "text", text: "done" }],
      },
    ] as MessageWithParts[];
    const projection = new ProductProjection("s1", "epoch");
    for (const event of synthesizeEventsFromMessages(messages, { sessionId: "s1" }))
      projection.applyEvent(event);
    expect(performance(projection)).toMatchObject({
      requestCount: 1,
      outputTokens: 150,
      firstResponseTotalMs: 1000,
      timedOutputTokens: 150,
      generationDurationMs: 3000,
    });
  });
});
