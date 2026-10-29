import { describe, expect, it } from "vitest";
import type { ContinuationSnapshot } from "./contract.js";
import { resolveInterruptedContinuation } from "./index.js";

function stopped(): ContinuationSnapshot {
  return {
    sessionId: "session-1",
    logEpoch: "epoch-1",
    control: {
      phase: "completedInterrupted",
      sessionEnded: true,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "assistant",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    inputRouting: { mode: "startNow" },
    goal: null,
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: false, reasonCode: "no_goal" },
      resumeGoal: { allowed: true },
    },
    rows: {
      totalCount: 1,
      firstRowId: 1,
      window: [
        {
          rowId: 1,
          turnId: "turn-1",
          createdAt: 1,
          createdAtSeq: 1,
          kind: "turnHeader",
          origin: "userInput",
          state: "completedInterrupted",
          startedAt: 1,
        },
      ],
    },
  };
}

describe("interrupted continuation contract", () => {
  it("offers the same stopped turn after restore and unrelated snapshot changes", () => {
    const snapshot = stopped();
    const first = resolveInterruptedContinuation(snapshot);
    expect(first).toMatchObject({ kind: "message" });
    expect(resolveInterruptedContinuation(structuredClone(snapshot))).toEqual(first);
    expect(
      resolveInterruptedContinuation({ ...snapshot, inputRouting: { mode: "choice" } }),
    ).toEqual(first);
    expect(resolveInterruptedContinuation({ ...snapshot, sessionId: "other" })?.key).not.toBe(
      first?.key,
    );
    snapshot.rows.window[0]!.turnId = "turn-2";
    expect(resolveInterruptedContinuation(snapshot)?.key).not.toBe(first?.key);
  });
  it.each(["draft", "prewarming", "running", "completedSuccess", "error"] as const)(
    "does not offer continuation in %s",
    (phase) => {
      const snapshot = stopped();
      snapshot.control.phase = phase;
      expect(resolveInterruptedContinuation(snapshot)).toBeNull();
    },
  );
  it.each(["reject", "guide", "enqueue"] as const)(
    "does not infer readiness from a %s routing state",
    (mode) => {
      const snapshot = stopped();
      snapshot.inputRouting.mode = mode;
      expect(resolveInterruptedContinuation(snapshot)).toBeNull();
    },
  );
  it("waits for the stop barrier and authoritative history", () => {
    const snapshot = stopped();
    expect(resolveInterruptedContinuation(null)).toBeNull();
    snapshot.control.canStop = true;
    expect(resolveInterruptedContinuation(snapshot)).toBeNull();
    snapshot.control.canStop = false;
    snapshot.control.stopState = "stopping";
    expect(resolveInterruptedContinuation(snapshot)).toBeNull();
    snapshot.control.stopState = "idle";
    snapshot.rows.window = [];
    expect(resolveInterruptedContinuation(snapshot)).toBeNull();
  });
  it("resumes a paused goal only through its existing availability", () => {
    const snapshot = stopped();
    snapshot.goal = {
      targetId: "goal-1",
      objective: "finish",
      summaryTitle: null,
      timeUsedSeconds: 0,
      activeRunStartedAtMs: null,
      status: "paused",
      iteration: 1,
      verifications: [],
      iterations: [],
    };
    expect(resolveInterruptedContinuation(snapshot)?.kind).toBe("goal");
    snapshot.availability.resumeGoal = { allowed: false, reasonCode: "blocked" };
    expect(resolveInterruptedContinuation(snapshot)).toBeNull();
  });
});
