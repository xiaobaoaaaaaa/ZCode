import type { ContinuationSnapshot } from "./contract.js";
import { resolveInterruptedContinuation } from "./index.js";

export function continuationButtonExample(snapshot: ContinuationSnapshot, hasDraft: boolean) {
  return hasDraft ? null : resolveInterruptedContinuation(snapshot);
}
