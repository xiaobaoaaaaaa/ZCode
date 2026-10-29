import type { ContinuationSnapshot, InterruptedContinuation } from "./contract.js";

/** 只读取 CLI 已确认的中断与路由，不能把连接错误或停止请求当作停止完成。 */
export function resolveInterruptedContinuation(
  snapshot: ContinuationSnapshot | null,
): InterruptedContinuation | null {
  if (
    !snapshot ||
    snapshot.control.phase !== "completedInterrupted" ||
    snapshot.control.canStop ||
    snapshot.control.stopState !== "idle" ||
    (snapshot.inputRouting.mode !== "startNow" && snapshot.inputRouting.mode !== "choice")
  )
    return null;
  const turnId = snapshot.rows.window.findLast((row) => row.turnId)?.turnId;
  if (!turnId) return null;
  const goalPaused = snapshot.goal?.status === "paused";
  if (goalPaused && !snapshot.availability.resumeGoal.allowed) return null;
  return {
    key: JSON.stringify([snapshot.sessionId, snapshot.logEpoch, turnId]),
    kind: goalPaused ? "goal" : "message",
  };
}

export type { ContinuationSnapshot, InterruptedContinuation } from "./contract.js";
export { ContinueButton } from "./ContinueButton.js";
