import { describe, expect, it, vi } from "vitest";
import {
  completeExternalQueueDrain,
  drainPendingInput,
  removePendingInputById,
  discardHeldPendingInputById,
  hasInlineGuidePendingInput,
} from "../src/runtime/methods/steering.js";

describe("guide 行内 drain 的外层 FIFO 门", () => {
  it("外层普通队列恢复期间阻止 guide 越过旧项，消费到空后恢复 tool-batch drain", () => {
    const activeTurn = {
      pendingInputs: [{ id: "new-running-input", commandKind: undefined, delivery: "guide" }],
    };
    const runtime = {
      activeTurn,
      pendingInputReservations: new Map<string, string>(),
      queueExternalDrainActive: true,
    };

    expect(hasInlineGuidePendingInput.call(runtime as never, activeTurn as never)).toBe(false);
    completeExternalQueueDrain.call(runtime as never);
    expect(hasInlineGuidePendingInput.call(runtime as never, activeTurn as never)).toBe(true);
  });

  it("普通 future queue 在前时仍允许后续 guide 走当前轮", () => {
    const activeTurn = {
      pendingInputs: [
        { id: "future-queue", commandKind: undefined, delivery: "queue" },
        { id: "current-guide", commandKind: undefined, delivery: "guide" },
      ],
    };
    const runtime = {
      activeTurn,
      pendingInputReservations: new Map<string, string>(),
      queueExternalDrainActive: false,
    };

    expect(hasInlineGuidePendingInput.call(runtime as never, activeTurn as never)).toBe(true);
  });

  it("行内 drain 只取最早 guide，并把普通 future queue 留在原位", async () => {
    const futureQueue = {
      id: "future-queue",
      input: "future work",
      queuedAt: new Date(0),
      delivery: "queue",
    };
    const currentGuide = {
      id: "current-guide",
      input: "guide current work",
      queuedAt: new Date(0),
      delivery: "guide",
      intent: {
        genUiContext: [{ path: "/project/example.html", state: { stage: "guide" } }],
      },
    };
    const activeTurn = {
      pendingInputs: [futureQueue, currentGuide],
      turnId: "turn-current",
    };
    const appendedEvents: Array<{ payload: { pendingInputIds?: string[] } }> = [];
    const runtime = {
      activeTurn,
      appendEvent: vi.fn(async (event) => appendedEvents.push(event)),
      createEvent: vi.fn((_type, payload) => ({ payload })),
      messageHistory: { addEntries: vi.fn() },
      pendingInputReservations: new Map<string, string>(),
      persistUserPrompt: vi.fn(async () => undefined),
      sessionId: "session-current",
      workingDirectory: "/workspace",
    };

    await drainPendingInput.call(runtime as never, {
      activeTurn: activeTurn as never,
      events: [],
      traceContext: { traceId: "trace-current" } as never,
    });

    expect(activeTurn.pendingInputs).toEqual([futureQueue]);
    expect(runtime.messageHistory.addEntries).toHaveBeenCalledOnce();
    expect(JSON.stringify(runtime.messageHistory.addEntries.mock.calls[0])).toContain(
      "guide current work",
    );
    expect(JSON.stringify(runtime.messageHistory.addEntries.mock.calls[0])).not.toContain(
      "future work",
    );
    // 页面状态挂在 guide 自己的 entry 上，不写单独的状态条目。
    expect(runtime.messageHistory.addEntries.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        message: { role: "user", content: "guide current work" },
        metadata: expect.objectContaining({
          genUiState: expect.stringContaining(
            '[{"path":"/project/example.html","state":{"stage":"guide"}}]',
          ),
        }),
      }),
    ]);
    expect(appendedEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ pendingInputIds: ["current-guide"] }),
      }),
    ]);
  });
});

