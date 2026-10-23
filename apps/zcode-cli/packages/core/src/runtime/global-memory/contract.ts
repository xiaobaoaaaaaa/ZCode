import type { Model, TraceContext } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";

/** Runtime-owned operations. Reads are request-local; scheduling never mutates transcript. */
export interface GlobalProfileRuntimeContract {
  globalMemoryBackground(
    runtime: AgentRuntimeInternal,
    entries: readonly RuntimeMessageEntry[],
  ): Promise<RuntimeMessageEntry[]>;
  scheduleGlobalMemoryExtraction(
    runtime: AgentRuntimeInternal,
    input: { model: Model; traceContext: TraceContext },
  ): void;
}
