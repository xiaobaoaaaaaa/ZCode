import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";

export type ContinuationSnapshot = Pick<
  ConversationSnapshot,
  "sessionId" | "logEpoch" | "control" | "inputRouting" | "rows" | "goal" | "availability"
>;

/** 展示动作的身份；不是新的执行状态或命令队列。 */
export interface InterruptedContinuation {
  key: string;
  kind: "message" | "goal";
}