describe("待引导撤回与上下文消费互斥 GW03", () => {
  function setup() {
    const guide = {
      id: "guide",
      input: "withdraw this guide",
      queuedAt: new Date(0),
      delivery: "guide",
      turnId: "turn-current",
    };
    const future = { ...guide, id: "future", input: "future work", delivery: "queue" };
    const traceContext = { traceId: "trace-withdraw" } as never;
    const activeTurn = { pendingInputs: [guide, future], turnId: "turn-current", traceContext };
    const runtime = {
      activeTurn,
      pendingInputEditLocks: new Map(),
      pendingInputReservations: new Map<string, string>(),
      sessionStore: { settleSessionInput: vi.fn(async (_input: unknown) => undefined) },
      rebuildProjection: vi.fn(async () => ({
        pendingSteerInputs: [{ pendingInputId: guide.id, targetTurnId: activeTurn.turnId }],
      })),
      appendEvent: vi.fn(async (_event: unknown) => undefined),
      createEvent: vi.fn((_type, payload) => ({ payload })),
      messageHistory: { addEntries: vi.fn() },
      persistUserPrompt: vi.fn(async () => undefined),
      sessionId: "session-withdraw",
      workingDirectory: "/workspace",
      discardHeldPendingInputById(
        id: string,
        trace: unknown,
        reservationId?: string,
        reason?: "user_removed" | "promoted",
      ) {
        return discardHeldPendingInputById.call(
          runtime as never,
          id,
          trace as never,
          reservationId,
          reason,
        );
      },
    };
    const remove = () =>
      removePendingInputById.call(runtime as never, {
        pendingInputId: guide.id,
        reason: "user_removed",
        traceContext,
      });
    const drain = () =>
      drainPendingInput.call(runtime as never, {
        activeTurn: activeTurn as never,
        events: [],
        traceContext,
      });
    return { runtime, guide, future, remove, drain };
  }

  it("官方编辑锁在场时不抢占 reservation 或删除输入", async () => {
    const { runtime, guide, remove } = setup();
    runtime.pendingInputEditLocks.set(guide.id, { editorId: "other-editor" });
    await expect(remove()).resolves.toBe(false);
    expect(runtime.sessionStore.settleSessionInput).not.toHaveBeenCalled();
    expect(runtime.pendingInputReservations.size).toBe(0);
    expect(runtime.activeTurn.pendingInputs).toContain(guide);
  });

  it("撤回落库期间不能被 drain 或第二次撤回取走", async () => {
    const { runtime, guide, future, remove, drain } = setup();
    const write = Promise.withResolvers<void>();
    runtime.sessionStore.settleSessionInput.mockImplementationOnce(() => write.promise);
    const deleting = remove();
    await expect(drain()).resolves.toBeUndefined();
    await expect(remove()).resolves.toBe(false);
    write.resolve();
    await expect(deleting).resolves.toBe(true);
    expect(runtime.activeTurn.pendingInputs).toEqual([future]);
    expect(runtime.persistUserPrompt).not.toHaveBeenCalled();
    expect(runtime.messageHistory.addEntries).not.toHaveBeenCalled();
    expect(runtime.sessionStore.settleSessionInput).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: guide.id, status: "cancelled" }),
    );
    expect(runtime.pendingInputReservations.size).toBe(0);
  });

  it("消费已取出但 drained 投影尚未发布时不能按 held 项撤回", async () => {
    const { runtime, remove, drain } = setup();
    const entered = Promise.withResolvers<void>();
    const write = Promise.withResolvers<void>();
    runtime.persistUserPrompt.mockImplementationOnce(async () => {
      entered.resolve();
      await write.promise;
    });
    const consuming = drain();
    await entered.promise;
    await expect(remove()).resolves.toBe(false);
    expect(runtime.sessionStore.settleSessionInput).not.toHaveBeenCalled();
    write.resolve();
    await consuming;
    expect(runtime.messageHistory.addEntries).toHaveBeenCalledOnce();
    expect(runtime.pendingInputReservations.size).toBe(0);
  });

  it("撤回写库失败时保留输入并解除占用，允许随后正常消费", async () => {
    const { runtime, guide, remove, drain } = setup();
    runtime.sessionStore.settleSessionInput.mockRejectedValueOnce(new Error("write failed"));
    await expect(remove()).rejects.toThrow("write failed");
    expect(runtime.activeTurn.pendingInputs[0]).toBe(guide);
    expect(runtime.appendEvent).not.toHaveBeenCalled();
    expect(runtime.pendingInputReservations.size).toBe(0);
    await drain();
    expect(runtime.messageHistory.addEntries).toHaveBeenCalledOnce();
  });

  it("读取旧投影期间 turn 已切换，也不能把刚消费的 guide 当成 held 撤回", async () => {
    const { runtime, guide, remove, drain } = setup();
    await drain();
    const projection = Promise.withResolvers<{
      pendingSteerInputs: Array<{ pendingInputId: string; targetTurnId: string }>;
    }>();
    runtime.rebuildProjection.mockImplementationOnce(() => projection.promise);
    const deleting = remove();
    runtime.activeTurn = { ...runtime.activeTurn, turnId: "turn-next", pendingInputs: [] };
    projection.resolve({
      pendingSteerInputs: [{ pendingInputId: guide.id, targetTurnId: "turn-current" }],
    });
    await expect(deleting).resolves.toBe(false);
    expect(runtime.sessionStore.settleSessionInput).not.toHaveBeenCalled();
    expect(runtime.pendingInputReservations.size).toBe(0);
  });

  it("撤回 await 期间前面的 guide 被消费，不得按旧 index 删除 future 邻项", async () => {
    const { runtime, guide, future, remove, drain } = setup();
    runtime.activeTurn.pendingInputs.unshift({ ...guide, id: "earlier", input: "earlier guide" });
    const write = Promise.withResolvers<void>();
    runtime.sessionStore.settleSessionInput.mockImplementationOnce(() => write.promise);
    const deleting = remove();
    await drain();
    write.resolve();
    await expect(deleting).resolves.toBe(true);
    expect(runtime.activeTurn.pendingInputs).toEqual([future]);
    expect(runtime.persistUserPrompt).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(runtime.messageHistory.addEntries.mock.calls)).not.toContain(guide.input);
  });
});
